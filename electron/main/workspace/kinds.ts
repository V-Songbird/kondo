import type {
  Capabilities,
  CapabilityOperation,
  DesktopSession,
  EntityIdentity,
  EntityKind,
  HookInfo,
  PluginInfo,
  SessionDetail,
  SessionProject,
  SessionSummary,
  SettingsLayerInfo,
  SkillInfo
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import type { Collector } from './scan'
import type { MutationPlan } from './mutations'
import { capabilitiesFor, scopesFor } from './capabilities'
import { desktopSessions } from './desktop-store'
import { summarizeTranscript } from './jsonl'
import { toSessionProjects, toSessionSummaries, type SessionInventory } from './sessions'
import {
  hooksFromLayers,
  readSettingsLayers,
  scanPlugins,
  scanSkills,
  type PluginRecord,
  type SettingsLayer,
  type VerifiedProject
} from './user-store'

/**
 * The kind registry. Every entity kind kondo manages is described here —
 * how it is discovered, how one of its entities is read back from an id
 * (ADR-0008), what the capability matrix permits for it, and where its
 * enable/disable mutations will plug in. Nothing outside this module names
 * a store adapter; the workspace reaches every kind through `kinds`.
 *
 * `kinds` has one entry per *listing*, which is not quite one per kind:
 * code and desktop sessions share the `session` kind but live in different
 * stores (domain.md), so they are two entries the matrix keys apart by
 * scope.
 */

// ---------------------------------------------------------------------------
// The shared per-call context

/**
 * What every kind may read during one API call. The session inventory and
 * the verified projects come from the workspace's cache (ADR-0007); the
 * settings layers and the plugin manifest are read lazily and at most once,
 * so a kind that needs neither still costs no I/O.
 */
export interface KindContext {
  locator: StoreLocator
  /** Every kind in one pass reports into the same collector (ADR-0005). */
  c: Collector
  /** Wall clock for staleness, injected so tests can freeze it. */
  now: number
  inventory(): Promise<SessionInventory>
  projects(): Promise<VerifiedProject[]>
  layers(): Promise<SettingsLayer[]>
  plugins(): Promise<PluginRecord[]>
  /** Narrows `discover` to one parent entity's children, or null for all. */
  parentId: string | null
}

export interface KindContextSources {
  locator: StoreLocator
  c: Collector
  now: number
  inventory(): Promise<SessionInventory>
  projects(): Promise<VerifiedProject[]>
  parentId?: string | null
}

export function createKindContext(sources: KindContextSources): KindContext {
  let layers: Promise<SettingsLayer[]> | null = null
  let plugins: Promise<PluginRecord[]> | null = null

  const context: KindContext = {
    locator: sources.locator,
    c: sources.c,
    now: sources.now,
    inventory: sources.inventory,
    projects: sources.projects,
    layers: () =>
      (layers ??= (async () =>
        readSettingsLayers(sources.locator, await sources.projects(), sources.c))()),
    plugins: () =>
      (plugins ??= (async () =>
        scanPlugins(sources.locator, await context.layers(), sources.c))()),
    parentId: sources.parentId ?? null
  }
  return context
}

// ---------------------------------------------------------------------------
// What a kind is

export interface EntityKindDefinition<T extends EntityIdentity, D = T> {
  /** The first segment of every id this entry produces (ADR-0008). */
  kind: EntityKind
  /** The scopes the matrix is keyed on for this kind. */
  scopes: readonly string[]
  /**
   * Every entity this entry lists, narrowed to `context.parentId` when the
   * entry takes one. Null means that parent id did not resolve — the caller
   * turns it into the `unknown-id` error the UI offers a rescan for.
   */
  discover(context: KindContext): Promise<T[] | null>
  /** One entity by its id; null when the id does not resolve. */
  read(id: string, context: KindContext): Promise<D | null>
  /** The matrix row for one scope: permission, never a flag. */
  capabilities(scope: string): Capabilities
  /**
   * The store change that would enable (disable) one entity, or null when
   * there is none to make. The matrix is the gate: a kind returns null for
   * anything it refuses, so a refused operation never reaches a plan
   * (ADR-0006). Kinds whose mutation has not shipped return null always.
   */
  enable(entity: T): MutationPlan | null
  disable(entity: T): MutationPlan | null
}

/** A kind whose enable/disable has not shipped yet — the seat, unwired. */
const noPlanYet = {
  enable: (): MutationPlan | null => null,
  disable: (): MutationPlan | null => null
}

/** The ADR-0008 resolution every kind but `session` shares: find by id. */
async function findById<T extends EntityIdentity>(
  id: string,
  listing: Promise<T[] | null>
): Promise<T | null> {
  return ((await listing) ?? []).find((entity) => entity.id === id) ?? null
}

// ---------------------------------------------------------------------------
// The kinds

// Claude's own convention, and the whole of kondo's disable mechanism
// (ADR-0006): the two sibling directories a skill moves between.
const SKILLS = 'skills'
const SKILLS_DISABLED = 'skills.disabled'

/**
 * The store a skill lives in and the move that flips its state. The store is
 * `user` for the user scope and `project:<dirName>` for a project's — whose
 * root is that project's `.claude` directory, so a step can never address
 * anything above it (ADR-0002). Plugin-shipped skills have no placement:
 * they live inside their plugin's tree and follow it.
 */
function skillPlacement(entity: SkillInfo): { store: string; from: string; to: string } | null {
  // The id is `skill:<key>:<name>` by construction, so the key is exactly
  // what sits between — no split a ':' in a directory name could confuse.
  const key = entity.id.slice('skill:'.length, entity.id.length - entity.name.length - 1)
  const between = (store: string, disabled: boolean) => ({
    store,
    from: `${disabled ? SKILLS_DISABLED : SKILLS}/${entity.name}`,
    to: `${disabled ? SKILLS : SKILLS_DISABLED}/${entity.name}`
  })
  switch (entity.scope) {
    case 'user':
      return between('user', false)
    case 'user-disabled':
      return between('user', true)
    case 'project':
      return between(`project:${key.slice('project/'.length)}`, false)
    case 'project-disabled':
      return between(`project:${key.slice('project-disabled/'.length)}`, true)
    default:
      return null
  }
}

function skillPlan(entity: SkillInfo, operation: CapabilityOperation): MutationPlan | null {
  if (!entity.capabilities[operation].allowed) return null
  const placement = skillPlacement(entity)
  if (!placement) return null
  return {
    op: 'move',
    kind: 'skill',
    entityId: entity.id,
    summary: `${operation === 'enable' ? 'Enable' : 'Disable'} skill ${entity.name} (${entity.scope})`,
    steps: [{ type: 'move', ...placement }]
  }
}

const skill: EntityKindDefinition<SkillInfo> = {
  kind: 'skill',
  scopes: scopesFor('skill'),
  async discover(context) {
    // Order matters only for the collector: projects, then layers, then the
    // plugin manifest, then the skill trees under each of them.
    const projects = await context.projects()
    const plugins = await context.plugins()
    return scanSkills(context.locator, projects, plugins, context.c)
  },
  read(id, context) {
    return findById(id, skill.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('skill', scope),
  enable: (entity) => skillPlan(entity, 'enable'),
  disable: (entity) => skillPlan(entity, 'disable')
}

const plugin: EntityKindDefinition<PluginInfo> = {
  kind: 'plugin',
  scopes: scopesFor('plugin'),
  async discover(context) {
    return (await context.plugins()).map((record) => record.info)
  },
  read(id, context) {
    return findById(id, plugin.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('plugin', scope),
  ...noPlanYet
}

const hook: EntityKindDefinition<HookInfo> = {
  kind: 'hook',
  scopes: scopesFor('hook'),
  async discover(context) {
    return hooksFromLayers(await context.layers())
  },
  read(id, context) {
    return findById(id, hook.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('hook', scope),
  ...noPlanYet
}

const settings: EntityKindDefinition<SettingsLayerInfo> = {
  kind: 'settings',
  scopes: scopesFor('settings'),
  async discover(context) {
    return (await context.layers()).map((layer) => layer.info)
  },
  read(id, context) {
    return findById(id, settings.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('settings', scope),
  ...noPlanYet
}

const project: EntityKindDefinition<SessionProject> = {
  kind: 'project',
  scopes: scopesFor('project'),
  async discover(context) {
    return toSessionProjects(await context.inventory(), context.now)
  },
  read(id, context) {
    return findById(id, project.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('project', scope),
  ...noPlanYet
}

const PROJECT_PREFIX = 'project:code:'
const SESSION_PREFIX = 'session:code:'

const session: EntityKindDefinition<SessionSummary, SessionDetail> = {
  kind: 'session',
  // One store per entry, so these two split what `scopesFor('session')` holds.
  scopes: ['code'],
  /** Requires `context.parentId` — a `project:code:` id from a prior scan. */
  async discover(context) {
    const parentId = context.parentId
    if (parentId === null || !parentId.startsWith(PROJECT_PREFIX)) return null
    const record = (await context.inventory()).byDirName.get(
      parentId.slice(PROJECT_PREFIX.length)
    )
    return record ? toSessionSummaries(record, context.now) : null
  },
  /**
   * `session:code:<dirName>/<uuid>` → the transcript summary, streamed
   * (ADR-0007). The caller has already checked the id's shape; this only
   * resolves it against the cached inventory.
   */
  async read(id, context) {
    if (!id.startsWith(SESSION_PREFIX)) return null
    const key = id.slice(SESSION_PREFIX.length)
    const slash = key.lastIndexOf('/')
    if (slash <= 0) return null
    const uuid = key.slice(slash + 1).toLowerCase()
    const record = (await context.inventory()).byDirName
      .get(key.slice(0, slash))
      ?.sessions.find((candidate) => candidate.uuid === uuid)
    if (!record) return null
    return { id, ...(await summarizeTranscript(record.file)) }
  },
  capabilities: (scope) => capabilitiesFor('session', scope),
  ...noPlanYet
}

const desktopSession: EntityKindDefinition<DesktopSession> = {
  kind: 'session',
  scopes: ['desktop'],
  async discover(context) {
    return desktopSessions(context.locator, context.c)
  },
  read(id, context) {
    return findById(id, desktopSession.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('session', scope),
  ...noPlanYet
}

/**
 * The registry. Adding an entity kind means adding an entry here and a row
 * to the capability matrix — never a new branch in the workspace.
 */
export const kinds = {
  skill,
  plugin,
  hook,
  settings,
  project,
  session,
  desktopSession
} as const
