# The Claude data landscape

Everything kondo knows about Claude's on-disk world. This document is the
single source of truth for store facts; adapters implement it, tests encode
it, and PRs that learn something new must update it.

None of these formats are publicly documented or stable. Every fact carries a
marker:

- ✅ **verified** — observed directly on a real machine (last: 2026-09-01,
  Windows, Claude Code ~2.x).
- ◇ **expected** — inferred from platform conventions or public knowledge;
  verify before relying on it in code.

Adapters must treat all of it as best-effort: unknown files appear, schemas
drift. Unknown ≠ error (see ADR-0005).

## The three store kinds

| Store | Location | Owner |
|---|---|---|
| User store | `~/.claude` ✅ | Claude Code CLI |
| User registry | `~/.claude.json` ✅ — one file beside the user store, see below | Claude Code CLI |
| Project store | `<project>/.claude` ✅ | Claude Code CLI, per project |
| Desktop store | Windows: `%APPDATA%\Claude` ✅ · macOS: `~/Library/Application Support/Claude` ◇ · Linux: `~/.config/Claude` ◇ | Claude desktop app (Electron `userData`) |

The privacy boundary (ADR-0002): inside a project, kondo opens **only** the
`.claude` directory. Everything else in the project is off-limits, with one
named exception: `<project>/.mcp.json` (project-scope MCP servers), which the
ADR-0002 amendment grants and `test/boundary.test.ts` pins. Outside a
`.claude` directory kondo opens exactly two files — that one and
`~/.claude.json` — and stats exactly one path, the project root.

## User store: `~/.claude`

Observed top-level entries ✅ (one machine; expect variation by version and
usage):

| Entry | What it is |
|---|---|
| `projects/` | Session transcripts, one subdirectory per working directory. The heart of kondo's session features. |
| `settings.json` | User-scope settings. Observed keys: `env`, `permissions`, `skillOverrides`, `hooks`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `outputStyle`, `language`, `modelSettings`, `autoUpdatesChannel`, `tui`, `theme`, and more ✅. The toggle surfaces kondo cares about: `enabledPlugins`, `skillOverrides`, `hooks`. `skillOverrides` is `{ <skill> → 'on' \| 'off' }` in the wild ✅ (Claude's docs name `'off'` and `'user-invocable-only'`); it is Claude's documented per-skill switch and reaches plugin-shipped skills. Kondo reads it for one thing only — a key naming a skill no scope ships is a configuration orphan it offers to splice out (ADR-0010). How the switch itself sits beside `skills.disabled` is still entry 029. The `hooks` object is `{ <event> → [ { matcher?, hooks: [ { type, command, timeout? } ] } ] }` ✅. |
| `enabledPlugins` | An object keyed by `<plugin>@<marketplace>` whose value is a boolean — both `true` and an explicit `false` observed in the wild ✅. An explicit `false` is how a layer overrides a lower one, so it is what kondo writes to disable; a key that is simply absent is silence, not a false. A legacy array form is read (a listed key is enabled) but never written. |
| `skills/` | User-scope skills, one directory per skill with a `SKILL.md`. |
| `skills.disabled/` | Claude's own disable convention: a skill moved here stops loading ✅. Kondo adopts this for enable/disable (ADR-0006). |
| `plugins/cache/<mp>/<plugin>/<ver>/skills/` | Skills a plugin ships ✅. These belong to the plugin, not the user: kondo's skills catalogue deliberately excludes them, because benching or relocating one leaves the plugin referring to a directory that is no longer there. They belong to the plugins view, alongside the plugin that owns them, where `pluginSkills(pluginId)` reads them on demand when a plugin's row is opened. The `plugin` skill scope and its capability-matrix row keep that listing read-only. |
| `plugins/` | Plugin machinery ✅: `installed_plugins.json` (`version: 2`, `plugins[<name>@<marketplace>]` = array of `{ scope, installPath, version, installedAt, lastUpdated, gitCommitSha }`), `known_marketplaces.json`, `plugin-catalog-cache.json` (holds keys differing only by case — parse case-sensitively), `cache/<marketplace>/<plugin>/<version>/` (the installed code), `marketplaces/`, `data/<plugin>-<marketplace>/`, `.install-manifests/<id>.json`, `.last_inuse_sweep`. Residue accumulates ✅: 28 of 39 cached version directories were not the installed version, `.in_use` markers sat on every version (so the marker does not mean "current"), 4 install manifests and 47 of 55 `data/` directories belonged to plugins no longer installed. Cleanup target for entry 033. |
| `commands/` | User-scope slash commands (`.md` files) ✅. Read as placed entries — see below. |
| `hooks/` | Hook scripts ✅. Two scripts observed while `settings.json` `hooks` was `{}` — a script on disk is not an armed hook; only a settings entry arms one. |
| `agents/`, `output-styles/`, `rules/` | User-scope subagents, output styles and rules ◇ (documented by Claude Code; absent on this machine). Read as placed entries — see below. |
| `history.jsonl` | Global prompt history. Line schema: `display`, `pastedContents`, `timestamp`, `project`, `sessionId` ✅. |
| `sessions/` | Live-session registry: `<pid>.json` + `<pid>.<hash>.key` pairs ✅. Presence ≠ running; stale entries linger. |
| `session-env/` | Per-session environment snapshots, one dir per session id ✅. Orphan-sweep candidate. |
| `tasks/` | Background task state, one dir per task id ✅ (`pins.json` ◇, not seen on the last pass). |
| `jobs/` | Job state, dirs per job id ✅. |
| `file-history/` | Edit history backing checkpoint/rewind ✅. Grows silently; tidy candidate. |
| `shell-snapshots/` | Shell state snapshots ✅. Tidy candidate. |
| `backups/`, `paste-cache/`, `cache/`, `debug/`, `telemetry/`, `downloads/`, `ide/` | Support and cache directories ✅. Reclaimable space lives here. |
| `daemon`, `daemon.log` | Daemon socket/state and log ✅. |
| `stats-cache.json`, `statusline-command.sh`, `CLAUDE.md` | Misc: usage stats cache, statusline script, the user's global instructions ✅. `todos/` ◇ (documented, absent here). |
| `feedback/`, `daemon-auth-cooldown`, `daemon-auth-status.json`, `gh-pr-status-cache.json`, `.last-update-result.json`, `.last-cleanup`, `statusline-command.sh.bak`, marker files (`.caveman-active`, …) | Small support and state files ✅. Listed by name and size only. |
| `.credentials.json`, `.claude.json`, `.mcp.json` | Inside the user store: a credentials file (**read-never**, like the desktop token files), and two small JSON files (`.mcp.json` held an empty `mcpServers`) ✅. Not to be confused with `~/.claude.json` below. |

### `~/.claude.json` — the registry

One file beside the store, ~2 MB, 87 top-level keys ✅, rewritten by Claude
during every session. Kondo reads it as one parse per inventory and keeps
only the parts named here (ADR-0009):

- `projects` ✅ — an object keyed by the **absolute path** of every directory
  Claude Code has run in (4,335 keys observed; 4,309 spelled with `/` on
  Windows and 26 with `\`, 17 paths present under both spellings). This is
  the reverse map for `projects/` below. Per entry, the keys kondo cares
  about: `mcpServers` (per-project MCP servers, 20 entries observed),
  `disabledMcpServers` (7), `enabledMcpjsonServers` / `disabledMcpjsonServers`
  (empty arrays here), `allowedTools`. The rest — `lastSessionFirstPrompt`,
  `lastCost`, token counts, `lastSessionId` — is session telemetry kondo
  never surfaces. 52 keys pointed at directories that no longer exist ✅:
  that is the dead-project signal (entry 030). These keys are also **half of
  the project set**: kondo lists the union of them and the `projects/`
  directories below, joined on the flattened path, so a directory Claude has
  registered but never kept a transcript for is still a project. Each member
  carries `sources` (`registry`, `transcripts`, or both), `pathExists`, and
  `hasStore` — the last being whether it holds a `.claude` at all.
- `mcpServers` ✅ — user-scope MCP servers: `{ name → { type, command, args,
  env } | { type, url, headers } }`. `env` and `headers` can hold secrets.
- `skillUsage` and `pluginUsage` ✅ — usage counters keyed by skill and
  plugin name; the "never used" signal for entry 032.
- Everything else (`oauthAccount`, `userID`, `machineID`, experiment caches)
  is identity or telemetry and is **read-never**.

Kondo writes this file by splice only — never whole (ADR-0010): a step names
the bytes it changes and the digest they were read from, and refuses when
Claude has written the file since. `configOrphansPreview` /
`configOrphansRemove` are the first callers, taking out `projects` entries
whose directory is gone and the `mcpServers` declared inside them.

### MCP servers — three scopes, two files

An MCP server declaration is `{ type?, command, args?, env? }` for a local
process or `{ type, url, headers? }` for a remote one ✅. **`env` and
`headers` hold API keys and bearer tokens**, so kondo builds nothing from
either — not their values and not their key names. What it keeps is the name,
the transport, and the file that declares it.

| Scope | Where | Id | Disabled by |
|---|---|---|---|
| `user` | `mcpServers` of `~/.claude.json` ✅ | `mcp:user:<name>` | nothing — the user scope has no disable list |
| `local` | `projects[<abs path>].mcpServers` of `~/.claude.json` ✅ (20 entries observed) | `mcp:local:<flat>/<name>` | `projects[<abs path>].disabledMcpServers` ✅ (7 observed) |
| `project` | `mcpServers` of `<project>/.mcp.json` ✅ | `mcp:project:<flat>/<name>` | `projects[<abs path>].disabledMcpjsonServers` ✅ (empty array here) |

`<flat>` is the flattened project path (ADR-0009), which is what joins a
declaration to the project directory it belongs to. A `local` declaration
whose registry path is no longer on disk is reported with `orphan: true` —
the dead-project signal in its MCP form, and what `configOrphansPreview`
offers to splice out (ADR-0010). Discovery is tier-1 (ADR-0007): one registry
parse, one `stat` per registry entry that actually declares a server, one
`.mcp.json` read per verified project. The kind is read-only in all three
scopes; the capability matrix refuses enable, disable and move. Entry 031
shipped the splice step `~/.claude.json` can survive, so the obstacle is no
longer the write path — nothing has yet wired an MCP toggle to it.

`~/.claude/.mcp.json` also exists inside the user store (empty `mcpServers`
on the observed machine ✅) and is **not** one of the three scopes above;
kondo does not read it.

### Placed entries — skills, agents, commands, rules, output styles

What the user put in a directory Claude loads. On disk they take one of two
shapes, and that shape — not the kind — is what a reader needs to know:

- **skill directory** — `<name>/SKILL.md`, the shape `skills/` and
  `skills.disabled/` hold ✅.
- **single markdown file** — `<name>.md`, whose own frontmatter carries a
  `description` ✅. The shape the four kinds below hold.

The **name on disk keys the entity**, never the frontmatter's `name`: the two
can disagree, and only the filename is unique within a directory. Frontmatter
that is missing or malformed leaves `description` null and is not an error
(ADR-0005).

| Kind | User store | Project store | Id |
|---|---|---|---|
| `agent` | `~/.claude/agents/*.md` ◇ | `<project>/.claude/agents/*.md` ✅ | `agent:user:<name>` · `agent:project/<flat>:<name>` |
| `command` | `~/.claude/commands/*.md` ✅ | `<project>/.claude/commands/*.md` ◇ | `command:user:<name>` · `command:project/<flat>:<name>` |
| `rule` | `~/.claude/rules/*.md` ◇ | `<project>/.claude/rules/*.md` ✅ | `rule:user:<name>` · `rule:project/<flat>:<name>` |
| `output-style` | `~/.claude/output-styles/*.md` ◇ | not read — unobserved in a project store | `output-style:user:<name>` |

All four are **read-only in every scope**. Claude loads them by presence:
there is no `.disabled` sibling directory and no settings key that benches
one, so the capability matrix refuses `enable` and `disable` outright rather
than kondo inventing a mechanism (ADR-0006). `move` is refused too, until
entry 028 generalises the skill placement table to them. The owning project
travels as `PlacedEntryInfo.projectId`, never as a substring the renderer
splits out of an id (ADR-0008).

### `projects/` — sessions

- One directory per working directory Claude Code has run in, named by
  flattening the absolute path: **every character outside `[A-Za-z0-9]`
  becomes `-`** ✅ — `D:\Programs\cmder` → `D--Programs-cmder`,
  `C:\Users\X\.claude-jobs\...` → `C--Users-X--claude-jobs-...`,
  `D:\Projects\my-app` → `D--Projects-my-app`, `snake_case` → `snake-case`.
  The flattening is lossy, so the name cannot be reversed; the reverse map is
  the `projects` object of `~/.claude.json` above, flattened with the same
  rule (ADR-0009). On the owner's machine that named 1,443 of 9,171
  directories, against 7 for the old un-flattening guess; the rest are
  scratch directories Claude has already forgotten. Kondo still stats the
  path before claiming it.
- Scale is real: **9,171 project directories** observed on one machine ✅
  (9,031 of them under a temp directory — benchmark and scratchpad runs).
  Scanning must be stat-based and lazy; never parse every transcript up front
  (ADR-0007).
- Inside a project directory ✅:
  - `<session-uuid>.jsonl` — the transcript, append-only JSONL.
  - `<session-uuid>/` — optional sibling directory (subagent transcripts,
    tool state, a `custom-title.json`). A sibling without its `.jsonl` is an
    orphan.
  - `memory/` — the project's persistent memory files. 17 directories held
    only `memory/` and 23 held no transcript at all ✅ — leftovers of
    projects no longer worked on (entry 030).
  - Occasional top-level `.json` files ◇ (five seen in one directory; not
    yet understood, reported as unknown).
- Transcript lines are typed events. First line observed with keys `type`,
  `leafUuid`, `sessionId` ✅; message lines carry timestamps and roles ◇.
  Kondo reads the first and last lines to bound a session in time, and
  message timestamps (streamed, never whole-file) for worked time.

## Project store: `<project>/.claude`

- `settings.json` (project scope, committed) and `settings.local.json`
  (local scope, git-ignored) ◇ — same schema family as user settings;
  `enabledPlugins`, `hooks`, `permissions` appear here too.
- `skills/`, `agents/`, `rules/`, `hooks/` ✅ — project-scope variants,
  observed in every sampled project store (`agents/*.md`, `rules/*.md`,
  `hooks/` scripts with `__pycache__` and `*.test.js` noise beside them).
  `commands/` ◇. Kondo reads `skills/`, `agents/`, `commands/` and `rules/`
  (see "Placed entries" above); `hooks/` holds scripts, and a script on disk
  is not an armed hook, so it is read through the settings layers instead.
- `worktrees/` and `docs/` ✅ — seen in one store. Claude registers a git
  worktree under `.claude/worktrees/` as a project of its own in
  `~/.claude.json`, so it is both inside the boundary and a duplicate-project
  candidate (entry 030).
- `CLAUDE.md` ◇ — the in-boundary placement of a project's instructions.
  `./CLAUDE.md` and `CLAUDE.local.md` at the project root are outside
  ADR-0002 and invisible by design.
- `.claude/settings.local.json` also carries `enabledPlugins` in the wild ✅,
  alongside `settings.json`.
- `skills.disabled/` ◇ — the project-scope counterpart of the user store's
  disable convention. Unobserved in the wild; kondo writes it because ADR-0006
  chose the scoped equivalent over inventing state, and reads it back as the
  `project-disabled` skill scope.
- Settings precedence: local > project > user ◇. The settings viewer renders
  these as layers, and the plugins view resolves a plugin's state through
  them: the highest layer that states a value is the one that wins. Layers
  belonging to different projects share a rank — Claude resolves settings per
  session, so across projects there is no ordering to have. That makes the
  resolution **per project**, not global: `PluginInfo.effectiveIn` holds one
  answer per project (its `local`, then its `project`, then the shared
  `user` layer) plus one for the user scope on its own. A plugin no layer
  mentions resolves nowhere and `effectiveIn` is empty.
- A per-project plugin control therefore has three positions, not two: on
  here, off here, and **saying nothing**, which lets the layer above decide.
  Writing `false` is not the third one — it states a value like any other, so
  the way back to silence is removing the member from `enabledPlugins`
  (`pluginClear`). Which file a position writes is chosen in the main process:
  the highest-precedence layer of that scope that *already states a value*,
  and `settings.local.json` when none does.

## Desktop store

Electron app data. Mostly standard Chromium/Electron directories (`Cache`,
`IndexedDB`, `Local Storage`, `Partitions`, …) ✅ that kondo reports only as
bulk size. The Claude-specific parts ✅:

- `local-agent-mode-sessions/<device-or-install-uuid>/<account-uuid>/` —
  desktop/cowork sessions:
  - `local_<session-uuid>.json` + `local_<session-uuid>/` per session ✅
  - `agent/`, `artifacts.json`, `cowork-*-cache.json` ✅
- `Claude Extensions`, `Claude Extensions Settings` ✅ — desktop extensions.
- `ant-device-registry.json`, `ant-did`, `bridge-state.json`,
  `buddy-tokens.json` ✅ — device/identity state. **Read-never**: kondo lists
  names and sizes but does not open identity or token files.
- Cloud sessions (claude.ai) have no local files unless mirrored here; kondo
  only sees what is on disk.

## Cross-store facts

- A session id is a UUID and appears in: its transcript filename, the
  transcript's lines, `history.jsonl` entries, `session-env/`, and possibly a
  desktop-store directory — this is how kondo will join data across stores to
  find duplicates (entry 034); today only the transcript and its sidecar are
  joined. `session-env/` held 5,213 directories against 11,686 transcripts ✅
  — the orphan-sweep candidate entry 033 names.
- A project is joined across `~/.claude.json`, `~/.claude/projects/` and
  `<project>/.claude` by its flattened path (ADR-0009). The project set is
  the **union** of the first two, never just one of them, and each member
  says which of them named it. A registry key whose directory is gone stays
  in the set with `pathExists: false`; one whose directory has no `.claude`
  stays with `hasStore: false`. Only a member with `hasStore` is a store, so
  only one of those can take a skill — a move into any other is refused as a
  `bad-request` naming the `.claude` directory that would have to exist.
- Which project a thing belongs to travels as a field, never as a substring
  of its id (ADR-0008): `SkillInfo`, `HookInfo`, `SettingsLayerInfo` and
  `PluginScopeState` each carry `projectId`. The folder name beside it
  (`PluginScopeState.projectLabel`) is for display only — two projects can
  share one.
- What a project "has" is a projection over those fields rather than a store
  of its own, which is what lets the projects home be built without a new
  adapter. `projectsList` counts by name alone: skill directories (both
  `skills/` and `skills.disabled/`), `*.md` under `agents/`, `commands/` and
  `rules/`, and which of the two settings files exist. Hooks and MCP servers
  cannot be counted that way — a hook is a fragment of `settings.json` and an
  MCP server a key of `~/.claude.json` or `.mcp.json` — so the listing reports
  both as `null` and `projectDetail` counts them for the one scope opened.
  The one place the two tiers disagree: a directory under `skills/` with no
  `SKILL.md` counts as a skill and is not listed as one.
- Timestamps are ISO-8601 strings in JSON files ✅; file mtimes are the
  fallback signal and are what staleness uses first (cheap).
- All JSON/JSONL reads assume partial corruption is possible (interrupted
  writes). A bad line is skipped and reported, never fatal.
- Bytes kondo displaces leave their store entirely: they land in
  `<kondo-data>/trash/<journal-id>/<store-name>/<path relative to that
  store>`, which sits outside every store above (ADR-0001) and so never
  turns up in a scan of one. A store name holding a colon — `project:<dir>`
  — spells it with a dash on the way in, because no Windows path segment may
  carry one. Emptying that trash is the only removal of store bytes kondo
  ever performs; every other operation moves them. The displaced copy is the
  only copy, so an entry whose bytes were emptied can no longer be reversed —
  `undo` refuses it and says so, rather than half-restoring.
- A journal entry is written before its steps run (ADR-0001), so an entry
  describes what was intended, not what happened. When a step fails part way,
  a following marker line names that entry as failed; `journalList` reports it
  as `failed` and never lists the marker itself. Undo of such an entry skips
  any step whose effect is absent while its source is still in place, and puts
  back only what actually ran.
