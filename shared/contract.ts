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
  /**
   * The file changed between the scan a mutation was planned from and the
   * attempt to write it (ADR-0010). Nothing was written and nothing was
   * lost. UI: say the file moved on, re-read, and offer the action again.
   */
  | 'stale-file'
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
 * a hard-coded adapter call. Every kind supplies discover / read / plan, and
 * `plan` answers every operation: a kind with no native convention for one
 * (ADR-0006) refuses it in the capability matrix's own words rather than
 * having a seat of its own left unwired.
 */
export type EntityKind =
  | 'skill'
  | 'plugin'
  | 'hook'
  | 'settings'
  | 'session'
  | 'project'
  /**
   * One MCP server declaration. Read-only today: the files that hold them —
   * `~/.claude.json` and `<project>/.mcp.json` — are ones kondo cannot yet
   * write safely (ADR-0009), so the matrix refuses every operation.
   */
  | 'mcp'
  /**
   * The four kinds Claude loads from a directory of hand-placed files — a
   * subagent, a slash command, a rule, an output style. Read-only today:
   * Claude has no disable convention for any of them (ADR-0006), and moving
   * one between scopes waits on entry 028.
   */
  | 'agent'
  | 'command'
  | 'rule'
  | 'output-style'
  /**
   * A whole store, rather than one thing inside it. The tidy sweep acts at
   * this level: it displaces transcripts, sidecars and cache directories in
   * one operation, so no single entity below is the thing it changed.
   */
  | 'store'

/** The two directions of a toggle — the operations that flip existing state. */
export type ToggleOperation = 'enable' | 'disable'

/**
 * What a mutation would do to an entity. `move` relocates the entity into
 * another scope and `trash` displaces it into kondo's trash; unlike the
 * toggles neither is its own inverse, so the matrix answers each separately.
 *
 * `trash` is not a delete (ADR-0001): the bytes go to
 * `<kondo-data>/trash/<journal-id>/` and undo puts them back. It is allowed
 * only where the entry is the user's own to remove — a plugin-shipped skill
 * follows its plugin and is refused.
 */
export type CapabilityOperation = ToggleOperation | 'move' | 'trash'

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

/**
 * What one mutation asks for. One shape for every kind and every operation,
 * so growing the contract means adding an operation here rather than a
 * method, a channel and a bridge line per kind (ADR-0004).
 */
export interface MutateRequest {
  op: CapabilityOperation
  /**
   * Where the operation lands, as an id from a previous scan (ADR-0008) and
   * never a path: the destination scope for a `move`, the settings layer for
   * a plugin toggle. Absent where the kind needs no target.
   */
  targetId?: string
  /**
   * Where the operation starts, as an id from a previous scan. Only a plugin
   * move needs one: a skill sits in exactly one scope, so its own id says
   * where it comes from, while a plugin is stated in as many settings layers
   * as mention it and the one being withdrawn has to be named.
   */
  sourceId?: string
  /**
   * The user has confirmed a step that would bring a file into existence.
   * Without it such a step is refused with `needs-confirmation` and nothing
   * is written.
   */
  confirm?: boolean
}

/** What every entity carries across the seam. */
export interface EntityIdentity {
  /** `<kind>:<scope-or-store>:<key>` (ADR-0008); opaque to the renderer. */
  id: string
  kind: EntityKind
  /** The matrix row for this entity's kind and scope. */
  capabilities: Capabilities
}

/**
 * One member of a duplicate group: the skill, and the digest of the tree
 * behind it. Null when that tree could not be read — a repeated name is
 * never called a redundant copy on the strength of a digest kondo does not
 * have.
 */
export interface SkillDuplicate {
  skill: SkillInfo
  digest: string | null
}

/**
 * Skills sharing one name across scopes. The name is what makes a group; the
 * digests are what say whether the copies are actually the same skill, which
 * is the only thing that makes one of them redundant.
 */
export interface SkillDuplicateGroup {
  name: string
  /** Two or more, always: a unique name is not a group and is never digested. */
  members: SkillDuplicate[]
  /** True when every member digested and all the digests agree. */
  identical: boolean
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
    /**
     * The whole project set: the union of the `~/.claude.json` registry keys
     * and the `~/.claude/projects` directories (domain.md). Wider than
     * "projects with transcripts" on purpose — a directory Claude has on
     * record but never worked in is still a member.
     */
    projectCount: number
    /**
     * How many of those hold at least one transcript. Always <= projectCount,
     * and strictly less whenever a registry key has no transcripts of its own.
     * The pair is reported rather than the union alone so a wider project set
     * never reads as sessions having gone missing.
     */
    transcriptProjectCount: number
    sessionCount: number
    staleCount: number
    transcriptBytes: number
  }
}

// ---------------------------------------------------------------------------
// Sessions (Claude Code store)

/**
 * Where a project came from. The project set is the union of the two
 * (domain.md): a directory under `~/.claude/projects` means Claude has kept
 * transcripts there, a `~/.claude.json` key means Claude has the path on
 * record. Most projects are both; either one alone is still a project.
 */
export type ProjectSource = 'registry' | 'transcripts'

/**
 * Where a project's real directory stands. Three states and not a flag,
 * because the two ways of not having a path mean opposite things: `gone` is
 * evidence — the registry named the path (ADR-0009) and the stat says it is
 * no longer there, which is what makes a project dead. `unlocated` is the
 * absence of evidence — no registry key, and the lossy un-flattening guess
 * did not verify, so kondo simply does not know where the project is and
 * must not treat it as deleted.
 */
export type ProjectLocation = 'here' | 'gone' | 'unlocated'

export interface SessionProject extends EntityIdentity {
  /** `project:code:<dirName>` */
  id: string
  dirName: string
  /**
   * The project's real directory: exact when the registry names it
   * (ADR-0009), otherwise the un-flattening guess, which is kept only when
   * it verified. Null when neither names one.
   */
  guessedPath: string | null
  /** Which sources named this project; never empty. */
  sources: ProjectSource[]
  /**
   * Whether `guessedPath` is on disk, could not be resolved, or resolved and
   * is gone. A `gone` project is still a member of the set, with nothing
   * behind it; an `unlocated` one may well be alive under a name kondo
   * cannot reverse.
   */
  location: ProjectLocation
  /**
   * It has a `.claude` directory, so it is a store kondo can write into
   * (ADR-0002). A project without one is a real member of the set; it is
   * simply not somewhere a skill can be moved.
   */
  hasStore: boolean
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
  /**
   * The other store holding a session of this id, or null when none does —
   * `'desktop'` today, that being the only other store kondo reads.
   *
   * A session id is the same UUID wherever it appears (domain.md), so a
   * `local_<uuid>.json` in the desktop app's directories is this same work
   * recorded twice. This is the tier-1 half of duplicate detection: a join
   * over two listings kondo already makes, with no transcript opened
   * (ADR-0007).
   */
  mirroredIn: string | null
}

/**
 * Sessions of ONE project whose opening prompts match once normalized — the
 * tier-2 half of duplicate detection (ADR-0007), and the reason it is asked
 * for a project rather than for a store. Groups of one are left out.
 *
 * Near-identical rather than identical: members are grouped on the opening
 * lowercased with punctuation dropped and runs of whitespace collapsed, so a
 * prompt retyped with a comma moved still lands beside the one it repeats.
 * Two sessions sharing an opening is evidence and not a verdict — what to do
 * about them is the reader's call, which is why nothing here says redundant.
 */
export interface SessionDuplicateGroup {
  /** The first member's opening as it was written, truncated for display. */
  prompt: string
  /** Two or more, always: a lone opening is not a group. */
  members: SessionSummary[]
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

/**
 * Claude's four per-skill listing values (domain.md, read off the Claude Code
 * settings schema): `name-only` lists the skill without its description,
 * `user-invocable-only` hides it from the model but keeps `/name`, and `off`
 * hides it from both. A skill no layer states is `on`.
 *
 * Only `off` is a disabling. The middle two leave the skill loaded, so they
 * narrow what a row *says* and never what it may do.
 */
export type SkillOverride = 'on' | 'name-only' | 'user-invocable-only' | 'off'

/**
 * The winning `skillOverrides` statement about one skill, and the settings
 * layer that made it. The layer travels because a refusal has to name the
 * file a user would edit to undo it (ADR-0006) — "this skill is off" without
 * saying where it was switched off is not an answer anyone can act on.
 */
export interface SkillOverrideState {
  value: SkillOverride
  /** `settings:<layer>:<key>` — the layer that stated it (ADR-0008). */
  layerId: string
  layer: 'user' | 'project' | 'local'
  /** Display path of that layer (tildified). */
  layerPath: string
}

export interface SkillInfo extends EntityIdentity {
  /** `skill:<scope>:<key>` */
  id: string
  name: string
  description: string | null
  scope: SkillScope
  /** Display path of the skill directory (tildified). */
  origin: string
  /**
   * Whether Claude actually loads and offers this skill. Two independent
   * mechanisms have to agree: the directory it sits in (`skills/` rather than
   * the bench) *and* no settings layer switching it `off` via
   * `skillOverrides`. A skill in `skills/` that an override switches off is
   * off, and says so here rather than reading as enabled.
   */
  enabled: boolean
  /**
   * The `skillOverrides` statement that governs this skill, or null when no
   * layer in its scope's chain states one. Carried whatever it says: the two
   * middle values are not disablings, so they show up here without touching
   * `enabled`.
   */
  override: SkillOverrideState | null
  /**
   * True when Claude's own `skillUsage` record in `~/.claude.json` has never
   * counted a use of this name (ADR-0006 — kondo reads Claude's record rather
   * than keeping one of its own). Only whether the name appears crosses the
   * seam; the counts and timestamps behind it stay in the main process.
   */
  neverUsed: boolean
  /**
   * The `project:code:<dirName>` id of the project this skill belongs to, or
   * null for a user-scope or plugin-shipped one. Attribution travels as this
   * field (ADR-0008) — the renderer joins on it and never splits an id.
   */
  projectId: string | null
}

/** The kinds that are one hand-placed file in a directory Claude loads. */
export type PlacedKind = 'agent' | 'command' | 'rule' | 'output-style'

/** Where a placed entry sits: the user store, or one project's store. */
export type PlacedScope = 'user' | 'project'

/**
 * One agent, command, rule or output style, as kondo lists it. The four are
 * one shape because on disk they are one thing — a `.md` file whose
 * frontmatter describes it — differing only in the directory they sit in.
 *
 * Neither toggle has a mechanism (ADR-0006): Claude loads these by presence
 * and offers no `.disabled` sibling and no settings key to bench one, so the
 * matrix refuses both rather than kondo inventing one. `move` is permitted —
 * putting the file in the other scope's directory is exactly how Claude
 * loads it there, so a promotion invents nothing.
 */
export interface PlacedEntryInfo extends EntityIdentity {
  /** `<kind>:user:<name>` · `<kind>:project/<flat>:<name>` */
  id: string
  kind: PlacedKind
  /**
   * The name on disk — the file's, without its `.md`. Never the frontmatter's
   * `name`, which may disagree with it and cannot key anything.
   */
  name: string
  description: string | null
  scope: PlacedScope
  /** Display path of the file that holds it (tildified). */
  origin: string
  /**
   * The `project:code:<dirName>` id of the project this entry belongs to, or
   * null for a user-scope one. Attribution travels as this field (ADR-0008).
   */
  projectId: string | null
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
   * The `project:code:<dirName>` id of the project this layer belongs to, or
   * null for the user layer. The join key (ADR-0008): two projects can share
   * a folder name, so only this tells their layers apart.
   */
  projectId: string | null
  /**
   * That project's folder name, for display. Not unique — two projects can
   * both be called `app` — so it labels a row and never keys one.
   */
  projectLabel: string | null
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
  /**
   * `installed_plugins.json` lists it. False for a ghost row: a key in some
   * layer's `enabledPlugins` naming a plugin nothing installed. Claude reads
   * that key and finds nothing, so kondo lists it rather than hiding it —
   * every other field below is then null or empty, and the same key is an
   * orphan `configOrphansPreview` offers to remove.
   */
  installed: boolean
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
   * What Claude actually honours, resolved once per project. Precedence is a
   * per-project chain (domain.md) — that project's `local`, then its
   * `project`, then the shared `user` layer — so one global winner cannot
   * describe a machine with more than one project. Empty when no layer
   * mentions the plugin at all.
   */
  effectiveIn: PluginEffectiveState[]
}

/** One project's answer for one plugin: which layer won, and what it said. */
export interface PluginEffectiveState {
  /** `project:code:<dirName>`, or null for the user scope's own answer. */
  projectId: string | null
  /** The `settings:<layer>:<key>` id of the layer whose value stands. */
  layerId: string
  enabled: boolean
}

/**
 * Where one MCP server is declared (domain.md):
 *
 * - `user` — `mcpServers` of `~/.claude.json`, in force everywhere.
 * - `local` — `projects[<path>].mcpServers` of the same file: one project's
 *   own servers, private to the machine.
 * - `project` — `mcpServers` of `<project>/.mcp.json`, the file a team
 *   commits. The one Claude-owned file kondo opens outside a `.claude`
 *   directory (ADR-0002).
 */
export type McpScope = 'user' | 'local' | 'project'

/**
 * One MCP server as kondo lists it. Deliberately thin: a declaration also
 * carries `env` and `headers`, which hold API keys and bearer tokens in the
 * wild, so nothing here can be built from either — not their values and not
 * their names. What crosses the seam is where the server is declared and
 * what it is called.
 */
export interface McpServerInfo extends EntityIdentity {
  /** `mcp:user:<name>` · `mcp:local:<flat>/<name>` · `mcp:project:<flat>/<name>` */
  id: string
  name: string
  scope: McpScope
  /**
   * The declared `type` — `stdio`, `http`, `sse` — or `stdio` inferred from a
   * `command`, or `unknown` when the declaration says neither.
   */
  transport: string
  /** Display path of the file that declares it (tildified). */
  source: string
  /**
   * The flattened project path this declaration belongs to (ADR-0009), or
   * null for the user scope.
   */
  project: string | null
  /** False when the owning project's disable list names it. */
  enabled: boolean
  /**
   * The path this declaration is tied to is no longer on disk — a server
   * left behind by a project that has been deleted or moved. Entry 031 is
   * what will be able to remove one.
   */
  orphan: boolean
}

/**
 * What kondo could establish about the script a hook command runs.
 *
 * `missing` is the finding worth having: a settings layer arming a script
 * that is not there is a hook Claude fails every time it fires, and nothing
 * else in the store says so. `unverifiable` is the honest third answer —
 * the path holds a shell variable kondo does not expand, or resolves
 * outside the user store and the verified `.claude` directories, and
 * ADR-0002 says kondo reports rather than reaches.
 */
export type HookScriptStatus = 'present' | 'missing' | 'unverifiable'

/**
 * The script one hook command names. Stat-deep only (ADR-0007): whether the
 * file is there is the whole question, so nothing here was read.
 */
export interface HookScript {
  /**
   * Display path of the script (tildified) when kondo resolved it inside the
   * boundary; otherwise the token exactly as the command wrote it, because
   * a path kondo may not resolve is not a path it may restate.
   */
  path: string
  status: HookScriptStatus
}

export interface HookInfo extends EntityIdentity {
  /** `hook:<settings-layer-id>:<n>` — e.g. `hook:settings:user:user:0`. */
  id: string
  event: string
  matcher: string | null
  command: string
  /**
   * The script that command runs and whether it is there, or null when the
   * command names no script at all — an inline `echo`, a bare binary.
   */
  script: HookScript | null
  /** Display path of the settings file that arms it. */
  source: string
  layer: 'user' | 'project' | 'local'
  /**
   * The `project:code:<dirName>` id of the project whose settings arm it, or
   * null for the user layer (ADR-0008).
   */
  projectId: string | null
  /**
   * That project's folder name, for display; null for the user layer. Not
   * unique — two projects can both be called `app` — so it labels a group
   * and never keys one, exactly as `PluginScopeState.projectLabel` does.
   */
  projectLabel: string | null
}

/**
 * Every hook of one scope, under the project whose settings arm them. The
 * listing is grouped rather than flat because a flat table cannot say which
 * project a row belongs to, and a machine with hooks in several projects is
 * exactly the one where that matters.
 */
export interface HookGroup {
  /** `project:code:<dirName>`, or null for the user layer (ADR-0008). */
  projectId: string | null
  /** The project's folder name, or `Global` for the user layer. */
  label: string
  /** Never empty: a group exists because a hook put it there. */
  hooks: HookInfo[]
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
  /**
   * The `project:code:<dirName>` id of the project this layer belongs to, or
   * null for the user layer (ADR-0008).
   */
  projectId: string | null
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
  /**
   * True when a step of this operation failed part way through. The entry is
   * written before its steps run (ADR-0001), so it describes what was
   * intended; this says the store never got all of it. Undo still applies —
   * it puts back whatever did happen and skips the rest.
   */
  failed: boolean
}

/**
 * The trash as it stands, or — from `trashEmpty` — what emptying removed.
 * Both are the same three facts, so they are the same shape; which one a
 * report describes is the method that returned it.
 */
export interface TrashReport {
  /** Display path of the trash root (tildified). */
  root: string
  bytes: number
  /** Journal ids currently holding displaced bytes. */
  entryCount: number
}

// ---------------------------------------------------------------------------
// Configuration orphans (ADR-0010)

/**
 * What makes one member of a configuration file an orphan — a key Claude
 * still reads and nothing stands behind any more.
 */
export type ConfigOrphanKind =
  /** `projects[<path>]` of `~/.claude.json` whose directory is gone. */
  | 'project-entry'
  /** An `mcpServers` declaration inside one of those entries. */
  | 'mcp-declaration'
  /** An `enabledPlugins` key naming a plugin nothing installed. */
  | 'enabled-plugin'
  /** A `skillOverrides` key naming a skill no scope ships. */
  | 'skill-override'

/**
 * One removable member. It carries no path and no key path: which bytes come
 * out is the main process's business, and the renderer names the row by `id`
 * exactly as it names every other entity (ADR-0008).
 *
 * Nothing here is copied out of an MCP declaration but its name — `env` and
 * `headers` hold API keys and bearer tokens (domain.md), so neither their
 * values nor their key names ever reach this shape.
 */
export interface ConfigOrphan {
  /** `orphan:<kind>:<scope>:<member>`; opaque, and re-resolved per scan. */
  id: string
  kind: ConfigOrphanKind
  /** The member as the user knows it: a path, a server name, a plugin key. */
  name: string
  /** Display path of the file holding it (tildified). */
  source: string
  /** Why kondo calls it an orphan, in one line. */
  reason: string
}

// ---------------------------------------------------------------------------
// The tidy sweep (ADR-0001)

/**
 * What a sweep can reclaim, in the order the preview lists it. Each category
 * is previewed and swept on its own, so a user who wants dead caches gone
 * but every transcript kept can say exactly that.
 *
 * A runtime array, not a bare union, because the renderer builds the preview
 * from it and the main process validates against it — one source of truth.
 *
 * The order is also the precedence that keeps categories exclusive: no path
 * may sit under two of them, so where a whole-tree category claims a project
 * directory the per-file categories skip everything inside it. Scratch comes
 * before dead deliberately — a directory that was only ever temporary is
 * better described by what it was than by the fact its path is now missing.
 */
export const tidyCategories = [
  /**
   * Project directories that were only ever throwaway: the flattened name
   * sits under the OS temp directory, or carries a `.claude-worktrees` /
   * `.claude-jobs` marker, or the directory holds no transcript at all
   * (memory-only included).
   */
  'scratch-projects',
  /** Project directories the registry names whose path no longer stats. */
  'dead-projects',
  /** Transcripts untouched past the stale threshold, sidecar state included. */
  'stale-sessions',
  /** Zero-byte transcripts — a session that recorded nothing at all. */
  'empty-transcripts',
  /** `<uuid>/` sidecar directories whose transcript is already gone. */
  'orphan-sidecars',
  /**
   * `session-env/<uuid>/` snapshots whose session left no transcript behind.
   * Nothing prunes this directory: the observed store held 5,213 of them
   * against 11,686 transcripts.
   */
  'orphan-session-env',
  /** Support directories domain.md marks reclaimable; Claude rebuilds them. */
  'reclaimable-caches',
  /**
   * `plugins/cache/<mp>/<plugin>/<version>/` trees that are not the version
   * `installed_plugins.json` points at. The installed `installPath` is never
   * a candidate — that one is the live code Claude loads.
   */
  'superseded-plugin-versions',
  /**
   * `plugins/data/` directories and `plugins/.install-manifests/` files for
   * `<name>@<marketplace>` ids `installed_plugins.json` does not declare.
   */
  'orphan-plugin-residue',
  /**
   * Files in `~/.claude/hooks/` that no settings layer's `hooks` object
   * runs. A script on disk is not an armed hook (domain.md) — the owner's
   * store held two of them beside an empty `hooks: {}`.
   */
  'unarmed-hook-scripts'
] as const

export type TidyCategory = (typeof tidyCategories)[number]

export interface TidyCategoryPreview {
  category: TidyCategory
  /** Items this category would move; a session and its sidecar count once. */
  count: number
  /**
   * What the store gets back. Transcript and directory bytes as the
   * inventory measured them — a session's sidecar directory rides along
   * uncounted, the same tier-1 limit the sessions view means by "transcript
   * bytes" (ADR-0007). The whole-tree categories are the exception: a
   * project directory is measured, because its size is the whole point of
   * offering it.
   */
  bytes: number
  /** Display paths of the first few, so the count is inspectable. */
  examples: string[]
}

export interface TidyPreview {
  /** Every category, always — a category with nothing to sweep reports zero. */
  categories: TidyCategoryPreview[]
  totalCount: number
  totalBytes: number
  /** The staleness threshold in days, so the UI names it rather than guesses. */
  staleAfterDays: number
}

// ---------------------------------------------------------------------------
// The projects home

/**
 * What one row of the projects list counts. Every number here is the length
 * of a readdir, so drawing the home screen for a machine with thousands of
 * projects opens no file at all (ADR-0007).
 *
 * `hooks` and `mcpServers` are null for exactly that reason: a hook is a
 * fragment of a `settings.json` and an MCP server a key of `~/.claude.json`
 * or `.mcp.json`, so neither can be counted without reading one. Both are
 * counted for the single project `projectDetail` is called for.
 *
 * `skills` counts directories, benched ones included, without opening their
 * `SKILL.md`. A directory with no manifest is not a skill and is therefore
 * counted here and absent from the detail — the one place the two tiers are
 * allowed to disagree, and the price of the count being a readdir.
 */
export interface ProjectRowCounts {
  skills: number
  agents: number
  commands: number
  rules: number
  /** How many of the two settings files this scope actually has. */
  settings: number
  hooks: number | null
  mcpServers: number | null
}

/**
 * One line of the projects home: a project Claude knows about, or the single
 * global row standing for the user store itself.
 *
 * A row is an aggregate over entities rather than an entity, so it carries no
 * capability matrix of its own — the things inside it do, and they arrive
 * with `projectDetail`.
 */
export interface ProjectRow {
  /**
   * `project:code:<dirName>`, or `store:user:user` for the global row — the
   * user store is a store and not a project (ADR-0008).
   */
  id: string
  /** The project's real directory, its flattened name, or `Global`. */
  label: string
  /** Display path of the store this row covers (tildified), or null. */
  path: string | null
  /** True for the one row that is the user store. */
  global: boolean
  /**
   * There is a `.claude` directory to read. False rows still render, with
   * zero counts — a project kondo can name and cannot look inside (ADR-0005).
   */
  hasStore: boolean
  sessionCount: number
  lastActivityMs: number
  counts: ProjectRowCounts
}

/**
 * The three positions of the per-project plugin control. `inherit` is the
 * absence of a statement: this scope says nothing, so the layer above it
 * decides. On a project that reads as "follows global"; on the global row it
 * reads as "not set".
 */
export type ProjectPluginChoice = 'on' | 'off' | 'inherit'

/**
 * One installed plugin as one scope sees it, and where a click would land. A
 * ghost row never reaches here: a key with no plugin behind it has nothing to
 * turn on, and `configOrphansPreview` is where it is acted on.
 */
export interface ProjectPluginState {
  /** `plugin:<name>@<marketplace>` (ADR-0008). */
  pluginId: string
  name: string
  marketplace: string
  /** Which position this scope's own layers put the control in. */
  choice: ProjectPluginChoice
  /** What Claude honours here; null when no layer in the chain speaks. */
  effective: boolean | null
  /** The `settings:` id of the layer whose value stands, or null. */
  effectiveLayerId: string | null
  /**
   * Where a change lands: the highest-precedence layer of this scope that
   * already states a value, else this scope's `settings.local.json`. Chosen
   * in the main process, because which file a write goes to is policy and
   * never the renderer's to pick.
   */
  targetLayerId: string
  /** The matrix row for writing a plugin in the target layer. */
  capabilities: Capabilities
  /**
   * The layers this scope's answer resolves from, highest precedence first —
   * what the chip strip behind the disclosure shows.
   */
  scopes: PluginScopeState[]
}

/**
 * One project page. Tier-2 (ADR-0007): every list here cost a read, and it
 * was paid for the one scope the user opened rather than for all of them.
 *
 * Each list is already narrowed to this scope — the main process filtered on
 * the DTOs' own `projectId` fields (ADR-0008), so the renderer never joins
 * and never splits an id.
 */
export interface ProjectDetail {
  /** The row again, with `hooks` and `mcpServers` counted this time. */
  row: ProjectRow
  skills: SkillInfo[]
  agents: PlacedEntryInfo[]
  commands: PlacedEntryInfo[]
  rules: PlacedEntryInfo[]
  /** Global row only: no project store has an `output-styles` directory. */
  outputStyles: PlacedEntryInfo[]
  hooks: HookInfo[]
  mcpServers: McpServerInfo[]
  settings: SettingsLayerInfo[]
  plugins: ProjectPluginState[]
  /** Empty on the global row: a session belongs to the project it recorded. */
  sessions: SessionSummary[]
  /**
   * What the store holds, on the global row only — the numbers the old size
   * dashboard was. A project's `.claude` is not a store kondo measures.
   */
  storage: StoresOverview | null
}

// ---------------------------------------------------------------------------
// The API surface

/**
 * The seam's methods. `entityList` and `entityMutate` are the generic pair
 * every kind is reached through; the per-kind listings and mutations below
 * them are thin aliases over those two, kept so a shipped view keeps the
 * call it was written against. New work takes the generic pair — the unit of
 * growth here is the operation, not the kind (ADR-0004).
 */
export interface KondoApi {
  /**
   * Every entity of one kind, narrowed to `parentId` for the listings that
   * take one — a plugin's own skills, a project's sessions. The generic
   * listing: the kinds below it are the same call under an older name, kept
   * so shipped views need not change.
   *
   * `kind` and `parentId` are validated in the main process; a kind with no
   * listing, or a parent id of the wrong shape, is a `bad-request`.
   */
  entityList(kind: EntityKind, parentId?: string): Promise<Scan<EntityIdentity[]>>
  /**
   * The one mutating call: every kind, every operation. The entity's kind is
   * read from its id prefix in the main process (ADR-0008) — the renderer
   * hands back the id it was given and parses nothing.
   *
   * Planning stays separate from applying and what it plans stays reversible
   * (ADR-0001). A refusal keeps the capability matrix's own reason (ADR-0006):
   * `not-permitted` for an operation Claude's conventions do not allow,
   * `needs-confirmation` for one that would create a file, `unknown-id` for
   * an id the current scan no longer holds.
   */
  entityMutate(
    entityId: string,
    request: MutateRequest
  ): Promise<Scan<JournalEntryInfo | null>>
  /**
   * The projects home: the global row first, then one row per project Claude
   * knows about, newest activity first. Tier-1 throughout (ADR-0007) — the
   * cached session inventory plus one readdir per directory a row counts, and
   * not one file opened. A project with no `.claude` still gets a row.
   */
  projectsList(refresh?: boolean): Promise<Scan<ProjectRow[]>>
  /**
   * Everything tied to one scope, read for that scope alone: the skills,
   * agents, commands, rules, hooks, MCP servers, settings layers, plugin
   * states and sessions belonging to it. This is the tier-2 half of the
   * projects home, and it is paid for the row the user opened rather than
   * for the whole list (ADR-0007).
   *
   * `id` is a `project:code:` id from `projectsList`, or `store:user:user`
   * for the global row, which additionally answers with the store reports
   * the size dashboard used to be.
   */
  projectDetail(id: string): Promise<Scan<ProjectDetail | null>>
  storesOverview(): Promise<Scan<StoresOverview>>
  sessionProjects(refresh?: boolean): Promise<Scan<SessionProject[]>>
  sessionList(projectId: string): Promise<Scan<SessionSummary[]>>
  sessionDetail(sessionId: string): Promise<Scan<SessionDetail | null>>
  /**
   * Sessions of one project sharing a near-identical opening prompt. Tier-2
   * (ADR-0007) and narrowed on purpose: it streams each of that project's
   * transcripts only as far as its first user message, and never walks the
   * store. Getting an opening is not reading a transcript.
   *
   * What it streams is cached under kondo's data directory keyed by (path,
   * size, mtime), so asking twice re-reads only the transcripts that changed
   * since. The cache is disposable — losing it costs re-parsing and nothing
   * else.
   *
   * A transcript that is empty, truncated or malformed simply has no opening
   * and joins no group (ADR-0005); the read that failed is reported beside
   * the groups that succeeded.
   */
  sessionNearDuplicates(projectId: string): Promise<Scan<SessionDuplicateGroup[]>>
  /**
   * Displace every named session — its transcript and the sibling directory
   * holding its state — into kondo's trash as ONE journal entry, so a single
   * undo restores the whole selection together (ADR-0001). Nothing is ever
   * unlinked.
   *
   * `ids` are `session:code:` ids from a previous scan (ADR-0008), never
   * paths. An id the current scan no longer holds refuses the whole set
   * rather than trashing part of it, and a desktop session is refused in the
   * capability matrix's own words (ADR-0006). An empty selection returns null
   * and writes no entry. A trash changes the tree the inventory was built
   * from, so callers re-read rather than patching.
   */
  sessionTrash(ids: string[]): Promise<Scan<JournalEntryInfo | null>>
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
  /**
   * Skills carrying the same name in more than one scope, with a digest per
   * member so the caller can see whether the copies actually match. Groups of
   * one are left out, and a skill whose name is unique is never hashed
   * (ADR-0007) — the digest is paid for exactly the trees a duplicate name
   * puts in question.
   *
   * A name that repeats is not on its own a reason to remove anything: two
   * skills can share a name and hold different work. `identical` is the fact
   * that matters, and it is false whenever any member could not be read.
   *
   * Removing one is `entityMutate(skillId, { op: 'trash' })` — one journaled
   * step, reversible like every other (ADR-0001), and refused by the matrix
   * for a plugin-shipped skill.
   */
  skillDuplicates(): Promise<Scan<SkillDuplicateGroup[]>>
  pluginsList(): Promise<Scan<PluginInfo[]>>
  /**
   * The skills one installed plugin ships, read from its own install root.
   * Read-only: these are the plugin's, not the user's, so every entry carries
   * the `plugin` skill scope whose matrix row refuses enable, disable and
   * move alike (ADR-0006). They are deliberately absent from `skillsList`.
   *
   * Its own call rather than a field on `PluginInfo`, because listing a skill
   * means reading its `SKILL.md` — tier-2 work no plugins listing should pay
   * for on behalf of rows nobody opened (ADR-0007). A plugin that ships none
   * answers with an empty array and no error; so does one whose `installPath`
   * escaped the user store, which `pluginsList` already reported.
   */
  pluginSkills(pluginId: string): Promise<Scan<SkillInfo[]>>
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
  /**
   * Remove what one settings layer says about one plugin, so the layer above
   * it decides again — the "follows global" position of the per-project
   * control. The inverse of `pluginToggle`, and the only way back to silence:
   * writing `false` states a value, it does not withdraw one.
   *
   * Only that key's bytes leave the file; every other key and the file's own
   * formatting survive. The write is journaled with the previous bytes held
   * in kondo's trash, so undo restores the file exactly (ADR-0001).
   *
   * A layer that already says nothing is refused rather than rewritten, and
   * a layer whose file does not exist is refused too — there is nothing to
   * clear, and nothing licenses creating a file to say less than nothing.
   */
  pluginClear(pluginId: string, layerId: string): Promise<Scan<JournalEntryInfo | null>>
  /**
   * Hand one plugin from one settings layer to another scope as ONE
   * reversible operation (ADR-0001): the destination's `enabledPlugins`
   * gains a `true` and the source's entry becomes `false`, both in the same
   * journal entry, so a single undo puts both files back or neither.
   *
   * Not a relocation (ADR-0006). Nothing installed moves on disk — Claude's
   * convention for "on there, off here" is two explicit statements, and this
   * writes exactly those two and nothing else. Only the two keys' bytes
   * change; every other key and each file's formatting survive untouched.
   *
   * `fromLayerId` is the `settings:` layer the plugin is enabled in; a layer
   * that does not enable it is refused, because there is nothing there to
   * hand on. `destinationId` is `'user'` or a `project:code:` id from a
   * previous scan, the same vocabulary `skillMove` takes — *which* of that
   * scope's layers receives the `true` is policy resolved in the main
   * process, the way `targetLayerId` is, and never the renderer's to pick.
   *
   * A destination whose settings file does not exist yet is refused with
   * `needs-confirmation` and nothing is written, exactly as `pluginToggle`
   * refuses it: the caller shows the path, asks, and repeats the call with
   * `createLayer`.
   */
  pluginMove(
    pluginId: string,
    fromLayerId: string,
    destinationId: string,
    createLayer?: boolean
  ): Promise<Scan<JournalEntryInfo | null>>
  /**
   * Every hook, grouped by the project whose settings layer arms it — the
   * user layer's group first, then one per project. Each row carries the
   * script its command runs and whether that script is there (ADR-0007: a
   * stat, never a read), or `unverifiable` where the path lies outside the
   * boundary ADR-0002 draws.
   */
  hooksList(): Promise<Scan<HookGroup[]>>
  settingsLayers(): Promise<Scan<SettingsLayerInfo[]>>
  /**
   * What a sweep would move, computed without moving anything: counts and
   * bytes per category, off the cached tier-1 inventory rather than a walk
   * of every transcript (ADR-0007). This is the dry run the user confirms.
   */
  tidyPreview(): Promise<Scan<TidyPreview>>
  /**
   * Displace everything in the chosen categories into kondo's trash as ONE
   * journal entry, so a single undo restores the whole sweep together
   * (ADR-0001). Nothing is ever unlinked.
   *
   * The set moved is the set `tidyPreview` named: both read the same cached
   * scan, and an item that disappeared in between refuses the sweep whole
   * rather than quietly moving a different set. Nothing to sweep is the
   * ordinary answer on a tidy store, not an error — it returns null and
   * writes no journal entry. A sweep changes the tree the inventory was
   * built from, so callers re-read rather than patching.
   */
  tidySweep(categories: TidyCategory[]): Promise<Scan<JournalEntryInfo | null>>
  /**
   * Configuration members nothing stands behind any more: `~/.claude.json`
   * project entries whose directory is gone and the MCP servers declared
   * inside them, `enabledPlugins` keys for plugins nothing installed, and
   * `skillOverrides` keys naming a skill no scope ships. A dry run — it
   * reads and removes nothing.
   *
   * Tier-2 (ADR-0007): it opens every settings layer, the registry, and each
   * installed plugin's skills, so it is paid when a user asks for it and
   * never during a listing.
   */
  configOrphansPreview(): Promise<Scan<ConfigOrphan[]>>
  /**
   * Splice the chosen members out as ONE journal entry, so a single undo puts
   * them all back (ADR-0001). Only the spans holding those members leave each
   * file; every other key keeps its bytes and the file's own formatting
   * (ADR-0010).
   *
   * `orphanIds` are ids from `configOrphansPreview`, re-resolved against a
   * fresh scan. A file Claude has rewritten since that scan refuses the whole
   * operation with `stale-file` and writes nothing — Claude's changes are
   * never overwritten and never retried around. Choosing a dead project entry
   * and an MCP server declared inside it is choosing the entry: the wider
   * member covers the narrower one rather than editing the same bytes twice.
   * Nothing to remove returns null and writes no journal entry.
   */
  configOrphansRemove(orphanIds: string[]): Promise<Scan<JournalEntryInfo | null>>
  /** Journal entries, newest first. */
  journalList(): Promise<Scan<JournalEntryInfo[]>>
  /** Reverse one entry; the undo is itself journaled and returned. */
  journalUndo(journalId: string): Promise<Scan<JournalEntryInfo | null>>
  trashSize(): Promise<Scan<TrashReport>>
  /**
   * Permanently remove everything kondo's trash holds. ADR-0001's one
   * destructive act: it is its own operation, called on its own, never a
   * step of another one and never implicit — no other method on this
   * interface removes a trashed byte. The caller must have confirmed it.
   *
   * It is not journaled, because it is the one thing undo cannot reverse.
   * The journal itself survives untouched, so the history stays readable;
   * what the released entries can no longer do is restore. The report
   * returned describes what was *removed*, and a partial failure says so in
   * `errors` — callers re-read `trashSize` rather than assuming zero.
   */
  trashEmpty(): Promise<Scan<TrashReport>>
}

/** Channel names, keyed by KondoApi method — written once, imported twice. */
export const channels = {
  entityList: 'kondo:entity-list',
  entityMutate: 'kondo:entity-mutate',
  projectsList: 'kondo:projects-list',
  projectDetail: 'kondo:project-detail',
  storesOverview: 'kondo:stores-overview',
  sessionProjects: 'kondo:session-projects',
  sessionList: 'kondo:session-list',
  sessionDetail: 'kondo:session-detail',
  sessionNearDuplicates: 'kondo:session-near-duplicates',
  sessionTrash: 'kondo:session-trash',
  desktopSessions: 'kondo:desktop-sessions',
  skillsList: 'kondo:skills-list',
  skillToggle: 'kondo:skill-toggle',
  skillMove: 'kondo:skill-move',
  skillDuplicates: 'kondo:skill-duplicates',
  pluginsList: 'kondo:plugins-list',
  pluginSkills: 'kondo:plugin-skills',
  pluginToggle: 'kondo:plugin-toggle',
  pluginClear: 'kondo:plugin-clear',
  pluginMove: 'kondo:plugin-move',
  hooksList: 'kondo:hooks-list',
  settingsLayers: 'kondo:settings-layers',
  tidyPreview: 'kondo:tidy-preview',
  tidySweep: 'kondo:tidy-sweep',
  configOrphansPreview: 'kondo:config-orphans-preview',
  configOrphansRemove: 'kondo:config-orphans-remove',
  journalList: 'kondo:journal-list',
  journalUndo: 'kondo:journal-undo',
  trashSize: 'kondo:trash-size',
  trashEmpty: 'kondo:trash-empty'
} as const satisfies Record<keyof KondoApi, string>
