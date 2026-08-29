/**
 * The seam contract. The single module main, preload, and renderer all
 * import (ADR-0004): every type that crosses IPC, the KondoApi surface, and
 * the channel-name map. Must stay platform-free — no electron, no node
 * imports (enforced by safety.test.ts).
 */

// ---------------------------------------------------------------------------
// Scan envelope (ADR-0005)

export type ScanErrorCode =
  /** Reading a file or directory failed (not ENOENT); the item is missing from data. */
  | 'read-failed'
  /** Stat failed (not ENOENT); size/mtime for the item are absent. */
  | 'stat-failed'
  /** File read but not valid JSON/JSONL; content skipped. UI: suggest inspecting the file. */
  | 'parse-failed'
  /** The id no longer resolves against the current scan. UI: offer a rescan. */
  | 'unknown-id'
  /** Malformed request from the renderer — always a kondo bug worth reporting. */
  | 'bad-request'
  /** A store manifest pointed outside the store; the pointer was not followed. */
  | 'out-of-store'
  /** The capability matrix refuses the operation on this entity (ADR-0006). */
  | 'not-permitted'
  /**
   * The mutation would bring a file into existence. Nothing was written; the
   * UI names the file and asks, then repeats the call with the go-ahead.
   */
  | 'needs-confirmation'

export interface ScanError {
  code: ScanErrorCode
  /** Display path or id the error is about; already tildified for the UI. */
  path: string
  message: string
}

export interface Scan<T> {
  data: T
  errors: ScanError[]
  /** Entries kondo does not recognize — domain.md drift detection. */
  unknown: string[]
}

// ---------------------------------------------------------------------------
// Entity kinds and the capability matrix

/**
 * The entity kinds kondo manages — the first segment of every id (ADR-0008).
 * Each one is described by a definition in the main process rather than by
 * a hard-coded adapter call, and every kind supplies discover / read /
 * capabilities / enable / disable.
 */
export type EntityKind = 'skill' | 'plugin' | 'hook' | 'settings' | 'session' | 'project'

/** The two directions of a toggle — the operations that flip existing state. */
export type ToggleOperation = 'enable' | 'disable'

/**
 * What a mutation would do to an entity. `move` relocates the entity into
 * another scope; unlike the toggles it is not its own inverse, so the matrix
 * answers it separately.
 */
export type CapabilityOperation = ToggleOperation | 'move'

export interface CapabilityDecision {
  allowed: boolean
  /** Why not, in one display line; null when allowed. */
  reason: string | null
}

/**
 * One row of the capability matrix: what a kind permits in one scope. Write
 * permission is this lookup — kind, then scope, then operation — and never a
 * single boolean, because the same kind is writable in one scope and
 * read-only in another.
 */
export type Capabilities = Record<CapabilityOperation, CapabilityDecision>

/** What every entity carries across the seam. */
export interface EntityIdentity {
  /** `<kind>:<scope-or-store>:<key>` (ADR-0008); opaque to the renderer. */
  id: string
  kind: EntityKind
  /** The matrix row for this entity's kind and scope. */
  capabilities: Capabilities
}

// ---------------------------------------------------------------------------
// Stores overview

export interface StoreEntry {
  name: string
  type: 'dir' | 'file'
  bytes: number
  mtimeMs: number
}

export interface StoreReport {
  /** Display path of the store root (tildified). */
  root: string
  exists: boolean
  entries: StoreEntry[]
  totalBytes: number
}

export interface StoresOverview {
  user: StoreReport
  desktop: StoreReport
  sessions: {
    projectCount: number
    sessionCount: number
    staleCount: number
    transcriptBytes: number
  }
}

// ---------------------------------------------------------------------------
// Sessions (Claude Code store)

export interface SessionProject extends EntityIdentity {
  /** `project:code:<dirName>` */
  id: string
  dirName: string
  /** Reconstructed original working directory, if a candidate verified. */
  guessedPath: string | null
  sessionCount: number
  transcriptBytes: number
  lastActivityMs: number
  staleCount: number
  orphanCount: number
}

export interface SessionSummary extends EntityIdentity {
  /** `session:code:<dirName>/<uuid>` */
  id: string
  uuid: string
  projectId: string
  bytes: number
  mtimeMs: number
  stale: boolean
  /** A sibling directory (subagent/tool state) exists for this session. */
  hasSidecar: boolean
}

export interface SessionDetail {
  id: string
  lineCount: number
  messageCount: number
  badLines: number
  firstTimestamp: string | null
  lastTimestamp: string | null
  /** First user message, truncated for display. */
  firstUserPrompt: string | null
}

export interface DesktopSession extends EntityIdentity {
  /** `session:desktop:<deviceDir>/<accountId>/<name>` — unique on disk. */
  id: string
  accountId: string
  name: string
  bytes: number
  mtimeMs: number
}

// ---------------------------------------------------------------------------
// Skills / plugins / hooks / settings

export type SkillScope =
  | 'user'
  | 'user-disabled'
  | 'plugin'
  | 'project'
  | 'project-disabled'

export interface SkillInfo extends EntityIdentity {
  /** `skill:<scope>:<key>` */
  id: string
  name: string
  description: string | null
  scope: SkillScope
  /** Display path of the skill directory (tildified). */
  origin: string
  enabled: boolean
}

/**
 * What one settings layer says about one plugin, and whether kondo may write
 * it there. A plugin's enabled state is a key in a settings file rather than
 * a property of the plugin (ADR-0006), so the toggle is per layer.
 */
export interface PluginScopeState {
  /** `settings:<layer>:<key>` — the layer a toggle would write. */
  layerId: string
  layer: 'user' | 'project' | 'local'
  /**
   * The project this layer belongs to, by its directory name, or null for
   * the user layer. Several projects each contribute a `project` and a
   * `local` layer, so this is what tells two identically-labelled scopes
   * apart.
   */
  project: string | null
  /** Display path of the settings file (tildified). */
  path: string
  exists: boolean
  /** true, false, or null when this layer says nothing about the plugin. */
  enabled: boolean | null
  /** The matrix row for writing a plugin in this layer. */
  capabilities: Capabilities
}

export interface PluginInfo extends EntityIdentity {
  /** `plugin:<name>@<marketplace>` */
  id: string
  name: string
  marketplace: string
  version: string | null
  installScope: string
  installedAt: string | null
  lastUpdated: string | null
  installPath: string
  /** Display names of settings layers whose enabledPlugins list it. */
  enabledIn: string[]
  /**
   * Every settings layer, highest precedence first — local, then project,
   * then user (domain.md). Layers of different projects share a rank, so
   * within one rank the order is the scan's.
   */
  scopes: PluginScopeState[]
  /**
   * The layer whose value Claude honours: the first in `scopes` that states
   * one. Null when no layer mentions the plugin at all.
   */
  winningLayerId: string | null
}

export interface HookInfo extends EntityIdentity {
  /** `hook:<settings-layer-id>:<n>` — e.g. `hook:settings:user:user:0`. */
  id: string
  event: string
  matcher: string | null
  command: string
  /** Display path of the settings file that arms it. */
  source: string
  layer: 'user' | 'project' | 'local'
}

export interface SettingsLayerInfo extends EntityIdentity {
  /** `settings:<layer>:<key>` */
  id: string
  layer: 'user' | 'project' | 'local'
  /** Display path of the file. */
  path: string
  exists: boolean
  bytes: number
  keys: string[]
}

// ---------------------------------------------------------------------------
// Mutation journal and kondo trash (ADR-0001)

/** What a journal entry did, in the user's terms. */
export type JournalOp = 'move' | 'settings-edit' | 'trash'

/**
 * One reversible operation, as the renderer sees it. The steps that carry
 * the paths stay in the main process — only ids and display strings cross.
 */
export interface JournalEntryInfo {
  /** `journal:<journal-id>` — the id undo takes (ADR-0008). */
  id: string
  /** ISO-8601. */
  at: string
  op: JournalOp
  /** The registry kind the operation acted on. */
  kind: EntityKind
  /** The ADR-0008 id of the entity, never a path. */
  entityId: string
  /** One line describing the operation, built in the main process. */
  summary: string
  stepCount: number
  /** Journal id of the entry that reversed this one, or null. */
  undoneBy: string | null
  /** True when this entry is itself the undo of another. */
  isUndo: boolean
}

export interface TrashReport {
  /** Display path of the trash root (tildified). */
  root: string
  bytes: number
  /** Journal ids currently holding displaced bytes. */
  entryCount: number
}

// ---------------------------------------------------------------------------
// The API surface

export interface KondoApi {
  storesOverview(): Promise<Scan<StoresOverview>>
  sessionProjects(refresh?: boolean): Promise<Scan<SessionProject[]>>
  sessionList(projectId: string): Promise<Scan<SessionSummary[]>>
  sessionDetail(sessionId: string): Promise<Scan<SessionDetail | null>>
  desktopSessions(): Promise<Scan<DesktopSession[]>>
  skillsList(): Promise<Scan<SkillInfo[]>>
  /**
   * Move one skill between its scope's `skills` and `skills.disabled`
   * directories (ADR-0006), journaled and reversible (ADR-0001). The matrix
   * refuses what Claude's conventions do not permit, so the renderer reads
   * `SkillInfo.capabilities` to know which direction — if any — to offer.
   * The move changes the skill's id: callers re-read rather than patching.
   */
  skillToggle(
    skillId: string,
    operation: ToggleOperation
  ): Promise<Scan<JournalEntryInfo | null>>
  /**
   * Move one skill into another scope as a single journaled, reversible
   * operation (ADR-0001): the destination copy is written and verified
   * *before* the source is displaced into kondo's trash, so no intermediate
   * state can lose the skill.
   *
   * `destinationId` is `'user'` for the user scope or a `project:code:` id
   * from a previous scan (ADR-0008) — never a path. A destination scope that
   * already holds a skill of that name is refused rather than merged, and the
   * matrix refuses a plugin-shipped source. The skill keeps its enabled state
   * across the move, which changes its id: callers re-read rather than patch.
   */
  skillMove(skillId: string, destinationId: string): Promise<Scan<JournalEntryInfo | null>>
  pluginsList(): Promise<Scan<PluginInfo[]>>
  /**
   * Enable or disable one plugin in one settings layer by editing that
   * file's `enabledPlugins` key in place (ADR-0006), journaled and therefore
   * reversible (ADR-0001). Only that key's bytes change; every other key and
   * the file's formatting survive untouched.
   *
   * A layer whose file does not exist yet is refused with
   * `needs-confirmation` and nothing is written. The caller shows the path,
   * asks, and repeats the call with `createLayer` — the file is never
   * conjured as a side effect of toggling.
   */
  pluginToggle(
    pluginId: string,
    layerId: string,
    operation: ToggleOperation,
    createLayer?: boolean
  ): Promise<Scan<JournalEntryInfo | null>>
  hooksList(): Promise<Scan<HookInfo[]>>
  settingsLayers(): Promise<Scan<SettingsLayerInfo[]>>
  /** Journal entries, newest first. */
  journalList(): Promise<Scan<JournalEntryInfo[]>>
  /** Reverse one entry; the undo is itself journaled and returned. */
  journalUndo(journalId: string): Promise<Scan<JournalEntryInfo | null>>
  trashSize(): Promise<Scan<TrashReport>>
}

/** Channel names, keyed by KondoApi method — written once, imported twice. */
export const channels = {
  storesOverview: 'kondo:stores-overview',
  sessionProjects: 'kondo:session-projects',
  sessionList: 'kondo:session-list',
  sessionDetail: 'kondo:session-detail',
  desktopSessions: 'kondo:desktop-sessions',
  skillsList: 'kondo:skills-list',
  skillToggle: 'kondo:skill-toggle',
  skillMove: 'kondo:skill-move',
  pluginsList: 'kondo:plugins-list',
  pluginToggle: 'kondo:plugin-toggle',
  hooksList: 'kondo:hooks-list',
  settingsLayers: 'kondo:settings-layers',
  journalList: 'kondo:journal-list',
  journalUndo: 'kondo:journal-undo',
  trashSize: 'kondo:trash-size'
} as const satisfies Record<keyof KondoApi, string>
