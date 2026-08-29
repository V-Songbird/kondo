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

export interface SessionProject {
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

export interface SessionSummary {
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

export interface DesktopSession {
  /** `session:desktop:<deviceDir>/<accountId>/<name>` — unique on disk. */
  id: string
  accountId: string
  name: string
  bytes: number
  mtimeMs: number
}

// ---------------------------------------------------------------------------
// Skills / plugins / hooks / settings

export type SkillScope = 'user' | 'user-disabled' | 'plugin' | 'project'

export interface SkillInfo {
  /** `skill:<scope>:<key>` */
  id: string
  name: string
  description: string | null
  scope: SkillScope
  /** Display path of the skill directory (tildified). */
  origin: string
  enabled: boolean
}

export interface PluginInfo {
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
}

export interface HookInfo {
  /** `hook:<settings-layer-id>:<n>` — e.g. `hook:settings:user:user:0`. */
  id: string
  event: string
  matcher: string | null
  command: string
  /** Display path of the settings file that arms it. */
  source: string
  layer: 'user' | 'project' | 'local'
}

export interface SettingsLayerInfo {
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
// The API surface

export interface KondoApi {
  storesOverview(): Promise<Scan<StoresOverview>>
  sessionProjects(refresh?: boolean): Promise<Scan<SessionProject[]>>
  sessionList(projectId: string): Promise<Scan<SessionSummary[]>>
  sessionDetail(sessionId: string): Promise<Scan<SessionDetail | null>>
  desktopSessions(): Promise<Scan<DesktopSession[]>>
  skillsList(): Promise<Scan<SkillInfo[]>>
  pluginsList(): Promise<Scan<PluginInfo[]>>
  hooksList(): Promise<Scan<HookInfo[]>>
  settingsLayers(): Promise<Scan<SettingsLayerInfo[]>>
}

/** Channel names, keyed by KondoApi method — written once, imported twice. */
export const channels = {
  storesOverview: 'kondo:stores-overview',
  sessionProjects: 'kondo:session-projects',
  sessionList: 'kondo:session-list',
  sessionDetail: 'kondo:session-detail',
  desktopSessions: 'kondo:desktop-sessions',
  skillsList: 'kondo:skills-list',
  pluginsList: 'kondo:plugins-list',
  hooksList: 'kondo:hooks-list',
  settingsLayers: 'kondo:settings-layers'
} as const satisfies Record<keyof KondoApi, string>
