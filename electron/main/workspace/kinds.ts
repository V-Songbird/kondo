import path from 'node:path'
import type {
  CapabilityOperation,
  DesktopSession,
  EntityIdentity,
  EntityKind,
  HookInfo,
  McpServerInfo,
  MutateRequest,
  PlacedEntryInfo,
  PlacedKind,
  PluginInfo,
  PluginScopeState,
  ProjectPluginState,
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
import { applyEdits, digestSource, type MutationPlan, type PlannedStep, type SpliceEdit } from './mutations'
import { capabilitiesFor } from './capabilities'
import { tildify } from './display'
import { desktopSessions } from './desktop-store'
import { summarizeTranscript } from './jsonl'
import { toSessionProjects, toSessionSummaries, type SessionInventory } from './sessions'
import {
  clearEnabledPlugin,
  editEnabledPlugins,
  editMember,
  hooksFromLayers,
  newSettingsSource,
  pluginStateIn,
  readSettingsLayers,
  scanMcpServers,
  scanPlacedEntries,
  scanPluginSkills,
  scanConfigOrphans,
  scanPlugins,
  scanSkills,
  type ConfigOrphanRecord,
  type PluginRecord,
  type SettingsLayer,
  type VerifiedProject
} from './user-store'

/**
 * The kind registry. Every entity kind kondo manages is described here —
 * how it is discovered, how one of its entities is read back from an id
 * (ADR-0008), and how one request against it is planned. Nothing outside
 * this module names a store adapter; the workspace reaches every kind
 * through `kinds` and the `listings` table at the foot of the file.
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
  /**
   * Every skill of the user store and this call's projects, read at most
   * once — so a move plans its collision check against exactly the listing
   * the entity being moved came from.
   */
  skills(): Promise<SkillInfo[]>
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
  let skills: Promise<SkillInfo[]> | null = null

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
    skills: () =>
      (skills ??= (async () =>
        scanSkills(sources.locator, await sources.projects(), sources.c))()),
    parentId: sources.parentId ?? null
  }
  return context
}

// ---------------------------------------------------------------------------
// What a kind is

/**
 * What one mutation asks for, as the registry sees it — the seam's own
 * `MutateRequest`, unchanged, because nothing between the channel and the
 * kind needs to reshape it.
 */
export type PlanRequest = MutateRequest

/**
 * The store change one request would make, or the refusal that stands in its
 * place. A refusal keeps the reason the matrix gave it: nothing here
 * flattens "already enabled" and "plugin-shipped skills follow their plugin"
 * into one generic error (ADR-0006).
 */
export type PlanResult =
  | { ok: true; plan: MutationPlan }
  | { ok: false; code: ScanErrorCode; message: string }

export interface EntityKindDefinition<T extends EntityIdentity, D = T> {
  /** The first segment of every id this entry produces (ADR-0008). */
  kind: EntityKind
  /**
   * Every entity this entry lists, narrowed to `context.parentId` when the
   * entry takes one. Null means that parent id did not resolve — the caller
   * turns it into the `unknown-id` error the UI offers a rescan for.
   */
  discover(context: KindContext): Promise<T[] | null>
  /** One entity by its id; null when the id does not resolve. */
  read(id: string, context: KindContext): Promise<D | null>
  /**
   * The one mutation seat. Every operation goes through here, so adding one
   * costs a branch in the kinds that implement it and nothing at all in the
   * kinds that do not — no new seat, no new channel (ADR-0004).
   *
   * Planning never writes (ADR-0001), and the matrix is the gate (ADR-0006):
   * a kind refuses what Claude's conventions do not permit, in the matrix's
   * own words, before any step exists to run.
   */
  plan(entity: T, request: PlanRequest, context: KindContext): Promise<PlanResult>
}

function refused(code: ScanErrorCode, message: string): PlanResult {
  return { ok: false, code, message }
}

/**
 * The answer a kind gives a request it has no mechanism for: the matrix's
 * refusal, quoted. This is every kind whose mutation has not shipped and
 * every kind Claude offers no convention for — the seat is filled, and what
 * fills it is the reason.
 */
function matrixRefusal(
  kind: EntityKind,
  scope: string,
  op: CapabilityOperation
): PlanResult {
  const decision = capabilitiesFor(kind, scope)[op]
  return refused(
    'not-permitted',
    decision.reason ?? `kondo cannot ${op} this ${kind}.`
  )
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

function skillTogglePlan(entity: SkillInfo, operation: ToggleOperation): PlanResult {
  const decision = entity.capabilities[operation]
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? `kondo cannot ${operation} this skill.`
    )
  }
  const placement = skillPlacement(entity)
  if (!placement) {
    return refused('not-permitted', `kondo cannot tell what store ${entity.name} lives in.`)
  }
  return {
    ok: true,
    plan: {
      op: 'move',
      kind: 'skill',
      entityId: entity.id,
      summary: `${operation === 'enable' ? 'Enable' : 'Disable'} skill ${entity.name} (${entity.scope})`,
      steps: [{ type: 'move', ...placement }]
    }
  }
}

const skill: EntityKindDefinition<SkillInfo> = {
  kind: 'skill',
  // Only the user store and the verified projects: a skill shipped inside a
  // plugin is the plugin's, not the user's, so the plugin manifest is not
  // read here at all any more.
  discover(context) {
    return context.skills()
  },
  read(id, context) {
    return findById(id, skill.discover(context))
  },
  async plan(entity, request, context) {
    return request.op === 'move'
      ? skillMovePlan(entity, request.targetId ?? '', context)
      : skillTogglePlan(entity, request.op)
  }
}

const PLUGIN_PREFIX = 'plugin:'

const plugin: EntityKindDefinition<PluginInfo> = {
  kind: 'plugin',
  async discover(context) {
    return (await context.plugins()).map((record) => record.info)
  },
  read(id, context) {
    return findById(id, plugin.discover(context))
  },
  /**
   * A plugin is enabled or disabled *in a settings layer* (ADR-0006), never
   * on the plugin itself — which is exactly what `request.targetId` carries.
   * The old entity-level seats had nowhere to put it and stayed empty.
   */
  async plan(entity, request, context) {
    if (request.op === 'move') {
      return pluginMovePlan(
        entity,
        request.sourceId ?? '',
        request.targetId ?? '',
        request.confirm === true,
        context
      )
    }
    return pluginTogglePlan(
      entity,
      request.op,
      request.targetId ?? '',
      request.confirm === true,
      context
    )
  }
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
  // The `plugin` scope's matrix row refuses every operation (ADR-0006), so no
  // plan for one of these could ever be legitimate.
  async plan(_entity, request) {
    return matrixRefusal('skill', 'plugin', request.op)
  }
}

const hook: EntityKindDefinition<HookInfo> = {
  kind: 'hook',
  async discover(context) {
    return hooksFromLayers(await context.layers())
  },
  read(id, context) {
    return findById(id, hook.discover(context))
  },
  async plan(entity, request) {
    return matrixRefusal('hook', entity.layer, request.op)
  }
}

const settings: EntityKindDefinition<SettingsLayerInfo> = {
  kind: 'settings',
  async discover(context) {
    return (await context.layers()).map((layer) => layer.info)
  },
  read(id, context) {
    return findById(id, settings.discover(context))
  },
  async plan(entity, request) {
    return matrixRefusal('settings', entity.layer, request.op)
  }
}

const project: EntityKindDefinition<SessionProject> = {
  kind: 'project',
  async discover(context) {
    return toSessionProjects(await context.inventory(), context.now)
  },
  read(id, context) {
    return findById(id, project.discover(context))
  },
  async plan(_entity, request) {
    return matrixRefusal('project', 'code', request.op)
  }
}

const PROJECT_PREFIX = 'project:code:'
const SESSION_PREFIX = 'session:code:'
const DESKTOP_SESSION_PREFIX = 'session:desktop:'

const session: EntityKindDefinition<SessionSummary, SessionDetail> = {
  kind: 'session',
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
  // The one entry whose `read` answers a detail rather than the entity its
  // `plan` takes — which costs nothing, because nothing about a session is
  // mutable and this refuses without looking at what it was handed.
  async plan(_entity, request) {
    return matrixRefusal('session', 'code', request.op)
  }
}

/**
 * MCP servers, read-only in every scope. Discovery is tier-1 (ADR-0007): the
 * registry parse plus one `.mcp.json` per verified project, no walk of
 * anything. The matrix refuses enable, disable and move alike until entry 031
 * brings a write path that `~/.claude.json` can survive (ADR-0009), so the
 * seats below stay unwired on purpose.
 */
const mcp: EntityKindDefinition<McpServerInfo> = {
  kind: 'mcp',
  async discover(context) {
    return scanMcpServers(context.locator, await context.projects(), context.c)
  },
  read(id, context) {
    return findById(id, mcp.discover(context))
  },
  async plan(entity, request) {
    return matrixRefusal('mcp', entity.scope, request.op)
  }
}

/**
 * Agents, commands, rules and output styles: one definition shape, built four
 * times, because on disk the four differ only in the directory they sit in.
 * A factory rather than four literals — the near-copies would be identical
 * but for the kind they close over.
 *
 * Read-only in every scope. Claude loads these by presence and ships no
 * disable convention for them (ADR-0006), so every operation is refused in
 * the matrix's own words; `move` waits on entry 028.
 */
function placedKind(kind: PlacedKind): EntityKindDefinition<PlacedEntryInfo> {
  const definition: EntityKindDefinition<PlacedEntryInfo> = {
    kind,
    async discover(context) {
      return scanPlacedEntries(context.locator, kind, await context.projects(), context.c)
    },
    read(id, context) {
      return findById(id, definition.discover(context))
    },
    async plan(entity, request) {
      return matrixRefusal(kind, entity.scope, request.op)
    }
  }
  return definition
}

const desktopSession: EntityKindDefinition<DesktopSession> = {
  kind: 'session',
  async discover(context) {
    return desktopSessions(context.locator, context.c)
  },
  read(id, context) {
    return findById(id, desktopSession.discover(context))
  },
  async plan(_entity, request) {
    return matrixRefusal('session', 'desktop', request.op)
  }
}


// ---------------------------------------------------------------------------
// Moving a skill into another scope

/** The user scope has no key, so it names itself (ADR-0008 has no id for it). */
const USER_DESTINATION = 'user'

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
  if (!destinationId.startsWith(PROJECT_PREFIX)) return null
  const dirName = destinationId.slice(PROJECT_PREFIX.length)
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

/**
 * The refusal for a destination that names a project kondo knows about and
 * cannot write into, or null when the destination is fine as far as this
 * check goes. A project with no `.claude` is a real member of the project set
 * and still not a store (ADR-0002), so it is refused by name rather than
 * reported as an id nobody has heard of — the UI can say which directory
 * would have to exist first.
 */
async function storelessDestination(
  destinationId: string,
  context: KindContext
): Promise<string | null> {
  if (!destinationId.startsWith(PROJECT_PREFIX)) return null
  const record = (await context.inventory()).byDirName.get(
    destinationId.slice(PROJECT_PREFIX.length)
  )
  if (!record || record.hasStore) return null
  const where = record.guessedPath ?? record.dirName
  return `${where} has no .claude directory; create ${path.join(
    where,
    '.claude'
  )} before moving anything there.`
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
 *
 * `destinationId` is `'user'` or a `project:code:<dirName>` id from a
 * previous scan. The collision check reads `context.skills()`, so the plan is
 * answered from exactly the listing the entity was built from, and one scan
 * covers both of a scope's directories.
 */
async function skillMovePlan(
  entity: SkillInfo,
  destinationId: string,
  context: KindContext
): Promise<PlanResult> {
  const decision = entity.capabilities.move
  if (!decision.allowed) {
    return refused('not-permitted', decision.reason ?? 'kondo cannot move this skill.')
  }
  const placement = skillPlacement(entity)
  if (!placement) {
    return refused('not-permitted', `kondo cannot tell what store ${entity.name} lives in.`)
  }
  const storeless = await storelessDestination(destinationId, context)
  if (storeless !== null) return refused('bad-request', storeless)

  const target = await moveTarget(destinationId, context)
  if (target === null) {
    return refused(
      'unknown-id',
      `No scope with id "${destinationId}" in the current scan — rescan and retry.`
    )
  }
  if (target.store === placement.store) {
    return refused('bad-request', `${entity.name} is already in that scope.`)
  }

  // Both of the destination's directories count: a skill of this name sitting
  // in its `skills.disabled` is the same name arriving twice.
  const clash = (await context.skills()).find(
    (candidate) =>
      candidate.name === entity.name && skillPlacement(candidate)?.store === target.store
  )
  if (clash) {
    return refused(
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

/**
 * The store change that would enable or disable one plugin in one settings
 * layer. A plugin's enabled state is a key in a settings file rather than a
 * property of the plugin, so the layer travels as `request.targetId` — the
 * target the old entity-level seats had no room for.
 *
 * The matrix is still the gate (ADR-0006): permission is a lookup on the
 * layer the write would land in, never on the UI that offered the button.
 */
async function pluginTogglePlan(
  entity: PluginInfo,
  operation: ToggleOperation,
  layerId: string,
  createLayer: boolean,
  context: KindContext
): Promise<PlanResult> {
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

  const write = (content: string): PlanResult => ({
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

// ---------------------------------------------------------------------------
// Handing a plugin from one settings layer to another scope

/**
 * Which of a scope's layers receives the `true`: the highest-precedence one
 * that already states a value, else that scope's `settings.local.json`. The
 * same policy `projectPluginStates` picks a toggle's target by, so a plugin
 * arriving in a scope lands in the file that scope's own control writes —
 * and, like it, the renderer never chooses the file (ADR-0006).
 */
function destinationLayer(
  layers: SettingsLayer[],
  owner: string | null,
  key: string
): SettingsLayer | null {
  const mine = layers
    .filter((layer) => layer.info.projectId === owner)
    .sort((a, b) => SCOPE_ORDER[a.info.layer] - SCOPE_ORDER[b.info.layer])
  return (
    mine.find((layer) => pluginStateIn(layer, key) !== null) ??
    mine.find((layer) => layer.info.layer === 'local') ??
    mine[0] ??
    null
  )
}

/**
 * The store change that hands one plugin from one settings layer to another
 * scope: `false` where it was stated, `true` where it is going, as ONE plan
 * so ADR-0001's undo puts the pair back together or not at all.
 *
 * Two settings edits and not a relocation, because that is Claude's whole
 * convention for it (ADR-0006): nothing installed moves, and "on there, off
 * here" is said by `enabledPlugins` in two files. It reuses the single-layer
 * editor `pluginTogglePlan` writes with rather than a second one, and the
 * same `needs-confirmation` gate for a destination file that is not there.
 *
 * The destination is written first. Both steps are one journal entry either
 * way, but a run interrupted between them then leaves the plugin enabled in
 * both scopes rather than in neither — ADR-0001's order, that no intermediate
 * state loses the thing.
 *
 * `destinationId` is `'user'` or a `project:code:` id (ADR-0008), the same
 * vocabulary `skillMove` takes.
 */
async function pluginMovePlan(
  entity: PluginInfo,
  fromLayerId: string,
  destinationId: string,
  createLayer: boolean,
  context: KindContext
): Promise<PlanResult> {
  const layers = await context.layers()
  const from = layers.find((candidate) => candidate.info.id === fromLayerId)
  if (!from) {
    return refused(
      'unknown-id',
      `No settings layer with id "${fromLayerId}" in the current scan.`
    )
  }
  // The matrix gates the layer the plugin is leaving, which is where the
  // write that withdraws it lands (ADR-0006).
  const decision = capabilitiesFor('plugin', from.info.layer).move
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? 'kondo cannot move a plugin out of this layer.'
    )
  }
  const storeless = await storelessDestination(destinationId, context)
  if (storeless !== null) return refused('bad-request', storeless)

  const target = await moveTarget(destinationId, context)
  if (target === null) {
    return refused(
      'unknown-id',
      `No scope with id "${destinationId}" in the current scan — rescan and retry.`
    )
  }

  const key = entity.id.slice(PLUGIN_PREFIX.length)
  // Only a layer that actually enables the plugin has one to hand on. Writing
  // `false` where nothing said `true` states something new rather than moving
  // anything, and would read in the journal as a move that never happened.
  if (pluginStateIn(from, key) !== true) {
    return refused(
      'not-permitted',
      `${from.info.path} does not enable ${entity.name}; there is nothing to move.`
    )
  }

  const owner = destinationId === USER_DESTINATION ? null : destinationId
  const to = destinationLayer(layers, owner, key)
  if (to === null) {
    return refused('bad-request', `${target.label} has no settings file kondo can write.`)
  }
  if (to.info.id === from.info.id) {
    return refused('bad-request', `${entity.name} is already stated in ${to.info.path}.`)
  }
  if (pluginStateIn(to, key) === true) {
    return refused('not-permitted', `${to.info.path} already enables ${entity.name}.`)
  }

  let arriving: string
  if (!to.info.exists) {
    // The same gate the toggle has, and the only one: nothing licenses
    // conjuring a settings file, so this stops and asks and writes nothing.
    if (!createLayer) {
      return refused(
        'needs-confirmation',
        `${to.info.path} does not exist yet. Confirm to create it holding just this key.`
      )
    }
    arriving = newSettingsSource(key, true)
  } else {
    if (to.source === null || to.parsed === null) {
      return refused(
        'parse-failed',
        `${to.info.path} did not read back as a JSON object; kondo will not rewrite it.`
      )
    }
    const next = editEnabledPlugins(to.source, key, true)
    if (next === null) {
      return refused(
        'bad-request',
        `kondo cannot edit enabledPlugins in ${to.info.path} without reformatting it.`
      )
    }
    arriving = next
  }

  // The source states `true`, so its bytes read back — but the splice can
  // still decline a file it would have to reformat.
  const leaving = from.source === null ? null : editEnabledPlugins(from.source, key, false)
  if (leaving === null) {
    return refused(
      'bad-request',
      `kondo cannot edit enabledPlugins in ${from.info.path} without reformatting it.`
    )
  }

  return {
    ok: true,
    plan: {
      op: 'settings-edit',
      kind: 'plugin',
      entityId: entity.id,
      summary: `Move plugin ${entity.name} from ${from.info.path} to ${to.info.path}`,
      steps: [
        { type: 'write', store: to.store, at: to.relative, content: arriving },
        { type: 'write', store: from.store, at: from.relative, content: leaving }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Withdrawing a plugin statement, and the per-scope control it serves

export interface PluginClearRequest {
  entity: PluginInfo
  /** `settings:<layer>:<key>` — the layer whose statement goes away. */
  layerId: string
}

/**
 * The store change that takes one layer's statement about one plugin away,
 * leaving the layer above it to decide — the one direction the toggle cannot
 * express: writing `false` states a value, and only removing the member
 * withdraws one. It is not an `op` of `plan`, because `clear` is not one of
 * the three the capability matrix answers; it keeps its own channel until
 * the matrix grows a row for it.
 *
 * The matrix still gates it, on that layer's `disable` row: there is no
 * `clear` operation to look up, and unstating a plugin is a strictly smaller
 * change to the same key than stating one, so permission to write it covers
 * permission to unwrite it. Nothing here creates a file — a layer that is not
 * on disk already says nothing.
 */
export async function pluginClearPlan(
  request: PluginClearRequest,
  context: KindContext
): Promise<PlanResult> {
  const { entity, layerId } = request
  const layer = (await context.layers()).find((candidate) => candidate.info.id === layerId)
  if (!layer) {
    return refused('unknown-id', `No settings layer with id "${layerId}" in the current scan.`)
  }

  const decision = capabilitiesFor('plugin', layer.info.layer).disable
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? 'kondo cannot change a plugin in this layer.'
    )
  }

  const key = entity.id.slice(PLUGIN_PREFIX.length)
  if (!layer.info.exists || pluginStateIn(layer, key) === null) {
    return refused(
      'not-permitted',
      `${layer.info.path} already says nothing about ${entity.name}.`
    )
  }
  if (layer.source === null || layer.parsed === null) {
    return refused(
      'parse-failed',
      `${layer.info.path} did not read back as a JSON object; kondo will not rewrite it.`
    )
  }
  const next = clearEnabledPlugin(layer.source, key)
  if (next === null) {
    return refused(
      'bad-request',
      `kondo cannot edit enabledPlugins in ${layer.info.path} without reformatting it.`
    )
  }
  return {
    ok: true,
    plan: {
      op: 'settings-edit',
      kind: 'plugin',
      entityId: entity.id,
      summary: `Stop stating plugin ${entity.name} in ${layer.info.path}`,
      steps: [{ type: 'write', store: layer.store, at: layer.relative, content: next }]
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration orphans (ADR-0010)

/**
 * Every configuration member nothing stands behind, gathered from one call's
 * context. Both the preview and the removal go through here, so the set a
 * user confirmed is the set a splice takes out.
 *
 * Tier-2 on purpose (ADR-0007). `skillOverrides` reaches plugin-shipped
 * skills (domain.md), so a name is only an orphan once every installed
 * plugin's own skills have been looked at — work an explicit preview pays
 * for and no listing does.
 */
export async function configOrphans(context: KindContext): Promise<ConfigOrphanRecord[]> {
  const [layers, plugins, inventory] = await Promise.all([
    context.layers(),
    context.plugins(),
    context.inventory()
  ])
  const [own, shipped] = await Promise.all([
    context.skills(),
    Promise.all(plugins.map((record) => scanPluginSkills(context.locator, record, context.c)))
  ])
  return scanConfigOrphans(
    context.locator,
    {
      layers,
      plugins,
      skillNames: new Set([...own, ...shipped.flat()].map((entry) => entry.name)),
      // The inventory already stat'd every project (ADR-0009), so calling an
      // entry dead costs nothing here.
      pathExists: new Map(
        [...inventory.byDirName].map(([dirName, record]) => [dirName, record.pathExists])
      )
    },
    context.c
  )
}

export type ConfigOrphansPlan =
  | { ok: true; plan: MutationPlan | null }
  | { ok: false; code: ScanErrorCode; message: string }

/**
 * The one entry removing configuration orphans is. Every chosen member of one
 * file becomes an edit in that file's single `splice` step, and every file's
 * step goes into one journal entry — so a single undo puts the whole removal
 * back (ADR-0001), and only the spans holding those members ever differ
 * (ADR-0010).
 *
 * Null when nothing is left to remove: an empty choice is the ordinary answer
 * on a tidy machine, not an error, and it writes no journal entry.
 */
export function configOrphansPlan(
  orphans: readonly ConfigOrphanRecord[],
  chosen: readonly string[]
): ConfigOrphansPlan {
  const wanted = new Set(chosen)
  const picked = orphans.filter((record) => wanted.has(record.info.id))
  const found = new Set(picked.map((record) => record.info.id))
  const missing = [...wanted].find((id) => !found.has(id))
  if (missing !== undefined) {
    return {
      ok: false,
      code: 'unknown-id',
      message: `No configuration orphan with id "${missing}" in the current scan.`
    }
  }

  // Removing a dead project entry removes the MCP servers declared inside it,
  // so choosing both is choosing the entry: the wider member covers the
  // narrower one rather than two edits reaching for the same bytes.
  const covered = (record: ConfigOrphanRecord): boolean =>
    picked.some(
      (other) =>
        other !== record &&
        other.store === record.store &&
        other.relative === record.relative &&
        other.keyPath.length < record.keyPath.length &&
        other.keyPath.every((segment, at) => record.keyPath[at] === segment)
    )

  const byFile = new Map<string, ConfigOrphanRecord[]>()
  for (const record of picked) {
    if (covered(record)) continue
    const file = `${record.store}/${record.relative}`
    byFile.set(file, [...(byFile.get(file) ?? []), record])
  }
  if (byFile.size === 0) return { ok: true, plan: null }

  let count = 0
  const steps: PlannedStep[] = []
  for (const group of byFile.values()) {
    const first = group[0] as ConfigOrphanRecord
    let text = first.source
    const edits: SpliceEdit[] = []
    for (const record of group) {
      // Measured against the text the edits before it produced, so two
      // members that sat side by side both come out cleanly (ADR-0010).
      const edit = editMember(text, record.keyPath, null)
      const next = edit === null ? null : applyEdits(text, [edit])
      if (edit === null || next === null) {
        return {
          ok: false,
          code: 'bad-request',
          message: `kondo cannot remove ${record.info.name} from ${record.info.source} without reformatting it.`
        }
      }
      edits.push(edit)
      text = next
      count++
    }
    steps.push({
      type: 'splice',
      store: first.store,
      at: first.relative,
      expectDigest: digestSource(first.source),
      edits
    })
  }

  return {
    ok: true,
    plan: {
      op: 'settings-edit',
      // A removal spans the registry and any number of settings layers, so no
      // single entity below the store is the thing it changed (ADR-0008).
      kind: 'store',
      entityId: 'store:user',
      summary: `Remove ${count} configuration orphan${count === 1 ? '' : 's'} from ${
        byFile.size
      } file${byFile.size === 1 ? '' : 's'}`,
      steps
    }
  }
}

/** domain.md's precedence order, so the highest-ranked layer comes first. */
const SCOPE_ORDER: Record<PluginScopeState['layer'], number> = {
  local: 0,
  project: 1,
  user: 2
}

/**
 * Every installed plugin as one scope sees it: which position the control is
 * in, what actually stands, and which file a change would land in.
 *
 * The policy in one line — the write goes to the highest-precedence layer of
 * this scope that *already states a value*, and to this scope's
 * `settings.local.json` when none does. A user who has already said something
 * in `settings.json` expects the next click to change that statement rather
 * than shadow it from a file they never opened; a user who has said nothing
 * gets the private layer, which cannot surprise a teammate.
 *
 * `owner` is a `project:code:` id or null for the user scope, and the layers
 * are matched on `PluginScopeState.projectId` — the join is a field, never a
 * parsed id (ADR-0008). A scope with no settings layer of its own — a project
 * with no `.claude` — yields nothing rather than a control pointed at
 * somebody else's file.
 */
export function projectPluginStates(
  plugins: PluginInfo[],
  owner: string | null
): ProjectPluginState[] {
  const states: ProjectPluginState[] = []
  for (const plugin of plugins) {
    // A ghost row is a key with no plugin behind it, so it has no three-way
    // control to offer: there is nothing to turn on. It stays in
    // `pluginsList`, where it says what the layer states, and the way to act
    // on it is `configOrphansPreview` (ADR-0010).
    if (!plugin.installed) continue
    const mine = plugin.scopes
      .filter((scope) => scope.projectId === owner)
      .sort((a, b) => SCOPE_ORDER[a.layer] - SCOPE_ORDER[b.layer])
    const stated = mine.find((scope) => scope.enabled !== null)
    const target = stated ?? mine.find((scope) => scope.layer === 'local') ?? mine[0]
    if (!target) continue
    const effective = plugin.effectiveIn.find((entry) => entry.projectId === owner) ?? null
    states.push({
      pluginId: plugin.id,
      name: plugin.name,
      marketplace: plugin.marketplace,
      choice: stated === undefined ? 'inherit' : stated.enabled ? 'on' : 'off',
      effective: effective?.enabled ?? null,
      effectiveLayerId: effective?.layerId ?? null,
      targetLayerId: target.layerId,
      capabilities: target.capabilities,
      scopes: mine
    })
  }
  return states
}

/**
 * The registry. Adding an entity kind means adding an entry here, a row in
 * `listings` below, and a row in the capability matrix — never a new branch
 * in the workspace, and never a new channel.
 */
export const kinds = {
  skill,
  plugin,
  pluginSkill,
  hook,
  settings,
  project,
  session,
  desktopSession,
  mcp,
  agent: placedKind('agent'),
  command: placedKind('command'),
  rule: placedKind('rule'),
  outputStyle: placedKind('output-style')
} as const

// ---------------------------------------------------------------------------
// Dispatch: from one id, or one kind, to the entry that serves it

/**
 * A registry entry with the entity type erased, so a single dispatcher can
 * serve every kind. `read` and `plan` on any one row are the *same* entry's,
 * so what the first returns is what the second expects — the one fact this
 * view cannot state, and the only reason its caller casts between them.
 */
export interface AnyKind {
  kind: EntityKind
  discover(context: KindContext): Promise<EntityIdentity[] | null>
  read(id: string, context: KindContext): Promise<unknown>
  plan(entity: never, request: PlanRequest, context: KindContext): Promise<PlanResult>
}

/**
 * One row per *listing*, which is not quite one per kind: code and desktop
 * sessions share the `session` kind but live in different stores (domain.md),
 * and a plugin's own skills are a second `skill` listing keyed on the plugin.
 * Each row carries the id prefix its entities answer to (ADR-0008) and the
 * parent id its `discover` requires, or null when it takes none.
 */
export interface Listing {
  idPrefix: string
  kind: EntityKind
  parent: string | null
  definition: AnyKind
}

const SKILL_PREFIX = 'skill:'
/** A plugin-shipped skill's id, by construction in `scanPluginSkills`. */
const PLUGIN_SKILL_PREFIX = 'skill:plugin/'

export const listings: readonly Listing[] = [
  { idPrefix: PLUGIN_SKILL_PREFIX, kind: 'skill', parent: PLUGIN_PREFIX, definition: kinds.pluginSkill },
  { idPrefix: SKILL_PREFIX, kind: 'skill', parent: null, definition: kinds.skill },
  { idPrefix: PLUGIN_PREFIX, kind: 'plugin', parent: null, definition: kinds.plugin },
  { idPrefix: 'hook:', kind: 'hook', parent: null, definition: kinds.hook },
  { idPrefix: 'settings:', kind: 'settings', parent: null, definition: kinds.settings },
  { idPrefix: PROJECT_PREFIX, kind: 'project', parent: null, definition: kinds.project },
  { idPrefix: SESSION_PREFIX, kind: 'session', parent: PROJECT_PREFIX, definition: kinds.session },
  { idPrefix: DESKTOP_SESSION_PREFIX, kind: 'session', parent: null, definition: kinds.desktopSession },
  { idPrefix: 'mcp:', kind: 'mcp', parent: null, definition: kinds.mcp },
  { idPrefix: 'agent:', kind: 'agent', parent: null, definition: kinds.agent },
  { idPrefix: 'command:', kind: 'command', parent: null, definition: kinds.command },
  { idPrefix: 'rule:', kind: 'rule', parent: null, definition: kinds.rule },
  { idPrefix: 'output-style:', kind: 'output-style', parent: null, definition: kinds.outputStyle }
]

/**
 * The listing that owns one id, by its longest matching prefix — so
 * `skill:plugin/…` reaches the plugin's own listing and not the user's, and
 * `session:desktop:…` reaches the desktop store. Reading a prefix is the main
 * process's business; the renderer hands back the id it was given (ADR-0008).
 *
 * Null for an id no kind claims, which the caller reports as a bad request:
 * it is a kondo bug, never something a store could produce.
 */
export function listingForId(entityId: string): Listing | null {
  let best: Listing | null = null
  for (const listing of listings) {
    if (!entityId.startsWith(listing.idPrefix)) continue
    if (best === null || listing.idPrefix.length > best.idPrefix.length) best = listing
  }
  return best
}

/**
 * The listing for one kind: the child listing when a parent id of the right
 * shape is given, the parentless one otherwise. Null when the kind has no
 * listing, or when the parent id is not one this kind's children hang off.
 */
export function listingFor(kind: EntityKind, parentId?: string): Listing | null {
  return (
    listings.find(
      (listing) =>
        listing.kind === kind &&
        (listing.parent === null
          ? parentId === undefined
          : parentId !== undefined && parentId.startsWith(listing.parent))
    ) ?? null
  )
}
