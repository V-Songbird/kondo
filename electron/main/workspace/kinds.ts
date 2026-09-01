import path from 'node:path'
import type {
  Capabilities,
  DesktopSession,
  EntityIdentity,
  EntityKind,
  HookInfo,
  PluginInfo,
  SessionDetail,
  SessionProject,
  SessionSummary,
  SettingsLayerInfo,
  SkillInfo,
  ScanErrorCode,
  ToggleOperation
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import type { Collector } from './scan'
import type { MutationPlan } from './mutations'
import { capabilitiesFor, scopesFor } from './capabilities'
import { tildify } from './display'
import { desktopSessions } from './desktop-store'
import { summarizeTranscript } from './jsonl'
import { toSessionProjects, toSessionSummaries, type SessionInventory } from './sessions'
import {
  editEnabledPlugins,
  hooksFromLayers,
  newSettingsSource,
  pluginStateIn,
  readSettingsLayers,
  scanPluginSkills,
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

function skillPlan(entity: SkillInfo, operation: ToggleOperation): MutationPlan | null {
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
    // Only the user store and the verified projects: a skill shipped inside a
    // plugin is the plugin's, not the user's, so the plugin manifest is not
    // read here at all any more.
    return scanSkills(context.locator, await context.projects(), context.c)
  },
  read(id, context) {
    return findById(id, skill.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('skill', scope),
  enable: (entity) => skillPlan(entity, 'enable'),
  disable: (entity) => skillPlan(entity, 'disable')
}

const PLUGIN_PREFIX = 'plugin:'

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
  // A plugin is enabled or disabled *in a settings layer* (ADR-0006), so the
  // entity-level seat has no target to act on and stays empty. The per-layer
  // plan is `pluginTogglePlan` at the foot of this module.
  ...noPlanYet
}

/**
 * The skills one plugin ships, listed under the plugin that owns them. A
 * child listing rather than a field on `PluginInfo`: reading a skill means
 * reading its `SKILL.md`, so it happens for the one plugin a caller named and
 * not for every row of the plugins view (ADR-0007).
 *
 * Its own registry entry rather than a branch in `skill`, because the two
 * differ in everything but kind: this one is keyed on a parent id, covers the
 * one scope the matrix refuses outright, and has no toggle to seat. A plugin
 * that ships none answers with an empty list, which is not an error.
 */
const pluginSkill: EntityKindDefinition<SkillInfo> = {
  kind: 'skill',
  // The one scope `skill` above never produces; `scopesFor` holds both.
  scopes: ['plugin'],
  /** Requires `context.parentId` — a `plugin:` id from a prior scan. */
  async discover(context) {
    const parentId = context.parentId
    if (parentId === null || !parentId.startsWith(PLUGIN_PREFIX)) return null
    const record = (await context.plugins()).find(
      (candidate) => candidate.info.id === parentId
    )
    if (!record) return null
    return scanPluginSkills(context.locator, record, context.c)
  },
  read(id, context) {
    return findById(id, pluginSkill.discover(context))
  },
  capabilities: (scope) => capabilitiesFor('skill', scope),
  // Nothing to seat: the `plugin` scope's matrix row refuses every operation
  // (ADR-0006), so no plan for one of these could ever be legitimate.
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


// ---------------------------------------------------------------------------
// Moving a skill into another scope

/** Why a skill move produced no plan, in the seam's own vocabulary. */
export type SkillMovePlan =
  | { ok: true; plan: MutationPlan }
  | { ok: false; code: ScanErrorCode; message: string }

export interface SkillMoveRequest {
  entity: SkillInfo
  /** `'user'`, or a `project:code:<dirName>` id from a previous scan. */
  destinationId: string
  /**
   * Every skill the same scan listed. The collision check reads this rather
   * than the disk, so the plan is answered from exactly the bytes the entity
   * was built from — and one scan covers both of a scope's directories.
   */
  all: SkillInfo[]
}

/** The user scope has no key, so it names itself (ADR-0008 has no id for it). */
const USER_DESTINATION = 'user'
const PROJECT_ID_PREFIX = 'project:code:'

/** Where a move would land: the store to write into, and how to say it. */
interface MoveTarget {
  store: string
  label: string
}

async function moveTarget(
  destinationId: string,
  context: KindContext
): Promise<MoveTarget | null> {
  if (destinationId === USER_DESTINATION) {
    return { store: 'user', label: tildify(context.locator.userRoot, context.locator.home) }
  }
  if (!destinationId.startsWith(PROJECT_ID_PREFIX)) return null
  const dirName = destinationId.slice(PROJECT_ID_PREFIX.length)
  // Only a *verified* project is a store: `mutations` resolves the same list,
  // so a destination that plans here always resolves when it runs (ADR-0002 —
  // the store is the project's `.claude`, never the project itself).
  const project = (await context.projects()).find((candidate) => candidate.dirName === dirName)
  if (!project) return null
  return {
    store: `project:${dirName}`,
    label: tildify(path.join(project.absPath, '.claude'), context.locator.home)
  }
}

function moveRefused(code: ScanErrorCode, message: string): SkillMovePlan {
  return { ok: false, code, message }
}

/**
 * The store change that moves one skill into another scope: copy it, prove
 * the copy, then trash the original — one plan, so `undo` reverses the whole
 * thing or none of it (ADR-0001). The order is the invariant, and it lives in
 * the step list rather than in a caller's sequencing.
 *
 * The matrix is the gate (ADR-0006): a plugin-shipped skill is refused here,
 * not in the UI. A destination scope that already holds the name is refused
 * too — merging two skill directories would silently mix their files.
 */
export async function skillMovePlan(
  request: SkillMoveRequest,
  context: KindContext
): Promise<SkillMovePlan> {
  const { entity, destinationId, all } = request

  const decision = entity.capabilities.move
  if (!decision.allowed) {
    return moveRefused('not-permitted', decision.reason ?? 'kondo cannot move this skill.')
  }
  const placement = skillPlacement(entity)
  if (!placement) {
    return moveRefused('not-permitted', `kondo cannot tell what store ${entity.name} lives in.`)
  }
  const target = await moveTarget(destinationId, context)
  if (target === null) {
    return moveRefused(
      'unknown-id',
      `No scope with id "${destinationId}" in the current scan — rescan and retry.`
    )
  }
  if (target.store === placement.store) {
    return moveRefused('bad-request', `${entity.name} is already in that scope.`)
  }

  // Both of the destination's directories count: a skill of this name sitting
  // in its `skills.disabled` is the same name arriving twice.
  const clash = all.find(
    (candidate) =>
      candidate.name === entity.name && skillPlacement(candidate)?.store === target.store
  )
  if (clash) {
    return moveRefused(
      'bad-request',
      `${target.label} already holds a skill named ${entity.name} (${clash.origin}); kondo will not merge the two.`
    )
  }

  // ADR-0006: the skill's state travels with it, so a benched skill lands in
  // the destination's `skills.disabled` and stays benched.
  const to = `${entity.enabled ? SKILLS : SKILLS_DISABLED}/${entity.name}`
  return {
    ok: true,
    plan: {
      op: 'move',
      kind: 'skill',
      entityId: entity.id,
      summary: `Move skill ${entity.name} from ${entity.origin} to ${target.label}`,
      steps: [
        { type: 'copy', store: placement.store, from: placement.from, toStore: target.store, to },
        { type: 'trash', store: placement.store, from: placement.from }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Toggling a plugin in one settings layer

/** Why a plugin toggle produced no plan, in the seam's own vocabulary. */
export type PluginTogglePlan =
  | { ok: true; plan: MutationPlan }
  | { ok: false; code: ScanErrorCode; message: string }

export interface PluginToggleRequest {
  entity: PluginInfo
  /** `settings:<layer>:<key>` — the layer the user picked. */
  layerId: string
  operation: ToggleOperation
  /** The user has confirmed creating a settings file that is not there yet. */
  createLayer: boolean
}

function refused(code: ScanErrorCode, message: string): PluginTogglePlan {
  return { ok: false, code, message }
}

/**
 * The store change that would enable or disable one plugin in one settings
 * layer. A plugin's enabled state is a key in a settings file rather than a
 * property of the plugin, so the entity-level `enable` / `disable` seats
 * cannot name a target — this takes the layer alongside the entity.
 *
 * The matrix is still the gate (ADR-0006): permission is a lookup on the
 * layer the write would land in, never on the UI that offered the button.
 */
export async function pluginTogglePlan(
  request: PluginToggleRequest,
  context: KindContext
): Promise<PluginTogglePlan> {
  const { entity, layerId, operation, createLayer } = request
  const layer = (await context.layers()).find((candidate) => candidate.info.id === layerId)
  if (!layer) {
    return refused('unknown-id', `No settings layer with id "${layerId}" in the current scan.`)
  }

  const decision = capabilitiesFor('plugin', layer.info.layer)[operation]
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? `kondo cannot ${operation} a plugin in this layer.`
    )
  }

  const key = entity.id.slice(PLUGIN_PREFIX.length)
  const enabled = operation === 'enable'
  if (pluginStateIn(layer, key) === enabled) {
    return refused(
      'not-permitted',
      `${layer.info.path} already ${enabled ? 'enables' : 'disables'} ${entity.name}.`
    )
  }

  const write = (content: string): PluginTogglePlan => ({
    ok: true,
    plan: {
      op: 'settings-edit',
      kind: 'plugin',
      entityId: entity.id,
      summary: `${enabled ? 'Enable' : 'Disable'} plugin ${entity.name} in ${layer.info.path}`,
      steps: [{ type: 'write', store: layer.store, at: layer.relative, content }]
    }
  })

  if (!layer.info.exists) {
    // Nothing licenses conjuring a settings file out of a toggle: this stops
    // and asks, and writes not one byte until it is told to.
    if (!createLayer) {
      return refused(
        'needs-confirmation',
        `${layer.info.path} does not exist yet. Confirm to create it holding just this key.`
      )
    }
    return write(newSettingsSource(key, enabled))
  }
  if (layer.source === null || layer.parsed === null) {
    return refused(
      'parse-failed',
      `${layer.info.path} did not read back as a JSON object; kondo will not rewrite it.`
    )
  }
  const next = editEnabledPlugins(layer.source, key, enabled)
  if (next === null) {
    return refused(
      'bad-request',
      `kondo cannot edit enabledPlugins in ${layer.info.path} without reformatting it.`
    )
  }
  return write(next)
}

/**
 * The registry. Adding an entity kind means adding an entry here and a row
 * to the capability matrix — never a new branch in the workspace.
 */
export const kinds = {
  skill,
  plugin,
  pluginSkill,
  hook,
  settings,
  project,
  session,
  desktopSession
} as const
