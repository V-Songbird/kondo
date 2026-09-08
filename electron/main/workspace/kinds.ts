import fs from 'node:fs/promises'
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
  SessionDuplicateGroup,
  SessionProject,
  SessionSummary,
  SettingsLayerInfo,
  SkillDuplicate,
  SkillDuplicateGroup,
  SkillInfo,
  ScanErrorCode,
  ToggleOperation
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { digestTree, mapPool, relativeTo, resolveAllowedPath, type Collector } from './scan'
import {
  applyEdits,
  digestSource,
  USER_CONFIG_STORE,
  type MutationPlan,
  type PlannedStep,
  type SpliceEdit
} from './mutations'
import { flattenProjectPath } from './projects'
import { capabilitiesFor, inheritedSkillCapabilities } from './capabilities'
import { slashed, tildify } from './display'
import { desktopSessions, desktopSessionStems } from './desktop-store'
import { readFirstUserPrompt, summarizeTranscript } from './jsonl'
import { openScanCache } from './scan-cache'
import { toSessionProjects, toSessionSummaries, type SessionInventory } from './sessions'
import {
  clearEnabledPlugin,
  editEnabledPlugins,
  editMember,
  hooksFromLayers,
  newSettingsSource,
  overrideChain,
  PLACEMENTS,
  pluginStateIn,
  projectLayers,
  resolveSkillOverride,
  asObject,
  SKILL_OVERRIDES,
  skillOverrideIn,
  spliceMember,
  stringSet,
  readSettingsLayers,
  scanMcpServers,
  scanPlacedEntries,
  scanPluginSkills,
  scanConfigOrphans,
  scanPlugins,
  scanSkills,
  scanSkillUsage,
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
  /**
   * The skill names Claude's own `skillUsage` record has counted a use of,
   * read at most once — a listing and a duplicate group both ask, and the
   * registry is opened for the pair of them.
   */
  skillUsage(): Promise<ReadonlySet<string> | null>
  /**
   * The session ids the desktop store holds, read at most once — the join
   * behind `SessionSummary.mirroredIn`. Readdir only, so a listing that asks
   * for it is still tier-1 (ADR-0007).
   */
  desktopStems(): Promise<ReadonlySet<string>>
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
  let usage: Promise<ReadonlySet<string> | null> | null = null
  let stems: Promise<ReadonlySet<string>> | null = null

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
    // The settings layers come first: a skill's effective state is the
    // directory it sits in *and* what `skillOverrides` says about it
    // (ADR-0006), so the listing cannot be built without them. They are the
    // same cached read every other kind uses, so this costs no extra I/O.
    skills: () =>
      (skills ??= (async () =>
        scanSkills(
          sources.locator,
          await sources.projects(),
          await context.layers(),
          await context.skillUsage(),
          sources.c
        ))()),
    skillUsage: () => (usage ??= scanSkillUsage(sources.locator, sources.c)),
    desktopStems: () => (stems ??= desktopSessionStems(sources.locator, sources.c)),
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

/**
 * The kinds whose entries sit at a known place inside a store — the skill
 * directory and the four hand-placed markdown kinds. `PLACEMENTS` in
 * `user-store.ts` is the one table that says where; nothing here spells a
 * directory name of its own.
 */
type PlacedishKind = keyof typeof PLACEMENTS

/** Where one entity sits: the store it is in, and its path inside it. */
interface Placement {
  store: string
  at: string
}

/**
 * Where one entity lives, read off the placement table every listing is built
 * from. The store is `user` for the user scope and `project:<dirName>` for a
 * project's — whose root is that project's `.claude` directory, so a step can
 * never address anything above it (ADR-0002).
 *
 * Null for an entity with no placement of its own: a plugin-shipped skill
 * lives inside its plugin's tree and follows it, and a kind with no bench has
 * no benched scope to resolve.
 */
function placementOf(
  kind: PlacedishKind,
  entity: { id: string; name: string; scope: string }
): Placement | null {
  const rule = PLACEMENTS[kind]
  // The id is `<kind>:<key>:<name>` by construction, so the key is exactly
  // what sits between — no split a ':' in a directory name could confuse.
  const key = entity.id.slice(kind.length + 1, entity.id.length - entity.name.length - 1)
  const benched = entity.scope === 'user-disabled' || entity.scope === 'project-disabled'
  const dir = benched ? rule.benched : rule.dir
  if (dir === null) return null
  const at = `${dir}/${entity.name}${rule.suffix}`
  if (entity.scope === 'user' || entity.scope === 'user-disabled') {
    return { store: 'user', at }
  }
  if (entity.scope === 'project' || entity.scope === 'project-disabled') {
    // Both project keys are `<scope>/<dirName>`, so the scope's own length
    // is what the directory name starts after.
    return { store: `project:${key.slice(entity.scope.length + 1)}`, at }
  }
  return null
}

/**
 * The other side of the bench: where a toggle in this direction would land
 * a skill (ADR-0006 — `skills.disabled/` is Claude's convention, and the
 * placement table is the only place it is spelled). Null for a kind with no
 * bench, which is every kind but `skill`.
 */
function benchTarget(entity: SkillInfo, operation: ToggleOperation): string | null {
  const rule = PLACEMENTS.skill
  const dir = operation === 'enable' ? rule.dir : rule.benched
  return dir === null ? null : `${dir}/${entity.name}${rule.suffix}`
}

/**
 * Leaving the bench. `skills.disabled/` is kondo's own parking spot, not a
 * convention Claude reads (ADR-0006, settled 2026-09-03), so nothing new is
 * ever put there — but a skill already sitting in it stays readable as the
 * `*-disabled` scope, and the one thing to offer it is the way back into
 * `skills/`, which is the move this has always been.
 */
function benchReturnPlan(entity: SkillInfo): PlanResult {
  const placement = placementOf('skill', entity)
  const to = benchTarget(entity, 'enable')
  if (placement === null || to === null) {
    return refused('not-permitted', `kondo cannot tell what store ${entity.name} lives in.`)
  }
  return {
    ok: true,
    plan: {
      op: 'move',
      kind: 'skill',
      entityId: entity.id,
      summary: `Enable skill ${entity.name} (${entity.scope}): back into skills/`,
      steps: [{ type: 'move', store: placement.store, from: placement.at, to }]
    }
  }
}

/**
 * The store change behind a skill toggle, in Claude's own words (ADR-0006):
 * `skillOverrides[<name>] = "off"` in a settings layer of the skill's scope
 * disables it, and taking that member away enables it again — a statement
 * withdrawn rather than an `"on"` stated, the way `pluginClearPlan` clears a
 * plugin. Both are the same splice `enabledPlugins` uses, so every other key
 * in the file keeps its bytes.
 *
 * Which file: for a disable, the highest-precedence layer of the scope that
 * already speaks about this skill, else that scope's `settings.local.json` —
 * the file Claude's own `/skills` writes — and for the user scope the one
 * user layer. A layer that is not on disk is asked about first
 * (`needs-confirmation`), as the plugin toggle does. For an enable, every
 * layer in the skill's chain that says `off` loses that member in ONE plan,
 * so the skill actually comes back on and one undo puts every statement back.
 */
async function skillTogglePlan(
  entity: SkillInfo,
  operation: ToggleOperation,
  confirm: boolean,
  context: KindContext
): Promise<PlanResult> {
  const decision = entity.capabilities[operation]
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? `kondo cannot ${operation} this skill.`
    )
  }
  if (entity.scope === 'user-disabled' || entity.scope === 'project-disabled') {
    return benchReturnPlan(entity)
  }

  const layers = await context.layers()
  const keyPath = [SKILL_OVERRIDES, entity.name]
  const write = (layer: SettingsLayer, content: string): PlannedStep => ({
    type: 'write',
    store: layer.store,
    at: layer.relative,
    content
  })
  // A layer already on disk is edited under ADR-0010's guard: the digest of
  // the bytes this was planned against rides with the edit, and the apply
  // refuses rather than overwriting a file someone else has since rewritten.
  const splice = (layer: SettingsLayer, source: string, edit: SpliceEdit): PlannedStep => ({
    type: 'splice',
    store: layer.store,
    at: layer.relative,
    expectDigest: digestSource(source),
    edits: [edit]
  })
  const unreadable = (layer: SettingsLayer): PlanResult =>
    refused(
      'parse-failed',
      `${layer.info.path} did not read back as a JSON object; kondo will not rewrite it.`
    )
  const unsplicable = (layer: SettingsLayer): PlanResult =>
    refused(
      'bad-request',
      `kondo cannot edit skillOverrides in ${layer.info.path} without reformatting it.`
    )

  if (operation === 'disable') {
    const layer = destinationLayer(
      layers,
      entity.projectId,
      (candidate) => skillOverrideIn(candidate, entity.name) !== null
    )
    if (!layer) {
      return refused('not-permitted', `No settings layer speaks for ${entity.name}'s scope.`)
    }
    const summary = `Disable skill ${entity.name} (${entity.scope}) in ${layer.info.path}`
    if (!layer.info.exists) {
      if (!confirm) {
        return refused(
          'needs-confirmation',
          `${layer.info.path} does not exist yet. Confirm to create it holding just this key.`
        )
      }
      const fresh = spliceMember('{}\n', keyPath, '"off"')
      if (fresh === null) return unsplicable(layer)
      return settingsEdit(entity, summary, [write(layer, fresh)])
    }
    if (layer.source === null || layer.parsed === null) return unreadable(layer)
    const edit = editMember(layer.source, keyPath, '"off"')
    if (edit === null) return unsplicable(layer)
    return settingsEdit(entity, summary, [splice(layer, layer.source, edit)])
  }

  const steps: PlannedStep[] = []
  const cleared: string[] = []
  for (const layer of overrideChain(layers, entity.projectId)) {
    if (skillOverrideIn(layer, entity.name) !== 'off') continue
    if (layer.source === null || layer.parsed === null) return unreadable(layer)
    const edit = editMember(layer.source, keyPath, null)
    if (edit === null) return unsplicable(layer)
    steps.push(splice(layer, layer.source, edit))
    cleared.push(layer.info.path)
  }
  if (steps.length === 0) {
    return refused('not-permitted', `No settings layer switches ${entity.name} off.`)
  }
  return settingsEdit(
    entity,
    `Enable skill ${entity.name} (${entity.scope}): stop switching it off in ${cleared.join(', ')}`,
    steps
  )
}

/**
 * "Off here" / "follows global" for a global skill on one project's page
 * (entry 062): `skillOverrides[<name>] = "off"` into that project's layer —
 * the one already speaking about the skill, else `settings.local.json`, which
 * is where Claude's own `/skills` writes — and the member withdrawn from that
 * project's layers to follow Global again. The user layer is never touched
 * from here: what Global says is the Global page's business.
 */
async function inheritedSkillTogglePlan(
  entity: SkillInfo,
  operation: ToggleOperation,
  owner: string,
  confirm: boolean,
  context: KindContext
): Promise<PlanResult> {
  if (entity.scope !== 'user') {
    return refused('not-permitted', `${entity.name} is not a global skill; toggle it where it lives.`)
  }
  const layers = await context.layers()
  const own = projectLayers(layers, owner)
  if (own.length === 0) {
    return refused('unknown-id', `No project with id "${owner}" in the current scan.`)
  }
  const saysOff = resolveSkillOverride(own, entity.name)?.value === 'off'
  const decision = inheritedSkillCapabilities(saysOff ? 'off' : 'inherit')[operation]
  if (!decision.allowed) {
    return refused('not-permitted', decision.reason ?? `kondo cannot ${operation} this skill here.`)
  }
  const keyPath = [SKILL_OVERRIDES, entity.name]
  const write = (layer: SettingsLayer, content: string): PlannedStep => ({
    type: 'write',
    store: layer.store,
    at: layer.relative,
    content
  })
  // A layer already on disk is edited under ADR-0010's guard: the digest of
  // the bytes this was planned against rides with the edit, and the apply
  // refuses rather than overwriting a file someone else has since rewritten.
  const splice = (layer: SettingsLayer, source: string, edit: SpliceEdit): PlannedStep => ({
    type: 'splice',
    store: layer.store,
    at: layer.relative,
    expectDigest: digestSource(source),
    edits: [edit]
  })
  const unreadable = (layer: SettingsLayer): PlanResult =>
    refused('parse-failed', `${layer.info.path} did not read back as a JSON object; kondo will not rewrite it.`)
  const unsplicable = (layer: SettingsLayer): PlanResult =>
    refused('bad-request', `kondo cannot edit skillOverrides in ${layer.info.path} without reformatting it.`)

  if (operation === 'disable') {
    const layer = destinationLayer(layers, owner, (candidate) => skillOverrideIn(candidate, entity.name) !== null)
    if (!layer) return refused('not-permitted', `No settings layer speaks for this project.`)
    const summary = `Switch skill ${entity.name} off for ${projectLabelOf(layer)} in ${layer.info.path}`
    if (!layer.info.exists) {
      if (!confirm) {
        return refused(
          'needs-confirmation',
          `${layer.info.path} does not exist yet. Confirm to create it holding just this key.`
        )
      }
      const fresh = spliceMember('{}\n', keyPath, '"off"')
      if (fresh === null) return unsplicable(layer)
      return settingsEdit(entity, summary, [write(layer, fresh)])
    }
    if (layer.source === null || layer.parsed === null) return unreadable(layer)
    const edit = editMember(layer.source, keyPath, '"off"')
    if (edit === null) return unsplicable(layer)
    return settingsEdit(entity, summary, [splice(layer, layer.source, edit)])
  }

  const steps: PlannedStep[] = []
  const cleared: string[] = []
  for (const layer of own) {
    if (skillOverrideIn(layer, entity.name) !== 'off') continue
    if (layer.source === null || layer.parsed === null) return unreadable(layer)
    const edit = editMember(layer.source, keyPath, null)
    if (edit === null) return unsplicable(layer)
    steps.push(splice(layer, layer.source, edit))
    cleared.push(layer.info.path)
  }
  if (steps.length === 0) return refused('not-permitted', `This project does not switch ${entity.name} off.`)
  return settingsEdit(
    entity,
    `Let skill ${entity.name} follow Global again: stop switching it off in ${cleared.join(', ')}`,
    steps
  )
}

/** The project a layer belongs to, as the display path of its `.claude` parent. */
function projectLabelOf(layer: SettingsLayer): string {
  return layer.info.path.replace(/\/\.claude\/settings(\.local)?\.json$/, '')
}

function settingsEdit(entity: SkillInfo, summary: string, steps: PlannedStep[]): PlanResult {
  return {
    ok: true,
    plan: { op: 'settings-edit', kind: 'skill', entityId: entity.id, summary, steps }
  }
}

/**
 * The store change that removes one skill: a single `trash` step, which is a
 * displacement into `<kondo-data>/trash/<journal-id>/` and never an unlink
 * (ADR-0001), so one undo puts the whole directory back.
 *
 * One step and not three. A move needs copy → verify → trash because it is
 * about to release bytes it has just written elsewhere; here there is no
 * destination to prove, and the kondo trash IS the copy.
 *
 * The matrix is the gate (ADR-0006): a plugin-shipped skill is refused with
 * its own reason, because a plugin's files are the plugin's to remove.
 * Whether a copy of this skill exists in another scope is not asked here —
 * `skillDuplicates` answers that with digests, and a name alone was never
 * grounds for calling one of them redundant.
 */
function skillTrashPlan(entity: SkillInfo): PlanResult {
  const decision = entity.capabilities.trash
  if (!decision.allowed) {
    return refused('not-permitted', decision.reason ?? `kondo cannot trash this skill.`)
  }
  const placement = placementOf('skill', entity)
  if (placement === null) {
    return refused('not-permitted', `kondo cannot tell what store ${entity.name} lives in.`)
  }
  return {
    ok: true,
    plan: {
      op: 'trash',
      kind: 'skill',
      entityId: entity.id,
      summary: `Move skill ${entity.name} (${entity.scope}) to kondo's trash`,
      steps: [{ type: 'trash', store: placement.store, from: placement.at }]
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
    if (request.op === 'move') {
      return movePlan('skill', entity, request.targetId ?? '', context.skills(), context)
    }
    if (request.op === 'trash') return skillTrashPlan(entity)
    // A project id as the target is the per-project switch of a global skill
    // (entry 062): the write lands in that project's layers, never the user's.
    if (request.targetId !== undefined && request.targetId.startsWith(PROJECT_PREFIX)) {
      return inheritedSkillTogglePlan(entity, request.op, request.targetId, request.confirm === true, context)
    }
    return skillTogglePlan(entity, request.op, request.confirm === true, context)
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
    // Uninstalling is Claude's, not kondo's: the matrix says so and this
    // quotes it rather than inventing a refusal of its own (ADR-0006).
    if (request.op === 'trash') {
      return refused(
        'not-permitted',
        entity.capabilities.trash.reason ?? 'kondo cannot trash this plugin.'
      )
    }
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
    return scanPluginSkills(context.locator, record, await context.skillUsage(), context.c)
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
    // The verified projects come along because a hook's script may be
    // written relative to the project whose layer arms it, and because a
    // path outside every one of them is refused rather than statted
    // (ADR-0002).
    return hooksFromLayers(
      await context.layers(),
      context.locator,
      await context.projects(),
      context.c
    )
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
    if (!record) return null
    // The mirror flag is a second listing joined to this one, not a second
    // tier: readdir over the desktop store, no transcript opened (ADR-0007).
    return toSessionSummaries(record, context.now, await context.desktopStems())
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
    return { id, ...(await summarizeTranscript(record.file, context.locator.userRoot)) }
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
  async plan(entity, request, context) {
    if (request.op !== 'enable' && request.op !== 'disable') {
      return matrixRefusal('mcp', entity.scope, request.op)
    }
    return mcpTogglePlan(entity, request.op, context)
  }
}

/** Which registry list gates a declaration, by where the declaration lives (domain.md). */
const MCP_DISABLE_LIST: Record<string, string> = {
  local: 'disabledMcpServers',
  project: 'disabledMcpjsonServers'
}

/**
 * The store change behind an MCP toggle, in Claude's own words (ADR-0006,
 * entry 061): the project's entry in `~/.claude.json` carries a list of the
 * servers switched off for it — `disabledMcpServers` for servers declared in
 * that entry, `disabledMcpjsonServers` for those declared in the project's
 * `.mcp.json` — and the toggle adds the name to, or takes it out of, that
 * list. The whole list is one member, so the edit is one `spliceMember`-shaped
 * change to its value and every other byte of the registry keeps its place;
 * the step is a `splice` guarded by the digest of the text it was planned
 * against, because Claude rewrites this file during every session
 * (ADR-0010). `.mcp.json` itself is never written (ADR-0002).
 */
async function mcpTogglePlan(
  entity: McpServerInfo,
  operation: ToggleOperation,
  context: KindContext
): Promise<PlanResult> {
  const decision = entity.capabilities[operation]
  if (!decision.allowed) {
    return refused(
      'not-permitted',
      decision.reason ?? `kondo cannot ${operation} this MCP server.`
    )
  }
  const listKey = MCP_DISABLE_LIST[entity.scope]
  if (listKey === undefined || entity.project === null) {
    return refused('not-permitted', `${entity.name} is not gated by a project's disable list.`)
  }

  const { locator } = context
  const display = tildify(locator.userConfigFile, locator.home)
  let text: string
  try {
    text = await fs.readFile(await resolveAllowedPath(locator.userConfigFile, { file: locator.userConfigFile }), 'utf8')
  } catch (cause) {
    return refused('read-failed', `${display} could not be read: ${describeCause(cause)}`)
  }
  let config: Record<string, unknown> | null
  try {
    config = asObject(JSON.parse(text))
  } catch {
    config = null
  }
  if (config === null) {
    return refused('parse-failed', `${display} did not read back as a JSON object; kondo will not rewrite it.`)
  }
  // The entry is found by the same rule discovery joins on (ADR-0009): the
  // first key whose flattened form is this project's directory name. The key
  // is used exactly as the file spells it, never rebuilt from a path.
  const projects = asObject(config['projects']) ?? {}
  const key = Object.keys(projects).find((candidate) => flattenProjectPath(candidate) === entity.project)
  if (key === undefined) {
    return refused(
      'not-permitted',
      `${display} has no entry for this project, so there is no disable list to write.`
    )
  }
  const current = stringSet((asObject(projects[key]) ?? {})[listKey])
  const next =
    operation === 'disable'
      ? [...current, entity.name]
      : [...current].filter((name) => name !== entity.name)
  const edit = editMember(text, ['projects', key, listKey], JSON.stringify(next))
  if (edit === null) {
    return refused('bad-request', `kondo cannot edit ${listKey} in ${display} without reformatting it.`)
  }
  return {
    ok: true,
    plan: {
      op: 'settings-edit',
      kind: 'mcp',
      entityId: entity.id,
      summary: `${operation === 'enable' ? 'Enable' : 'Disable'} MCP server ${entity.name} for ${slashed(key)} in ${display}`,
      steps: [
        {
          type: 'splice',
          store: USER_CONFIG_STORE,
          at: path.basename(locator.userConfigFile),
          expectDigest: digestSource(text),
          edits: [edit]
        }
      ]
    }
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Agents, commands, rules and output styles: one definition shape, built four
 * times, because on disk the four differ only in the directory they sit in.
 * A factory rather than four literals — the near-copies would be identical
 * but for the kind they close over.
 *
 * Neither toggle has a mechanism: Claude loads these by presence and ships no
 * disable convention for them (ADR-0006), so both are refused in the matrix's
 * own words. `move` is the one operation that *is* Claude's own convention —
 * the file simply sits in the other scope's directory — so it goes through
 * the same copy, verify, trash plan a skill move does, with the same
 * collision refusal and the same undo.
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
    async plan(entity, request, context) {
      if (request.op !== 'move') return matrixRefusal(kind, entity.scope, request.op)
      return movePlan(
        kind,
        entity,
        request.targetId ?? '',
        // The collision check reads this kind's own listing, so a name is a
        // clash only when it is a clash for the directory being written.
        definition.discover(context).then((entries) => entries ?? []),
        context
      )
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
// Moving a placed entry into another scope

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

/** What every kind this plan serves carries, beyond its identity. */
interface Movable extends EntityIdentity {
  name: string
  scope: string
  /** Display path of the file or directory that holds it (tildified). */
  origin: string
}

/**
 * The store change that moves one placed entry into another scope: copy it,
 * prove the copy, then trash the original — one plan, so `undo` reverses the
 * whole thing or none of it (ADR-0001). The order is the invariant, and it
 * lives in the step list rather than in a caller's sequencing. `mutations`
 * verifies a copy by digesting the tree, and a lone file is a tree of one, so
 * a skill directory and an `agent.md` take the very same recipe.
 *
 * One plan for all five kinds, driven by the placement table: promoting an
 * agent is a skill move with a different directory name in it, and no more.
 *
 * The matrix is the gate (ADR-0006): a plugin-shipped skill is refused here,
 * not in the UI. A destination scope that already holds the name is refused
 * too — merging two entries would silently mix their files.
 *
 * `destinationId` is `'user'` or a `project:code:<dirName>` id from a
 * previous scan (ADR-0008); the renderer never builds a path. `siblings` is
 * the listing the entity itself came from, so the collision check is answered
 * from exactly those bytes and one scan covers both of a scope's directories.
 */
async function movePlan<T extends Movable>(
  kind: PlacedishKind,
  entity: T,
  destinationId: string,
  siblings: Promise<T[]>,
  context: KindContext
): Promise<PlanResult> {
  const decision = entity.capabilities.move
  if (!decision.allowed) {
    return refused('not-permitted', decision.reason ?? `kondo cannot move this ${kind}.`)
  }
  const placement = placementOf(kind, entity)
  if (placement === null) {
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
  // ADR-0006: an entry only goes where Claude reads that kind from. No
  // project store has been observed carrying `output-styles`, so kondo will
  // not be the one to create the first.
  if (target.store !== USER_DESTINATION && !PLACEMENTS[kind].inProject) {
    return refused(
      'not-permitted',
      `Claude does not load ${PLACEMENTS[kind].dir} from a project store; ${entity.name} stays in the user scope.`
    )
  }

  // Both of the destination's directories count: a name sitting in its
  // `skills.disabled` is the same name arriving twice.
  const clash = (await siblings).find(
    (candidate) =>
      candidate.name === entity.name && placementOf(kind, candidate)?.store === target.store
  )
  if (clash) {
    return refused(
      'bad-request',
      `${target.label} already holds a ${kind} named ${entity.name} (${clash.origin}); kondo will not merge the two.`
    )
  }

  // ADR-0006: the entry's state travels with it, so a benched skill lands in
  // the destination's `skills.disabled` and stays benched. That is already
  // what `placement.at` says — a move changes the store, never the directory.
  return {
    ok: true,
    plan: {
      op: 'move',
      kind,
      entityId: entity.id,
      summary: `Move ${kind} ${entity.name} from ${entity.origin} to ${target.label}`,
      steps: [
        {
          type: 'copy',
          store: placement.store,
          from: placement.at,
          toStore: target.store,
          to: placement.at
        },
        { type: 'trash', store: placement.store, from: placement.at }
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

  const plan = (steps: PlannedStep[]): PlanResult => ({
    ok: true,
    plan: {
      op: 'settings-edit',
      kind: 'plugin',
      entityId: entity.id,
      summary: `${enabled ? 'Enable' : 'Disable'} plugin ${entity.name} in ${layer.info.path}`,
      steps
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
    return plan([
      { type: 'write', store: layer.store, at: layer.relative, content: newSettingsSource(key, enabled) }
    ])
  }
  if (layer.source === null || layer.parsed === null) {
    return refused(
      'parse-failed',
      `${layer.info.path} did not read back as a JSON object; kondo will not rewrite it.`
    )
  }
  // The file is on disk, so the change is a splice under ADR-0010's guard:
  // the digest of the bytes just read travels with the edit, and the apply
  // refuses rather than discarding what Claude wrote in between.
  const edit = editEnabledPlugins(layer.source, key, enabled)
  if (edit === null) {
    return refused(
      'bad-request',
      `kondo cannot edit enabledPlugins in ${layer.info.path} without reformatting it.`
    )
  }
  return plan([
    {
      type: 'splice',
      store: layer.store,
      at: layer.relative,
      expectDigest: digestSource(layer.source),
      edits: [edit]
    }
  ])
}

// ---------------------------------------------------------------------------
// Handing a plugin from one settings layer to another scope

/**
 * Which of a scope's layers receives a statement: the highest-precedence one
 * that already `speaks` about the thing, else that scope's
 * `settings.local.json` — the file Claude's own `/skills` writes and the one
 * `projectPluginStates` picks a toggle's target by — and for the user scope
 * its one layer. A plugin or a skill arriving in a scope thus lands in the
 * file that scope's own control writes, and the renderer never chooses the
 * file (ADR-0006).
 */
function destinationLayer(
  layers: SettingsLayer[],
  owner: string | null,
  speaks: (layer: SettingsLayer) => boolean
): SettingsLayer | null {
  const mine = layers
    .filter((layer) => layer.info.projectId === owner)
    .sort((a, b) => SCOPE_ORDER[a.info.layer] - SCOPE_ORDER[b.info.layer])
  return mine.find(speaks) ?? mine.find((layer) => layer.info.layer === 'local') ?? mine[0] ?? null
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
  const to = destinationLayer(layers, owner, (layer) => pluginStateIn(layer, key) !== null)
  if (to === null) {
    return refused('bad-request', `${target.label} has no settings file kondo can write.`)
  }
  if (to.info.id === from.info.id) {
    return refused('bad-request', `${entity.name} is already stated in ${to.info.path}.`)
  }
  if (pluginStateIn(to, key) === true) {
    return refused('not-permitted', `${to.info.path} already enables ${entity.name}.`)
  }

  let arriving: PlannedStep
  if (!to.info.exists) {
    // The same gate the toggle has, and the only one: nothing licenses
    // conjuring a settings file, so this stops and asks and writes nothing.
    if (!createLayer) {
      return refused(
        'needs-confirmation',
        `${to.info.path} does not exist yet. Confirm to create it holding just this key.`
      )
    }
    arriving = {
      type: 'write',
      store: to.store,
      at: to.relative,
      content: newSettingsSource(key, true)
    }
  } else {
    if (to.source === null || to.parsed === null) {
      return refused(
        'parse-failed',
        `${to.info.path} did not read back as a JSON object; kondo will not rewrite it.`
      )
    }
    const edit = editEnabledPlugins(to.source, key, true)
    if (edit === null) {
      return refused(
        'bad-request',
        `kondo cannot edit enabledPlugins in ${to.info.path} without reformatting it.`
      )
    }
    arriving = {
      type: 'splice',
      store: to.store,
      at: to.relative,
      expectDigest: digestSource(to.source),
      edits: [edit]
    }
  }

  // The source states `true`, so its bytes read back — but the splice can
  // still decline a file it would have to reformat.
  const source = from.source
  const leaving = source === null ? null : editEnabledPlugins(source, key, false)
  if (leaving === null || source === null) {
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
        arriving,
        {
          type: 'splice',
          store: from.store,
          at: from.relative,
          expectDigest: digestSource(source),
          edits: [leaving]
        }
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
  const edit = clearEnabledPlugin(layer.source, key)
  if (edit === null) {
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
      steps: [
        {
          type: 'splice',
          store: layer.store,
          at: layer.relative,
          expectDigest: digestSource(layer.source),
          edits: [edit]
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Duplicate skills across scopes

/** The store-name prefix a project's `.claude` answers to (ADR-0003). */
const PROJECT_STORE = 'project:'

/**
 * The absolute path behind one placement. `SkillInfo.origin` is tildified for
 * display and is not a path to read from, so anything that needs the bytes an
 * entity sits on resolves the store name here — the same two names the write
 * path knows, resolved against the same verified project list (ADR-0002: a
 * project store is its `.claude` and nothing above it).
 *
 * Null for a store this call's project list does not hold, which is how a
 * project that stopped verifying between two reads becomes a member with no
 * digest rather than a throw.
 */
async function absolutePathOf(
  placement: Placement,
  context: KindContext
): Promise<{ target: string; root: string } | null> {
  const segments = placement.at.split('/')
  if (placement.store === USER_DESTINATION) {
    return { target: path.join(context.locator.userRoot, ...segments), root: context.locator.userRoot }
  }
  if (!placement.store.startsWith(PROJECT_STORE)) return null
  const dirName = placement.store.slice(PROJECT_STORE.length)
  const project = (await context.projects()).find((candidate) => candidate.dirName === dirName)
  return project === undefined
    ? null
    : { target: path.join(project.absPath, '.claude', ...segments), root: path.join(project.absPath, '.claude') }
}

/**
 * Skills carrying one name in more than one scope, with a digest per member.
 *
 * ADR-0007 decides the shape: the grouping is free — it is the listing
 * `context.skills()` already built — and hashing is not, so only a name that
 * actually repeats costs a tree read. A skill with a unique name is never
 * digested, which on a real machine is nearly all of them.
 *
 * The digest is the whole point. Two skills can share a name and hold
 * completely different work, so a group is a question and `identical` is the
 * answer; a member kondo could not read carries a null digest and makes the
 * group not identical, because "we could not tell" must never read as "safe
 * to remove".
 *
 * Plugin-shipped skills are deliberately absent: they come from a different
 * listing (`pluginSkill`), they are not the user's to remove, and a plugin
 * shipping a skill the user also placed is not a duplicate of anything —
 * it is the ordinary way an override works.
 */
export async function skillDuplicates(
  context: KindContext
): Promise<SkillDuplicateGroup[]> {
  const byName = new Map<string, SkillInfo[]>()
  for (const entity of await context.skills()) {
    byName.set(entity.name, [...(byName.get(entity.name) ?? []), entity])
  }

  const repeated = [...byName]
    .filter(([, members]) => members.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))

  return mapPool(repeated, 4, async ([name, members]) => {
    const digested = await mapPool(members, 4, async (entity): Promise<SkillDuplicate> => {
      const placement = placementOf('skill', entity)
      const target = placement === null ? null : await absolutePathOf(placement, context)
      if (target === null) return { skill: entity, digest: null }
      try {
        return { skill: entity, digest: await digestTree(target.target, target.root) }
      } catch (cause) {
        // ADR-0005: an unreadable tree costs this member its digest and the
        // group its verdict, and costs the listing nothing else.
        context.c.fail('read-failed', entity.origin, cause)
        return { skill: entity, digest: null }
      }
    })
    const first = digested[0]?.digest ?? null
    return {
      name,
      members: digested,
      identical:
        first !== null && digested.every((member) => member.digest === first)
    }
  })
}

// ---------------------------------------------------------------------------
// Duplicate sessions (entry 034)

/**
 * How much of an opening two sessions must share before sharing it means
 * anything. "ok" and "continue" open hundreds of sessions apiece and say
 * nothing about whether they are the same work.
 */
const MIN_SIGNATURE_CHARS = 12

/**
 * The key two openings are grouped on: lower case, letters and digits only,
 * single spaces. Near-identical rather than identical is the whole point — a
 * prompt retyped with different punctuation, or pasted with its indentation
 * lost, is the same request and groups with the one it repeats.
 *
 * Null for an opening too short to be evidence of anything.
 */
function promptSignature(prompt: string): string | null {
  const signature = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return signature.length < MIN_SIGNATURE_CHARS ? null : signature
}

/**
 * Sessions of ONE project whose openings match. Tier-2 (ADR-0007) and
 * narrowed to the project asked for, because the alternative — every
 * transcript in a store of thousands — is the startup cost that ADR exists
 * to refuse.
 *
 * Two things keep the cost down. Each transcript is streamed only as far as
 * its first user message (`readFirstUserPrompt`), so an opening costs
 * kilobytes rather than the file; and what that read found is cached under
 * `<kondo-data>` on `(path, size, mtime)`, so asking twice re-reads only the
 * sessions that were written to since.
 *
 * Null when the project id does not resolve. A transcript that could not be
 * read costs itself its opening and is left out of every group, with the
 * failure itemized beside the groups that formed (ADR-0005) — and is
 * deliberately not cached, so the next call tries again.
 */
export async function sessionNearDuplicates(
  projectId: string,
  context: KindContext
): Promise<SessionDuplicateGroup[] | null> {
  if (!projectId.startsWith(PROJECT_PREFIX)) return null
  const record = (await context.inventory()).byDirName.get(
    projectId.slice(PROJECT_PREFIX.length)
  )
  if (!record) return null

  const summaries = toSessionSummaries(record, context.now, await context.desktopStems())
  // The value is wrapped rather than stored bare: a session whose transcript
  // holds no user message caches a `null` prompt, and that is a hit, not a
  // miss — otherwise every empty transcript is re-streamed forever.
  const cache = await openScanCache<{ prompt: string | null }>(
    context.locator.kondoDataRoot,
    'first-prompt'
  )

  const openings = await mapPool(record.sessions, 8, async (session) => {
    try {
      const resolved = await resolveAllowedPath(session.file, context.locator.userRoot)
      const hit = cache.get(resolved, session.bytes, session.mtimeMs)
      if (hit !== null) return hit.prompt
      const prompt = await readFirstUserPrompt(session.file, context.locator.userRoot)
      cache.set(resolved, session.bytes, session.mtimeMs, { prompt })
      return prompt
    } catch (cause) {
      context.c.fail('read-failed', tildify(session.file, context.locator.home), cause)
      return null
    }
  })
  await cache.save()

  const groups = new Map<string, SessionDuplicateGroup>()
  // `toSessionSummaries` maps one for one, so the three arrays share indices.
  for (const [at, prompt] of openings.entries()) {
    const summary = summaries[at]
    if (prompt === null || summary === undefined) continue
    const signature = promptSignature(prompt)
    if (signature === null) continue
    const group = groups.get(signature)
    if (group) group.members.push(summary)
    else groups.set(signature, { prompt, members: [summary] })
  }

  return [...groups.values()]
    .filter((group) => group.members.length > 1)
    .sort((a, b) => b.members.length - a.members.length || a.prompt.localeCompare(b.prompt))
}

export type SessionTrashPlan =
  | { ok: true; plan: MutationPlan | null }
  | { ok: false; code: ScanErrorCode; message: string }

/**
 * One journal entry covering every session picked, so a single undo puts the
 * whole selection back (ADR-0001). Each session contributes a `trash` step
 * for its transcript and, when it has one, a second for the sibling directory
 * holding its state — leaving that behind would only make it tomorrow's
 * orphan, which is the same reason the sweep carries it along.
 *
 * One step and not the move's copy → verify → trash: there is no destination
 * whose bytes need proving, and the kondo trash IS the copy.
 *
 * Any id that does not resolve refuses the WHOLE selection rather than
 * trashing part of it — a set the user confirmed is moved entire or not at
 * all. An empty choice returns a null plan and writes no entry.
 */
export async function sessionTrashPlan(
  ids: readonly string[],
  context: KindContext
): Promise<SessionTrashPlan> {
  const decision = capabilitiesFor('session', 'code').trash
  if (!decision.allowed) {
    return {
      ok: false,
      code: 'not-permitted',
      message: decision.reason ?? 'kondo cannot trash a session.'
    }
  }

  const inventory = await context.inventory()
  const root = context.locator.userRoot
  const steps: PlannedStep[] = []
  // The same session named twice is one displacement: the second step would
  // reach for a source the first already moved and fail the whole plan.
  const chosen = [...new Set(ids)]

  for (const id of chosen) {
    if (id.startsWith(DESKTOP_SESSION_PREFIX)) {
      const desktop = capabilitiesFor('session', 'desktop').trash
      return {
        ok: false,
        code: 'not-permitted',
        message: desktop.reason ?? 'kondo cannot trash a desktop session.'
      }
    }
    if (!id.startsWith(SESSION_PREFIX)) {
      return {
        ok: false,
        code: 'bad-request',
        message: `sessionTrash expects ${SESSION_PREFIX} ids; "${id}" is not one.`
      }
    }
    const key = id.slice(SESSION_PREFIX.length)
    const slash = key.lastIndexOf('/')
    const project = slash <= 0 ? undefined : inventory.byDirName.get(key.slice(0, slash))
    const session = project?.sessions.find(
      (candidate) => candidate.uuid === key.slice(slash + 1).toLowerCase()
    )
    if (project === undefined || session === undefined) {
      return {
        ok: false,
        code: 'unknown-id',
        message: `No session with id "${id}" in the current scan — rescan and retry.`
      }
    }
    steps.push({ type: 'trash', store: 'user', from: relativeTo(root, session.file) })
    if (session.sidecar !== null) {
      steps.push({
        type: 'trash',
        store: 'user',
        from: relativeTo(root, path.join(project.absPath, session.sidecar))
      })
    }
    if (session.released !== null) {
      steps.push({
        type: 'trash',
        store: 'user',
        from: relativeTo(root, path.join(project.absPath, session.released))
      })
    }
  }
  if (steps.length === 0) return { ok: true, plan: null }

  // One session is an entity the journal can name (ADR-0008); a set of them
  // spans several, so it names the store the way the sweep does.
  const single = chosen.length === 1
  return {
    ok: true,
    plan: {
      op: 'trash',
      kind: single ? 'session' : 'store',
      entityId: single ? (chosen[0] as string) : 'store:user',
      summary: `Move ${chosen.length} session${single ? '' : 's'} to kondo's trash`,
      steps
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
    Promise.all(
      plugins.map(async (record) =>
        scanPluginSkills(context.locator, record, await context.skillUsage(), context.c)
      )
    )
  ])
  return scanConfigOrphans(
    context.locator,
    {
      layers,
      plugins,
      skillNames: new Set([...own, ...shipped.flat()].map((entry) => entry.name)),
      // The inventory already stat'd every project (ADR-0009), so calling an
      // entry dead costs nothing here.
      location: new Map(
        [...inventory.byDirName].map(([dirName, record]) => [dirName, record.location])
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
