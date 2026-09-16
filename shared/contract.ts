/**
 * The seam contract. The single module main, preload, and renderer all
 * import (ADR-0004): every type that crosses IPC, the KondoApi surface, and
 * the channel-name map. Must stay platform-free — no electron, no node
 * imports (enforced by safety.test.ts).
 */

import type { ThemeId } from './themes'
export type { ThemeId } from './themes'

// ---------------------------------------------------------------------------
// Scan envelope (ADR-0005)

export type ScanErrorCode =
  /** Reading a file or directory failed (not ENOENT); the item is missing from data. */
  | 'read-failed'
  /** Saving Kondo's own preference failed; retain the returned theme and offer retry. */
  | 'write-failed'
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
  /** The removal review changed or expired/was used. Review again; nothing moved. */
  | 'stale-plan'
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

/** Kondo's own appearance; never a Claude Code setting or journaled change. */
export interface AppearancePreferences {
  theme: ThemeId
}

// ---------------------------------------------------------------------------
// The Claude profile this process reads (ADR-0003)

/**
 * What chose the Claude configuration directory Kondo reads, highest
 * precedence first: Kondo's `KONDO_STORE_ROOT` fixture override, the
 * `--claude-config-dir` launch argument, an inherited `CLAUDE_CONFIG_DIR`, or
 * Claude Code's default `~/.claude`.
 */
export type ClaudeProfileSource = 'fixture' | 'argument' | 'environment' | 'default'

/**
 * Which Claude profile this Kondo process reads. Main chose it at launch from
 * its own environment and command line, and it cannot change while the process
 * runs: nothing here names a path the renderer could hand back (ADR-0008).
 */
export interface ClaudeProfile {
  source: ClaudeProfileSource
  /** Display path of the Claude configuration directory (tildified). */
  root: string
  /**
   * One sentence per profile selection this launch carried and Kondo did not
   * follow — a `CLAUDE_CONFIG_DIR` a fixture override displaced, or one that
   * is not an absolute path. Built in main; empty is the ordinary case.
   */
  ignored: string[]
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
   * One MCP server declaration. The one change kondo plans for it is Claude's
   * own per-project switch — the `disabledMcpServers` list of that project's
   * `~/.claude.json` entry (ADR-0006) — whose execution 098 refuses. Approval
   * and restriction are read and never written.
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
  /** Main-owned, single-use duplicate-group review required for skill trash. */
  reviewToken?: string
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
  /** Issued only for a safely reviewed identical group. */
  reviewToken?: string | null
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
 *
 * `unreadable` is the third: the registry named the path and the stat did
 * fail, but with something other than ENOENT — a permission kondo does not
 * have, a volume no longer mounted, an I/O error. That is ignorance too,
 * and a louder kind: the scan carries a `stat-failed` error alongside it
 * (ADR-0005). It must never be read as deletion, because the whole point
 * of an unmounted volume is that everything on it is still there.
 */
export type ProjectLocation = 'here' | 'gone' | 'unlocated' | 'unreadable'

export interface SessionProject extends EntityIdentity {
  /** `project:code:<dirName>` */
  id: string
  dirName: string
  /** Which sources named this project; never empty. */
  sources: ProjectSource[]
  /**
   * Whether the main-side project path is on disk, could not be resolved,
   * is unreadable, or is gone. A `gone` project is still a member of the set,
   * with nothing behind it; an `unlocated` one may well be alive under a name kondo
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
  /**
   * The transcript alone, as the listing stat'd it (ADR-0007) — a sidecar
   * directory beside it is not walked to draw a row. What removing this
   * session would move is `SessionTrashPreview.estimate`, which counts every
   * companion; this figure is never that one.
   */
  bytes: number
  mtimeMs: number
  stale: boolean
  /** A sibling directory (subagent/tool state) exists for this session. */
  hasSidecar: boolean
  /**
   * The desktop app left a `<uuid>.desktop-released.json` beside the
   * transcript (domain.md): it has released — on the observed store, deleted
   * — this conversation on its side while the bytes stayed here. A fact
   * about the store, not a verdict; the `desktop-released-sessions` tidy
   * category is where it becomes one.
   */
  releasedByDesktop: boolean
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

/**
 * One reviewed session's exact candidates, as display text.
 *
 * These are the very paths the review token binds (ADR-0015), tildified the
 * way every other display path in this file is. They travel outward only: no
 * handler reads one back, and nothing here authorizes a removal — the token
 * and the ids do (ADR-0008). Their reason for existing is ADR-0016: before a
 * confirmation, the user is told which files move, by name.
 */
export interface SessionRemovalCandidate {
  /** The session's `session:code:<dirName>/<uuid>` id. */
  id: string
  /** The transcript that moves. Always present — it is why the rest moves. */
  transcript: string
  /** Its sidecar directory, or null when the session has none. */
  sidecar: string | null
  /** Its `.desktop-released.json` marker, or null when there is none. */
  releasedMarker: string | null
}

/** Fresh selected metadata and the main-owned removal review it describes. */
export interface SessionTrashPreview {
  reviewToken: string
  count: number
  sessions: SessionSummary[]
  /**
   * Every file this removal will move, one entry per selected session, in the
   * order `sessions` holds them. Disclosed before the confirmation exists
   * (ADR-0016); a selection whose candidates cannot be resolved has no preview
   * at all rather than a partial one.
   */
  candidates: SessionRemovalCandidate[]
  /**
   * The projects the selection spans, so a confirmation can name where the
   * conversations live without the renderer parsing an id (ADR-0008). One
   * entry per distinct project, in first-appearance order.
   */
  projects: SessionRemovalProject[]
  /**
   * What this selection costs, over the exact paths the review token binds —
   * every transcript, its sidecar directory and its released marker. The
   * per-session `bytes` above stay what the listing measured: one transcript.
   */
  estimate: RemovalSizeEstimate
}

/** A project named in a removal disclosure: its row id and its display label. */
export interface SessionRemovalProject {
  /** `project:code:<dirName>`, the same id `projectsList` returns. */
  id: string
  /** What the Projects list calls it, or the flattened key when it has no path. */
  label: string
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

/**
 * A user-scope skill as one project sees it (entry 062). Claude loads a global
 * skill in every project unless that project's own settings layers switch it
 * off with `skillOverrides` (domain.md: local > project > user), so the
 * project page lists what it inherits and offers exactly that switch.
 */
export interface InheritedSkillState {
  /** The global skill itself, with the user row's capabilities. */
  skill: SkillInfo
  /** The `project:code:<dirName>` id of the project looking at it (ADR-0008). */
  projectId: string
  /**
   * What this project's own layers say: `off` when one of them switches the
   * skill off, `inherit` when they say nothing and the global state stands —
   * the plugin control's "off here" / "follows global" pair, for a skill.
   */
  choice: 'off' | 'inherit'
  /** Whether Claude loads the skill in this project: on globally and not off here. */
  enabledHere: boolean
  /**
   * The per-project toggle: `disable` is "off here" and is offered while the
   * project says nothing, `enable` is "follows global" and is offered while
   * it says `off`. Both write this project's layers only — the user layer is
   * the Global page's to change.
   */
  capabilities: Capabilities
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
   *
   * Null when there is no record to read — `~/.claude.json` missing,
   * unreadable, or without a `skillUsage` key. That is not evidence of
   * disuse, so a listing must not badge on it (ADR-0005: no data is not
   * bad data).
   */
  neverUsed: boolean | null
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
/**
 * What one settings layer says about one plugin. `true` and `false` are the
 * only statements Claude's own convention admits (ADR-0006); `'unknown'` is a
 * member that is present but neither, which kondo cannot read as on or off and
 * never resolves precedence with; `null` is a layer that says nothing at all.
 *
 * Silence and an unrecognized value stay distinct values rather than one
 * collapsed `null`, for the reason ADR-0005 gives: where a type could say
 * "not there" or "could not read it", it says both.
 */
export type PluginLayerState = boolean | 'unknown' | null

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
  /** What this layer says, including that it holds something unreadable. */
  enabled: PluginLayerState
  /** The matrix row for writing a plugin in this layer. */
  capabilities: Capabilities
}

/**
 * Claude's four installation scopes, read off the 2.1.271 binary's own
 * version-2 schema for `installed_plugins.json` (domain.md).
 */
export type PluginInstallScope = 'managed' | 'user' | 'project' | 'local'

/**
 * One validated record of `installed_plugins.json`'s `plugins[<id>]` array.
 * Several scopes, projects and versions of one plugin each get a record, so
 * the array is the inventory and no record stands for another.
 */
export interface PluginInstallation {
  scope: PluginInstallScope
  /**
   * Display path of the project this record belongs to (tildified), or null.
   * Claude's schema calls it required for the `project` and `local` scopes;
   * a record missing it is still kept, with null here (ADR-0005).
   */
  projectPath: string | null
  version: string | null
  installedAt: string | null
  lastUpdated: string | null
  /** Display path of the declared install directory (tildified), always. */
  installPath: string
  /**
   * Whether kondo may read that directory. False when the declared path left
   * the user store: the record stays, because it is a fact of the manifest,
   * but nothing is read from it and it ships no components here.
   */
  followed: boolean
}

/**
 * How Claude came to load this plugin. A `record` plugin has an entry in
 * `installed_plugins.json`; a `skills-dir` one is a folder holding
 * `.claude-plugin/plugin.json` under a skills directory, which loads as
 * `<name>@skills-dir` with no marketplace and no install step, so it has no
 * installation record to carry (domain.md).
 */
export type PluginSource = 'record' | 'skills-dir'

export interface PluginInfo extends EntityIdentity {
  /** `plugin:<name>@<marketplace>` */
  id: string
  name: string
  marketplace: string
  /**
   * Kondo found something Claude would load — an `installed_plugins.json`
   * record, or a skills-directory plugin. False for a ghost row: a key in some
   * layer's `enabledPlugins` naming a plugin nothing installed. Claude reads
   * that key and finds nothing, so kondo lists it rather than hiding it —
   * every other field below is then null or empty, and the same key is an
   * orphan `configOrphansPreview` offers to remove.
   */
  installed: boolean
  source: PluginSource
  /**
   * Every place this plugin is installed, ordered by scope rank (`managed`,
   * `user`, `project`, `local`), then project path, version and install path.
   * Array position in the file is not an ordering Claude promises, so the
   * stated one is what keeps the same store rendering the same way twice.
   *
   * Empty for a ghost row and for a skills-directory plugin, which has no
   * record — `source` is what tells those two apart.
   */
  installations: PluginInstallation[]
  /** The first installation's, under the order above; null with none. */
  version: string | null
  /** The first installation's scope, which the capability matrix keys on. */
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
 * The transports Claude Code documents for a declaration's `type`, checked
 * 2026-09-15; `streamable-http` reads as `http`. `unknown` stands for any other
 * type, whose text stays in the main process (ADR-0022).
 */
export type McpTransport = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown'

/**
 * What kondo could establish about one declaration in one place, from the
 * files it reads (domain.md, entry 103). Claude Code decides it from three
 * independent mechanisms — the per-project `disabledMcpServers` switch, the
 * approval of a `.mcp.json` declaration, and the allow and deny lists — and
 * the first of these that holds is what crosses:
 *
 * - `overridden` — a higher-precedence declaration of the same name is the
 *   one Claude uses here, so this one is inert;
 * - `restricted` — a `deniedMcpServers` entry names it;
 * - `rejected` — a `disabledMcpjsonServers` entry rejects it;
 * - `pending` — no approval kondo can read, so Claude Code asks before using
 *   it (a `-p`, SDK or cloud session loads it without asking);
 * - `disabled` — this project's `disabledMcpServers` names it;
 * - `unknown` — a positive answer depends on something kondo may not read:
 *   managed policy, git's view of a local settings file, or a file that did
 *   not parse (ADR-0005);
 * - `approved` — an approval Claude honours here lets the `.mcp.json`
 *   declaration load;
 * - `configured` — a user or local declaration nothing switches off.
 *
 * None of them says the server runs: kondo never starts or contacts one.
 */
export type McpServerStatus =
  | 'configured'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'disabled'
  | 'restricted'
  | 'overridden'
  | 'unknown'

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
   * The declared transport, `stdio` inferred from a `command`, or `unknown`
   * when the declaration says neither or names another type.
   */
  transport: McpTransport
  /** Display path of the file that declares it (tildified). */
  source: string
  /**
   * The flattened project path this declaration belongs to (ADR-0009), or
   * null for the user scope.
   */
  project: string | null
  /**
   * What kondo could establish about this declaration where it is declared:
   * the user scope, or the project whose registry entry or `.mcp.json` holds
   * it. A project evaluates the user scope's declarations for itself —
   * `ProjectDetail.inheritedMcpServers` carries those answers.
   */
  status: McpServerStatus
  /**
   * Why the status is anything but `configured` or `approved`, in one display
   * sentence built in the main process, naming the file that decided it
   * (ADR-0022). Null for those two.
   */
  statusReason: string | null
  /**
   * The path this declaration is tied to is no longer on disk — a server
   * left behind by a project that has been deleted or moved. Its whole
   * registry entry is a settings leftover, and removing one is refused while
   * settings edits are (ADR-0010).
   */
  orphan: boolean
}

/**
 * A user-scope declaration as one project sees it (entry 103). Claude's `/mcp`
 * switch is per project even for a server declared for every project, so the
 * project page lists what it inherits and offers exactly that switch — the
 * shape `InheritedSkillState` gives a global skill.
 */
export interface InheritedMcpServerState {
  /** The user-scope declaration, with its own global row's capabilities. */
  server: McpServerInfo
  /** The `project:code:<dirName>` id of the project looking at it (ADR-0008). */
  projectId: string
  /** What kondo could establish about the declaration in this project. */
  status: McpServerStatus
  /** Why, in the same terms as `McpServerInfo.statusReason`. */
  statusReason: string | null
  /**
   * The per-project switch: `disable` while this project's
   * `disabledMcpServers` does not name the server, `enable` while it does.
   * Both edit that project's registry entry and nothing else.
   */
  capabilities: Capabilities
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
 * The hook events Claude Code documents, in its reference order, checked
 * 2026-09-15. Any other event name stays in the main process (ADR-0022).
 */
export const hookEvents = [
  'SessionStart', 'Setup', 'InstructionsLoaded', 'UserPromptSubmit', 'UserPromptExpansion',
  'MessageDisplay', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure',
  'PostToolBatch', 'PermissionDenied', 'Notification', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'ConfigChange',
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact',
  'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'SessionEnd', 'Elicitation',
  'ElicitationResult'
] as const

export type HookEvent = (typeof hookEvents)[number]

/** The hook handler types Claude Code documents, checked 2026-09-15 (ADR-0022). */
export const hookTypes = ['command', 'http', 'mcp_tool', 'prompt', 'agent'] as const

export type HookType = (typeof hookTypes)[number]

/**
 * One hook declaration as the renderer sees it. Only documented names and
 * validated states cross (ADR-0022): the command, its matcher pattern and any
 * path the command names stay in the main process, because a command line is
 * where tokens and credentials get written.
 */
export interface HookInfo extends EntityIdentity {
  /** `hook:<settings-layer-id>:<n>` — e.g. `hook:settings:user:user:0`. */
  id: string
  /** A documented event, or null for a name Kondo does not recognize. */
  event: HookEvent | null
  /** A documented handler type, or null when the entry states none Kondo recognizes. */
  type: HookType | null
  /** Its group states a matcher other than `*` or an empty string. */
  hasMatcher: boolean
  /**
   * Whether the first script the command names is there, or null when there is
   * no command or it names no script — an inline `echo`, a bare binary.
   */
  script: HookScriptStatus | null
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

/**
 * The top-level names Claude Code's settings reference documents for settings
 * files, checked 2026-09-15, without the seven it places in `~/.claude.json`.
 * A settings-file summary shows no other name (ADR-0022).
 */
export const settingsKeys = [
  'advisorModel', 'agent', 'agentPushNotifEnabled', 'allowAllClaudeAiMcps',
  'allowManagedHooksOnly', 'allowManagedMcpServersOnly', 'allowManagedPermissionRulesOnly',
  'allowedChannelPlugins', 'allowedHttpHookUrls', 'allowedMcpServers', 'alwaysThinkingEnabled',
  'apiKeyHelper', 'askUserQuestionTimeout', 'attribution', 'autoCompactEnabled',
  'autoCompactWindow', 'autoContinueAtUsageLimit', 'autoMemoryDirectory', 'autoMemoryEnabled',
  'autoMode', 'autoScrollEnabled', 'autoUpdatesChannel', 'availableModels', 'awaySummaryEnabled',
  'awsAuthRefresh', 'awsCredentialExport', 'axScreenReader', 'bashOutputMaxChars',
  'blockedMarketplaces', 'browserExternalPageTools', 'channelsEnabled', 'claudeMd',
  'claudeMdExcludes', 'cleanupPeriodDays', 'companyAnnouncements', 'crossSessionInbound',
  'defaultShell', 'deniedMcpServers', 'desktopSessionCleanupPeriodDays', 'dialogExpiry',
  'disableAgentView', 'disableAllHooks', 'disableArtifact', 'disableAutoMode',
  'disableBrowserExternalNavigation', 'disableBundledSkills', 'disableClaudeAiConnectors',
  'disableCommandPluginSources', 'disableDeepLinkRegistration', 'disableDesktopLocalSessions',
  'disableMobileSimulatorTools', 'disableRemoteControl', 'disableSideloadFlags',
  'disableSkillShellExecution', 'disableWorkflows', 'disabledMcpjsonServers', 'editorMode',
  'effortLevel', 'emojiCompletionEnabled', 'enableAllProjectMcpServers', 'enableArtifact',
  'enableWorkflows', 'enabledMcpjsonServers', 'enabledPlugins', 'enforceAvailableModels', 'env',
  'extraKnownMarketplaces', 'fallbackModel', 'fastMode', 'fastModePerSessionOptIn',
  'feedbackDrafts', 'feedbackSurveyRate', 'fileCheckpointingEnabled', 'fileSuggestion',
  'footerLinksRegexes', 'forceLoginGatewayUrl', 'forceLoginMethod', 'forceLoginOrgUUID',
  'forceRemoteSettingsRefresh', 'gcpAuthRefresh', 'hooks', 'httpHookAllowedEnvVars',
  'includeCoAuthoredBy', 'includeGitInstructions', 'inputNeededNotifEnabled',
  'isolatePeerMachines', 'keybindingFlavor', 'language', 'managedMcpServers',
  'managedSourcesBehavior', 'maxEffortLevel', 'minimumVersion', 'model', 'modelOverrides',
  'modelPicker', 'modelPricing', 'modelSettings', 'otelHeadersHelper', 'outputStyle',
  'parentSettingsBehavior', 'permissions', 'plansDirectory', 'pluginConfigs',
  'pluginSuggestionMarketplaces', 'pluginTrustMessage', 'policyHelper', 'prUrlTemplate',
  'preferredNotifChannel', 'prefersReducedMotion', 'processWrapper', 'promptCacheTtl',
  'promptSuggestionEnabled', 'remoteControlAtStartup', 'requiredMaximumVersion',
  'requiredMinimumVersion', 'respectGitignore', 'respondToBashCommands', 'sandbox',
  'showClearContextOnPlanAccept', 'showThinkingSummaries', 'showTurnDuration',
  'skillListingBudgetFraction', 'skillListingMaxDescChars', 'skillOverrides',
  'skipAutoPermissionPrompt', 'skipDangerousModePermissionPrompt', 'skipWebFetchPreflight',
  'spellcheck', 'spinnerTipsEnabled', 'spinnerTipsOverride', 'spinnerVerbs', 'sshConfigs',
  'sshHostAllowlist', 'statusLine', 'strictKnownMarketplaces', 'strictPluginOnlyCustomization',
  'subagentPromptCacheTtl', 'subagentStatusLine', 'switchModelsOnFlag', 'syncClaudeAiSkills',
  'syntaxHighlightingDisabled', 'taskOutputMaxChars', 'teammateMode', 'terminalProgressBarEnabled',
  'terminalTitleFromRename', 'theme', 'timeFormat', 'timeZone', 'tui', 'ultracode',
  'useAutoModeDuringPlan', 'verbose', 'viewMode', 'vimInsertModeRemaps', 'voice', 'voiceEnabled',
  'wheelScrollAccelerationEnabled', 'workflowKeywordTriggerEnabled', 'workflowSizeGuideline',
  'worktree', 'wslInheritsWindowsSettings'
] as const

export type SettingsKey = (typeof settingsKeys)[number]

export interface SettingsLayerInfo extends EntityIdentity {
  /** `settings:<layer>:<key>` */
  id: string
  layer: 'user' | 'project' | 'local'
  /** Display path of the file. */
  path: string
  exists: boolean
  bytes: number
  /** The documented top-level names this file states, in file order; no value crosses. */
  keys: SettingsKey[]
  /** It also states top-level names outside `settingsKeys`, which stay in main. */
  unlistedKeys: boolean
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
  /** Compatibility flag for incomplete/failed execution; use outcome for its effects. */
  failed: boolean
  /** Confirmed effects; uncertain means a pending action or legacy failure lacks proof. */
  outcome: 'complete' | 'partial' | 'none' | 'uncertain'
  /** Undo progress for this original operation, derived from its durable attempt. */
  recovery: 'available' | 'partial' | 'uncertain' | 'done' | 'blocked'
  /** Visible explanation from main when Undo cannot safely be offered. */
  undoBlockedReason: string | null
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

/**
 * What a reviewed removal costs, measured over the exact deduplicated trash
 * steps the review token binds (ADR-0015) — companions included, and counted
 * the way `trashSize` counts the trash, so the trash grows by exactly
 * `movingBytes`.
 *
 * Three figures and not one, because a move and a deletion are different
 * things: moving to kondo's trash frees no disk space at all, and only a
 * permanent empty does. `freedOnEmptyBytes` equals `trashBytesAfter` — kondo's
 * trash holds nothing but displaced bytes — and both are carried so the
 * renderer states each figure rather than deriving one from another.
 */
export interface RemovalSizeEstimate {
  /** Regular-file bytes that will move, sidecars and markers counted. */
  movingBytes: number
  /** What kondo's trash holds right now. */
  trashBytesBefore: number
  /** What it holds once the move lands: `trashBytesBefore + movingBytes`. */
  trashBytesAfter: number
  /** What permanently emptying the trash would then free from disk. */
  freedOnEmptyBytes: number
  /**
   * A reviewed path could not be read, the trash could not be measured, or no
   * review token bound the figure. The numbers are a floor, not a total, and
   * the UI says so rather than showing them as exact.
   */
  incomplete: boolean
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
   * `.claude-jobs` marker, or the directory holds no transcript, no memory
   * and no located path. Recent, memory-bearing or unsafe scratch trees are
   * withheld; a temporary name alone does not prove disuse.
   */
  'scratch-projects',
  /** Project directories the registry names whose path no longer stats. */
  'dead-projects',
  /** Transcripts untouched past the stale threshold, sidecar state included. */
  'stale-sessions',
  /** Zero-byte transcripts — a session that recorded nothing at all. */
  'empty-transcripts',
  /**
   * Transcripts the desktop app has marked released (`reason: "delete"` on
   * every one observed) with a `<uuid>.desktop-released.json` beside them:
   * deleted on the desktop side, still on disk here. Sidecar and marker go
   * with the transcript.
   */
  'desktop-released-sessions',
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
   * Chromium's own caches inside the Claude desktop app's data directory —
   * `Cache`, `Code Cache`, `GPUCache`, the two Dawn caches and `Shared
   * Dictionary`, at the root and inside each `Partitions/<name>/` — which the
   * app rebuilds on its next launch (domain.md). Nothing else in that store is
   * offered: session data, uploads and the VM bundle are not caches.
   */
  'desktop-caches',
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
   * Regular-file bytes under every path this category's reviewed trash steps
   * name, a session's sidecar directory and released marker included. Counted
   * the way `trashSize` counts the trash, so a sweep of this category alone
   * grows the trash by exactly this. Categories are disjoint: a path counted
   * here is counted in no other, which is what makes summing a multi-category
   * selection honest.
   *
   * The field kept its name when entry 105 changed what it counts. It used to
   * be the transcript and directory bytes the inventory had already stat'd,
   * with a session's companions riding along uncounted; it is now every
   * reviewed trash-step byte. A reader of this seam should not carry the old
   * transcript-only reading across — and `SessionSummary.bytes`, which is
   * still one transcript, is the field that kept the old meaning.
   */
  bytes: number
  /** Display paths of the first few, so the count is inspectable. */
  examples: string[]
  /**
   * Why this category cannot be swept right now, or null when it can. The
   * desktop caches are the case: while the desktop app runs it holds them
   * open, so a sweep would fail part way, and the preview says so instead.
   */
  blocked: string | null
}

export interface TidyPreview {
  /** Scratch/worktree trees kept for memory, recent activity, or an unsafe scan. */
  withheldScratchCount: number
  /** Null when the preview could not be bound to complete, safely read candidates. */
  reviewToken: string | null
  /** Every category, always — a category with nothing to sweep reports zero. */
  categories: TidyCategoryPreview[]
  totalCount: number
  totalBytes: number
  /**
   * What sweeping every category would cost. A selection is narrower, so the
   * UI adds the categories it picked to `estimate.trashBytesBefore` rather
   * than quoting this — but `incomplete` here covers the whole preview.
   */
  estimate: RemovalSizeEstimate
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
  /**
   * What the row is called on screen: the last segment of the real directory
   * (`kondo` for `D:/Projects/kondo`), the flattened name when kondo has no
   * path, or `Global`. Built main-side — the renderer never splits a path
   * (ADR-0008). On a real store every label shares a long prefix, so the
   * name is what tells rows apart at a glance.
   */
  name: string
  /** The directory the project sits in, as a display path, or null. */
  parent: string | null
  /** Display path of the store this row covers (tildified), or null. */
  path: string | null
  /** True for the one row that is the user store. */
  global: boolean
  /**
   * Whether the project's directory is still there (ADR-0009). A `gone` row
   * has nothing to open, so the projects home folds those away behind a count
   * by default — 11,4xx of 11,5xx rows on the owner's store.
   */
  location: ProjectLocation
  /**
   * Named like a run Claude did for itself — under the OS temp root, or with
   * a `.claude-worktrees` / `.claude-jobs` segment — the same rule Clean up's
   * Throwaway folders row uses. Folded away with the `gone` rows by default:
   * 8,498 of 11,518 rows on the owner's store.
   */
  throwaway: boolean
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
 * Where the control actually sits, which has one position no click can ask
 * for: this scope's own layer holds a value that is neither `true` nor
 * `false`, so none of the three is pressed and the reason is printed instead.
 */
export type ProjectPluginPosition = ProjectPluginChoice | 'unknown'

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
  /**
   * The same two fields `PluginInfo` carries, so a project page attributes a
   * plugin exactly as the Library does rather than describing it its own way.
   */
  source: PluginSource
  installations: PluginInstallation[]
  /** Which position this scope's own layers put the control in. */
  choice: ProjectPluginPosition
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
  /**
   * The global skills this project inherits and may switch off for itself
   * (entry 062). Empty on the global row, whose own skills are `skills`.
   */
  inheritedSkills: InheritedSkillState[]
  /**
   * The user-scope MCP declarations this project inherits, with what each is
   * in this project and the switch it has for it (entry 103). Empty on the
   * global row, whose own declarations are `mcpServers`.
   */
  inheritedMcpServers: InheritedMcpServerState[]
  /** Empty on the global row: a session belongs to the project it recorded. */
  sessions: SessionSummary[]
  /**
   * The day count behind `SessionSummary.stale`, so the flag a row wears
   * names the same threshold `TidyPreview.staleAfterDays` does.
   */
  staleAfterDays: number
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
  /** Read Kondo's appearance, with Chalk fallback and any preference problems. */
  appearanceGet(): Promise<Scan<AppearancePreferences>>
  /** Save a recognized theme; failure returns the previous usable preference. */
  appearanceSet(theme: ThemeId): Promise<Scan<AppearancePreferences>>
  /**
   * Which Claude profile this process reads and how its launch chose it, so
   * the window can say so. It takes no argument and accepts no directory: the
   * profile is selected before the single-instance lock and never changes
   * (ADR-0004).
   */
  profileGet(): Promise<Scan<ClaudeProfile>>
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
   * paths. First call sessionTrashPreview and show its fresh summaries, then
   * pass its single-use reviewToken with the same IDs. Main streams complete
   * transcripts and related state to bind identity, content and activity;
   * any change refuses the entire selection before journaling. Desktop
   * sessions are refused in the
   * capability matrix's own words (ADR-0006). An empty selection returns null
   * and writes no entry. A trash changes the tree the inventory was built
   * from, so callers re-read rather than patching.
   */
  sessionTrashPreview(ids: string[]): Promise<Scan<SessionTrashPreview | null>>
  sessionTrash(ids: string[], reviewToken?: string): Promise<Scan<JournalEntryInfo | null>>
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
   * Removing one requires its identical group reviewToken in
   * `entityMutate(skillId, { op: 'trash', reviewToken })` — one journaled
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
   * bytes per category from a forced fresh inventory. Main snapshots the
   * complete candidates with streamed content digests and retains them under
   * the returned opaque reviewToken. Unsafe previews have a null token.
   */
  tidyPreview(): Promise<Scan<TidyPreview>>
  /**
   * Displace everything in the chosen categories into kondo's trash as ONE
   * journal entry, so a single undo restores the whole sweep together
   * (ADR-0001). Nothing is ever unlinked.
   *
   * The token binds the exact candidates `tidyPreview` reviewed. Selected
   * category membership, identities, content and activity are rechecked before
   * journaling. A missing/expired/used token or a changed selection refuses
   * with stale-plan; it never adds candidates or partially deletes a set.
   * Nothing to sweep with an unchanged review is the
   * ordinary answer on a tidy store, not an error — it returns null and
   * writes no journal entry. A sweep changes the tree the inventory was
   * built from, so callers re-read rather than patching.
   */
  tidySweep(categories: TidyCategory[], reviewToken?: string): Promise<Scan<JournalEntryInfo | null>>
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

/**
 * Window lifecycle, not data: the renderer sends this once its first read has
 * settled, and the main process holds the splash until it arrives. It is kept
 * out of `KondoApi` deliberately — the workspace has nothing to implement here
 * (ADR-0004: the bridge carries operations against the store, and this is not
 * one).
 */
export const rendererReadyChannel = 'kondo:renderer-ready'

/** Reload only the sending main window; accepts no destination (ADR-0014). */
export const rendererReloadChannel = 'kondo:renderer-reload'

/** Channel names, keyed by KondoApi method — written once, imported twice. */
export const channels = {
  appearanceGet: 'kondo:appearance-get',
  appearanceSet: 'kondo:appearance-set',
  profileGet: 'kondo:profile-get',
  entityList: 'kondo:entity-list',
  entityMutate: 'kondo:entity-mutate',
  projectsList: 'kondo:projects-list',
  projectDetail: 'kondo:project-detail',
  storesOverview: 'kondo:stores-overview',
  sessionProjects: 'kondo:session-projects',
  sessionList: 'kondo:session-list',
  sessionDetail: 'kondo:session-detail',
  sessionNearDuplicates: 'kondo:session-near-duplicates',
  sessionTrashPreview: 'kondo:session-trash-preview',
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
