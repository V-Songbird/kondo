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

The names below are Claude's and kondo's, not the user's. Where an adapter
writes a string a person will read — a capability refusal, the summary a
mutation plan carries into History — it uses the right-hand column of
[glossary.md](glossary.md)'s UI-words table instead. A store fact keeps its
spelling here; the screen never shows it.

## The three store kinds

| Store | Location | Owner |
|---|---|---|
| User store | `~/.claude` ✅ | Claude Code CLI |
| User registry | `~/.claude.json` ✅ — one file beside the user store, see below | Claude Code CLI |
| Project store | `<project>/.claude` ✅ | Claude Code CLI, per project |
| Desktop store | Windows: `%APPDATA%\Claude` ✅ · macOS: `~/Library/Application Support/Claude` ◇ · Linux: `$XDG_CONFIG_HOME/Claude`, falling back to `~/.config/Claude` ◇ | Claude desktop app (Electron `userData`) |

On Linux, the locator accepts only an absolute `XDG_CONFIG_HOME`; unset,
empty and relative values use `~/.config`, following the
[XDG specification](https://specifications.freedesktop.org/basedir/latest/).
The Claude Linux location remains expected ◇; fixture tests establish Kondo's
resolution, not a live Claude installation. `KONDO_DESKTOP_STORE_ROOT` takes
precedence. Kondo's own app data still comes from Electron's `userData` or
`KONDO_DATA_ROOT`; this lookup does not move either application's data.

The privacy boundary (ADR-0002): inside a project, kondo opens **only** the
`.claude` directory. Everything else in the project is off-limits, with one
named exception: `<project>/.mcp.json` (project-scope MCP servers), which the
ADR-0002 amendment grants and `test/boundary.test.ts` pins. Outside a
`.claude` directory kondo opens exactly two files — that one and
`~/.claude.json` — and stats exactly one path, the project root.

These limits describe access to Claude's data. Kondo's separate
[application footprint](foundations.md#kondos-own-footprint) also holds its
journal, trash, caches and appearance preference. The Themes screen stores
that preference in Kondo's `appearance.json`; it does not read or write
Claude's own `theme` setting to select Kondo's appearance.

## User store: `~/.claude`

Observed top-level entries ✅ (one machine; expect variation by version and
usage):

| Entry | What it is |
|---|---|
| `projects/` | Session transcripts, one subdirectory per working directory. The heart of kondo's session features. |
| `settings.json` | User-scope settings. Observed keys: `env`, `permissions`, `skillOverrides`, `hooks`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `outputStyle`, `language`, `modelSettings`, `autoUpdatesChannel`, `tui`, `theme`, and more ✅. The toggle surfaces kondo cares about: `enabledPlugins`, `skillOverrides`, `hooks`. `skillOverrides` is `{ <skill> → 'on' \| 'name-only' \| 'user-invocable-only' \| 'off' }` ✅ — the four values Claude Code's own settings schema admits, read off the 2.1.258 binary (entry 029). Its description, verbatim: `name-only` lists the skill without its description, `user-invocable-only` hides it from the model but keeps `/name`, `off` hides it from both, absent = on. **Only `off` is a disabling**; the middle two leave the skill loaded. Precedence is the ordinary local > project > user ✅, and `/skills` writes the key into the *local* layer. It does **not** reach plugin-shipped skills ✅: Claude pins those to `on` before consulting it, and only managed-policy and CLI-flag settings override that — neither of which kondo reads. Kondo resolves it per skill and carries the winner as `SkillInfo.override`, with `enabled` false when it says `off` (entry 029); a key naming a skill no scope ships is also a configuration orphan it offers to splice out (ADR-0010). **It is also what kondo's skill toggle writes** (entry 045): `disable` splices `<skill>: "off"` into the scope's layer — the one already naming the skill, else `settings.local.json`, the file `/skills` writes — and `enable` removes the member from every layer in the chain that says `off`. A project page switches a *global* skill off for that project alone the same way (entry 062): the `off` lands in the project's own layer and only that project's layers are ever withdrawn from, so `ProjectDetail.inheritedSkills` reads each global skill against the project's local and project layers and reports `off here` apart from `off in Global`. The `hooks` object is `{ <event> → [ { matcher?, hooks: [ { type, command, timeout? } ] } ] }` ✅. |
| `enabledPlugins` | An object keyed by `<plugin>@<marketplace>` whose value is a boolean — both `true` and an explicit `false` observed in the wild ✅. An explicit `false` is how a layer overrides a lower one, so it is what kondo writes to disable; a key that is simply absent is silence, not a false. A legacy array form is read (a listed key is enabled) but never written. |
| `skills/` | User-scope skills, one directory per skill with a `SKILL.md`. |
| `skills.disabled/` | **Kondo's parking spot, not Claude's convention** ✅. The directory exists on the owner's machine, but the string `skills.disabled` occurs nowhere in the Claude Code 2.1.255 or 2.1.258 binaries (entry 029) — nothing reads it. A skill moved here does stop loading, for the plain reason that it is no longer in `skills/`, which is the "remove from `.claude/skills`" half of Claude's own advice. Claude's *named* per-skill switch is `skillOverrides` above, and since entry 045 that is what the toggle writes: nothing new is moved here. Kondo still reads the directory back as the `user-disabled` scope and offers each skill in it the way back into `skills/` (ADR-0006). |
| `plugins/cache/<mp>/<plugin>/<ver>/skills/` | Skills a plugin ships ✅. These belong to the plugin, not the user: kondo's skills catalogue deliberately excludes them, because benching or relocating one leaves the plugin referring to a directory that is no longer there. They belong to the plugins view, alongside the plugin that owns them, where `pluginSkills(pluginId)` reads them on demand when a plugin's row is opened. The `plugin` skill scope and its capability-matrix row keep that listing read-only. |
| `plugins/` | Plugin machinery ✅: `installed_plugins.json` (`version: 2`, `plugins[<name>@<marketplace>]` = array of `{ scope, installPath, version, installedAt, lastUpdated, gitCommitSha }`), `known_marketplaces.json`, `plugin-catalog-cache.json` (holds keys differing only by case — parse case-sensitively), `cache/<marketplace>/<plugin>/<version>/` (the installed code), `marketplaces/`, `data/<plugin>-<marketplace>/`, `.install-manifests/<id>.json`, `.last_inuse_sweep`. Residue accumulates ✅: 28 of 39 cached version directories were not the installed version, `.in_use` markers sat on every version (so the marker does not mean "current"), 4 install manifests and 47 of 55 `data/` directories belonged to plugins no longer installed. Kondo sweeps both (entry 033): `superseded-plugin-versions` offers every `cache/<mp>/<plugin>/<version>/` tree that is **not** the `installPath` its manifest entry names — the installed version is never a candidate, and the walk starts from the manifest outwards so that holds by construction rather than by a check — and `orphan-plugin-residue` offers the `data/` directories and `.install-manifests/` files whose `<name>@<marketplace>` id the manifest does not declare. `data/` slugs are derived forwards from each declared id (`@` → `-`), because reading a directory name backwards into an id is ambiguous the moment either half holds a dash. An `installed_plugins.json` that is missing, unreadable or malformed offers **nothing** rather than treating every plugin as uninstalled (ADR-0005); an empty `plugins: {}` is a different answer and does mean everything under `data/` is residue. A cache tree for a plugin absent from the manifest entirely falls under neither category — none was observed, since every cached marketplace/plugin pair was still installed. |
| `commands/` | User-scope slash commands (`.md` files) ✅. Read as placed entries — see below. |
| `hooks/` | Hook scripts ✅. Two scripts observed while `settings.json` `hooks` was `{}` — a script on disk is not an armed hook; only a settings entry arms one. Kondo reads both directions (entry 036). Forwards: each hook command is scanned for the script it runs and that script is stat'd, so `HookInfo.script` is `present`, `missing`, or `unverifiable` — the last where the token holds a shell variable kondo does not expand (`$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`), is relative in the user layer (whose working directory is Claude's to choose), or resolves outside the user store and every verified `.claude`. An unverifiable path is decided on the string and **never** statted (ADR-0002). Backwards: a file here that no layer's `hooks` object names is the `unarmed-hook-scripts` tidy category. |
| `agents/`, `output-styles/`, `rules/` | User-scope subagents, output styles and rules ◇ (documented by Claude Code; absent on this machine). Read as placed entries — see below. |
| `history.jsonl` | Global prompt history. Line schema: `display`, `pastedContents`, `timestamp`, `project`, `sessionId` ✅. |
| `sessions/` | Live-session registry: `<pid>.json` + `<pid>.<hash>.key` pairs ✅. Presence ≠ running; stale entries linger. |
| `session-env/` | Per-session environment snapshots, one dir per session id ✅. Nothing prunes it. Kondo sweeps it: a uuid-named directory with no transcript behind it is the `orphan-session-env` tidy category (entry 033), decided on the name alone and offered as its own reversible trash step. A snapshot whose transcript is still on disk is never offered — including one whose transcript the same sweep is about to move, since candidates come from a single scan. |
| `tasks/` | Background task state, one dir per task id ✅ (`pins.json` ◇, not seen on the last pass). |
| `jobs/` | Job state, dirs per job id ✅. |
| `file-history/` | Edit history backing checkpoint/rewind ✅. Grows silently; tidy candidate. |
| `shell-snapshots/` | Shell state snapshots ✅. Tidy candidate. |
| `backups/`, `paste-cache/`, `cache/`, `debug/`, `telemetry/`, `downloads/`, `ide/` | Support and cache directories ✅. Reclaimable space lives here. |
| `chrome/` | Claude in Chrome's native-messaging host (`chrome-native-host.bat`) ✅. 1 KB; not a cache. |
| `plans/` | Plan-mode plans as markdown, one file per plan with a generated slug name ✅ (3 observed, 60 KB). The user's writing; never a tidy candidate. |
| `daemon`, `daemon.log` | Daemon socket/state and log ✅. |
| `stats-cache.json`, `statusline-command.sh`, `CLAUDE.md` | Misc: usage stats cache, statusline script, the user's global instructions ✅. `todos/` ◇ (documented, absent here). |
| `feedback/`, `daemon-auth-cooldown`, `daemon-auth-status.json`, `gh-pr-status-cache.json`, `.last-update-result.json`, `.last-cleanup`, `statusline-command.sh.bak`, marker files (`.caveman-active`, …) | Small support and state files ✅. Listed by name and size only. |
| `.credentials.json`, `.claude.json`, `.mcp.json` | Inside the user store: a credentials file (**read-never**, like the desktop token files), and two small JSON files (`.mcp.json` held an empty `mcpServers`) ✅. Not to be confused with `~/.claude.json` below. |

### `~/.claude.json` — the registry

One file beside the store, ~2 MB, 87 top-level keys ✅, rewritten by Claude
during every session. Kondo reads it as one parse per inventory and keeps
only the parts named here (ADR-0009). Because it is rewritten under kondo,
the cached inventory stats this file (mtime and size) and the `projects/`
directory on every read and rebuilds when either moved (entry 056,
ADR-0007) — a project entry Claude adds or a directory another tool removes
is seen without a restart:

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
  carries `sources` (`registry`, `transcripts`, or both), `location`
  (`here`, `gone`, `unlocated` or `unreadable` — `pathExists` was replaced by
  it in entry 030) and `hasStore`, the last being whether it holds a `.claude`
  at all.
- `mcpServers` ✅ — user-scope MCP servers: `{ name → { type, command, args,
  env } | { type, url, headers } }`. `env` and `headers` can hold secrets.
- `skillUsage` and `pluginUsage` ✅ — usage counters, `{ name → {
  usageCount, lastUsedAt } }` (127 skill keys observed). The key is the
  skill's own **name**, bare for a user- or project-placed skill and
  `<plugin>:<name>` for a plugin-shipped one. Read for the "never used"
  badge (entry 032): a name with no key, or a key whose `usageCount` is 0,
  has never been loaded. Only that boolean crosses the seam — the counts and
  timestamps are how often and when a user works, and stay in the main
  process. No `skillUsage` key at all (or no readable `~/.claude.json`) is a
  third state, carried as `null` (entry 048): kondo cannot tell, and badges
  nothing.
- Everything else (`oauthAccount`, `userID`, `machineID`, experiment caches)
  is identity or telemetry and is **read-never**.

Kondo writes this file by splice only — never whole (ADR-0010): a step names
the bytes it changes and the digest they were read from, and refuses when
Claude has written the file since. `configOrphansPreview` /
`configOrphansRemove` are the first callers, taking out `projects` entries
whose directory is gone and the `mcpServers` declared inside them.

A settings layer is written the same way, and for the same reason in
miniature: a `settings.json` the user has open in an editor, or that Claude
writes mid-session, is not kondo's to replace wholesale. Every toggle that
edits a layer already on disk — a skill switched off or back on, a global
skill silenced for one project, a plugin enabled, disabled, handed to another
scope or withdrawn — plans one `splice` per file, carrying the digest of the
bytes it read and an edit no wider than the member it changes. Only a layer
that does not exist yet is written whole, and kondo asks before creating one.
The undo is the inverse edits against the file as it stands, never a snapshot
taken before the change (ADR-0001, ADR-0010).

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
`.mcp.json` read per verified project. The two disable lists are also what
kondo's toggle writes (entry 061): `disable` adds the name to the project's
`disabledMcpServers` (a `local` declaration) or `disabledMcpjsonServers` (a
`project` one) and `enable` takes it out, each as one splice of that list's
value under the ADR-0010 digest guard, so a registry Claude rewrote in
between refuses rather than loses. The user scope has no list and stays
read-only; a declaration is never moved between files and `.mcp.json` is
never written (ADR-0002).

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

A `description` in the wild is usually a paragraph, and a paragraph is
written as a YAML block scalar — `description: >-` with the text indented
beneath it, `|` where the breaks matter. The reader takes the lines a key
owns: folded blocks collapse to one line, literal ones keep their breaks, a
blank line inside a block is a paragraph break rather than the end of the
value, and a plain value continued across indented lines is folded the same
way. It stays deliberately lossy — kondo displays these, it does not
round-trip them.

| Kind | User store | Project store | Id |
|---|---|---|---|
| `agent` | `~/.claude/agents/*.md` ◇ | `<project>/.claude/agents/*.md` ✅ | `agent:user:<name>` · `agent:project/<flat>:<name>` |
| `command` | `~/.claude/commands/*.md` ✅ | `<project>/.claude/commands/*.md` ◇ | `command:user:<name>` · `command:project/<flat>:<name>` |
| `rule` | `~/.claude/rules/*.md` ◇ | `<project>/.claude/rules/*.md` ✅ | `rule:user:<name>` · `rule:project/<flat>:<name>` |
| `output-style` | `~/.claude/output-styles/*.md` ◇ | not read — unobserved in a project store | `output-style:user:<name>` |

All four **cannot be toggled, in any scope**. Claude loads them by presence:
there is no `.disabled` sibling directory and no settings key that benches
one, so the capability matrix refuses `enable` and `disable` outright rather
than kondo inventing a mechanism (ADR-0006). The owning project travels as
`PlacedEntryInfo.projectId`, never as a substring the renderer splits out of
an id (ADR-0008).

`move` **is** permitted (entry 028), because putting the file in the other
scope's directory is exactly how Claude loads it there — nothing is invented.
A promotion runs the skill move's plan unchanged: copy, verify, trash, as one
journal entry, so ADR-0001's undo restores it or none of it. `output-style`
is the exception, and only in one direction: a project store has no
`output-styles` directory to read, so a project destination is refused for
that kind rather than kondo creating the first one anybody has seen.

A name can repeat across scopes, and that is the one thing kondo removes by
hand (entry 032). `skillDuplicates` groups the skill listing by name and
returns only groups of more than one, digesting each member's tree — the
digest is what says whether the copies are actually the same skill, because
two scopes can hold the same name over completely different work. A name that
repeats nowhere is never hashed (ADR-0007), and a member whose tree could not
be read carries no digest and makes its group not identical: "kondo could not
tell" must never render as "safe to remove". Removal is a fourth capability
operation, `trash`, allowed only in the four scopes a user placed a skill in
by hand — a plugin-shipped skill follows its plugin, and a plugin's files are
the plugin's to remove.

Where each kind sits is one table, `PLACEMENTS` in
`electron/main/workspace/user-store.ts` — directory, bench (`skills.disabled`
for skills, none for the four above), on-disk suffix, and whether a project
store holds it. Both the listings and `kinds.ts`'s move read from it, so a
scan and a mutation can never disagree about where an entry lives.

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
  path before claiming it, and records the outcome as four states, never one
  flag: `here`, `gone` (the registry named the path and the stat came back
  ENOENT — a *dead project*), `unlocated` (no key, and the guess never
  verified — which is not evidence of anything) and `unreadable` (the registry
  named it and the stat failed some other way: a permission kondo does not
  have, a volume no longer mounted, an I/O error). Only ENOENT is evidence of
  deletion, so only `gone` makes a cleanup candidate; an `unreadable` project
  carries a `stat-failed` scan error and is offered in no category, because an
  unmounted volume still holds every byte it ever did (entry 075, ADR-0005).
- Scale is real: **9,171 project directories** observed on one machine ✅
  (9,031 of them under a temp directory — benchmark and scratchpad runs);
  11,517 registry-plus-directory members on 2026-09-05, 8,498 of them
  throwaway by name and 50 gone from disk. Scanning must be stat-based and
  lazy; never parse every transcript up front (ADR-0007), and a listing must
  not put one row per member on screen: the projects home names a row by the
  last path segment with the parent beneath (`ProjectRow.name` / `parent`,
  built in `workspace.ts`), folds throwaway and gone rows behind a count
  (`ProjectRow.throwaway` / `location`), and pages the rest (entry 060).
- Temporary-project classification (entry 091) uses the locator's lexical and
  canonical temporary roots. MacOS `/var` and `/private/var` aliases are expected
  ◇; Windows fixture junctions and simulated macOS spellings cover Kondo's
  implementation, not a live macOS installation. Existing inventory paths are
  compared by segment without additional project I/O. A missing realpath alias
  leaves the lexical root usable. A flattened unlocated name alone cannot prove
  temporary origin: `/tmp/project` and `/tmp-project` have the same name. Kondo
  therefore leaves those ambiguous names out of temporary-root classification;
  the independent worktree/job markers and empty-unlocated-directory rule remain.
  These roots grant no new store access or mutation targets.
- Inside a project directory ✅:
  - `<session-uuid>.jsonl` — the transcript, append-only JSONL.
  - `<session-uuid>/` — optional sibling directory (subagent transcripts,
    tool state, a `custom-title.json`). A sibling without its `.jsonl` is an
    orphan.
  - `<session-uuid>.desktop-released.json` ✅ — a 78-byte marker the desktop
    app writes beside a transcript it has released: `{ "v": 1, "releasedAt":
    <ISO>, "reason": "delete" }`. 101 observed on 2026-09-05, every one
    beside its transcript, every `reason` `delete` (other reasons ◇). Kondo
    attaches it to its session (`SessionRecord.released`,
    `SessionSummary.releasedByDesktop`), moves it with the transcript, treats
    one without a transcript as an orphan sidecar, and offers the released
    sessions as the `desktop-released-sessions` tidy category (entry 059).
  - `.benchmarks/<name>/runs/<stamp>/` ◇ — benchmark runs written by
    `claude plugin eval`; one project directory held one. Known, never
    offered.
  - `memory/` — the project's persistent memory files. 17 directories held
    only `memory/` and 23 held no transcript at all ✅ (24 of 8,641 on
    2026-09-05, two of them live projects — `D:\Projects\Knowledge\GRFEditor`
    among them — whose memory is the only thing Claude has recorded there).
    So "no transcript" is not "scratch" (entry 058): the tidy sweep offers a
    transcript-less directory whole only when it also holds no `memory/` and
    its path is *unlocated* — nothing recorded, nothing behind it. One whose
    path is `gone` is a dead project; one holding `memory/` under a live or
    unlocated path is Claude's record of a project and is offered nowhere.
  - Occasional top-level `.json` files ◇ (five seen in one directory; not
    yet understood, reported as unknown).
- Transcript lines are typed events. First line observed with keys `type`,
  `leafUuid`, `sessionId` ✅; message lines carry timestamps and roles ◇.
  Kondo reads the first and last lines to bound a session in time, and
  message timestamps (streamed, never whole-file) for worked time.
- Two sessions in one project can be the *same work restarted*: the same
  opening prompt, a fresh uuid ✅. `sessionNearDuplicates(projectId)` groups
  them on the first `type: "user"` message, normalized to lower-case letters
  and digits with single spaces, so a prompt retyped with different
  punctuation still groups. Openings under 12 characters are dropped — "ok"
  and "continue" open many sessions and mean nothing. The read stops at that
  first message (`readFirstUserPrompt`) and is cached on `(path, size,
  mtime)` under `<kondo-data>` (ADR-0007); it is asked for one project at a
  time, never for the store. A session may be picked out of the listing and
  displaced into kondo's trash with its sidecar, as one journal entry
  (`sessionTrash`, ADR-0001).

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
  A **project** layer's relative hook path resolves against that project
  directory ✅ — the directory Claude runs its hooks in — which is how
  `.claude/hooks/guard.sh` in a project `settings.json` verifies. The
  `unarmed-hook-scripts` sweep deliberately covers the user store only: a
  sweep step names a path relative to one store, and the noise beside a
  project's scripts is not kondo's to classify.
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
  parking spot. Unobserved in the wild, and entry 029 settled why: no Claude
  Code build reads it in *any* scope, so there was no project-scope convention
  to be unobserved. Kondo writes it and reads it back as the
  `project-disabled` skill scope; the per-skill switch Claude actually honours
  here is `skillOverrides` in this project's settings layers (ADR-0006).
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
  (`pluginClear`), which is a splice like the toggle rather than a rewrite —
  the member's span and one separating comma are all that leave the file.
  Which file a position writes is chosen in the main process:
  the highest-precedence layer of that scope that *already states a value*,
  and `settings.local.json` when none does.
- Handing a plugin to another scope is those same statements twice, never a
  relocation: nothing installed moves on disk. Kondo writes `false` in the
  layer that enabled it and `true` in the destination scope's layer, as one
  reversible operation (`pluginMove`) carrying one splice per file, each with
  its own digest — so a move refuses whole if either layer has moved on. A
  destination that does not exist yet is the one write, and it is asked about
  first. The destination *file* is chosen by the same rule as a toggle's.

## Desktop store

Electron app data — 10.9 GB on the owner's machine on 2026-09-05 ✅, against
1.6 GB for the Claude Code store. Observed top-level entries, by what they
are:

| Entry | What it is | Kondo |
|---|---|---|
| `vm_bundles/` (`claudevm.bundle/`, `warm/`) | 9.3 GB ✅ — the cowork VM image and its warm copy. Whether the app re-downloads a missing bundle is not established ◇. | Reported. **Never offered**: not a cache until proven one. |
| `claude-code/<version>/`, `claude-code-vm/<version>/` | 416 MB + 205 MB ✅ — the Claude Code CLI the desktop app bundles, one directory per version (2.1.258 and 2.1.260 seen; only the newer has a `-vm` twin). The older version looks superseded ◇, the way a plugin's cache versions are. | Reported. Not offered until the app's rollback behaviour is known. |
| `Code Cache/`, `Cache/`, `GPUCache/`, `DawnGraphiteCache/`, `DawnWebGPUCache/`, `Shared Dictionary/` | 317 MB + 157 MB + … ✅ — Chromium's own caches; the app rebuilds each on its next launch, which is what "clear cache" means in any Electron app. | The `desktop-caches` tidy category (entry 063), at the root and inside each `Partitions/<name>/`. |
| `Partitions/<name>/` | 129 MB ✅ — one Chromium profile per isolated web view (`cowork-artifact-<ids>`, `cowork-file-preview`, `launch-preview-cowork-shared`, `launch-preview-static`), each with the same cache directories beside its `Local Storage`, `IndexedDB`, `Network`, `Preferences`. | Only the cache directories inside are offered. |
| `local-agent-mode-sessions/<device-or-install-uuid>/<account-uuid>/` | 287 MB ✅ — desktop/cowork sessions: `local_<session-uuid>.json` + `local_<session-uuid>/` per session, `agent/`, `artifacts.json`, `cowork-*-cache.json`. | Read for the mirror flag and the desktop session listing. Never swept. |
| `claude-code-sessions/<uuid>/`, `scratch-workspaces/`, `git-shadow/`, `git-worktrees.json` | 9 MB + … ✅ — cowork's working state: the CLI sessions it drove, the scratch checkouts it works in, shadow git data. | Reported only. |
| `logs/` (14 files), `sentry/`, `Crashpad/` | 56 MB ✅ — the app's own logs, error reports and crash dumps. | Reported only ◇ — a candidate once the app's retention is known. |
| `pending-uploads/` | 22 MB, 60 PNGs ✅ — pasted images awaiting upload. | **Never offered**: in-flight user data. |
| `IndexedDB/`, `Local Storage/`, `Session Storage/`, `WebStorage/`, `File System/`, `blob_storage/`, `Network/`, `DIPS*`, `SharedStorage*`, `InterestGroups/`, `VideoDecodeStats/`, `Local State`, `Preferences`, `shared_proto_db/`, `fcache` | Chromium's state stores ✅. | Reported only; state, not cache. |
| `Claude Extensions/`, `Claude Extensions Settings/`, `ChromeNativeHost/`, `design/`, `document-baselines/`, `extensions-*.json`, `mcp-user-tool-toggles.json`, `cowork-enabled-cli-ops.json`, `claude_desktop_config.json`, `config.json`, `window-state.json` | The desktop app's own configuration and features ✅. | Reported only. |
| `ant-device-registry.json`, `ant-did`, `bridge-state.json`, `buddy-tokens.json`, `lockfile` | Device/identity state and Electron's single-instance lock ✅. **Read-never** for the identity and token files: names and sizes only. `lockfile` is opened for writing once per tidy preview — never read — because Electron holds it with exclusive access while the app runs (EBUSY on Windows, verified with the app up), which is how kondo knows not to sweep caches the app has open; on macOS and Linux a `SingletonLock` / `SingletonSocket` / `SingletonCookie` beside it means the same (and may be left behind by a crash ◇, in which case kondo refuses a sweep that would have worked). | The `desktop-caches` block. |

Cloud sessions (claude.ai) have no local files unless mirrored here; kondo
only sees what is on disk.

The read-never policy is pinned by synthetic fixtures (094): `.credentials.json`
under the user root and `ant-did`, `ant-device-registry.json`,
`bridge-state.json`, `buddy-tokens.json` under the desktop root. These fixtures
verify Kondo's `fs/promises.readFile` call policy, including failed attempts;
they do not add a new observation about Claude's formats or cover other read
mechanisms. Names and sizes remain available to store reports.

## Cross-store facts

- A session id is a UUID and appears in: its transcript filename, the
  transcript's lines, `history.jsonl` entries, `session-env/`, and possibly a
  desktop-store directory — this is how kondo joins data across stores to
  find duplicates. The transcript, its sidecar and its `session-env/`
  snapshot are joined for the sweep; the desktop store's
  `local_<uuid>.json` stems are joined to the code store's uuids for
  `SessionSummary.mirroredIn` ✅, which is the whole of "the same session in
  two stores" (entry 034). `session-env/` held 5,213 directories
  against 11,686 transcripts ✅ — the sweep entry 033 shipped reads exactly
  that join, and offers only the snapshots the transcript set does not claim.
- A project is joined across `~/.claude.json`, `~/.claude/projects/` and
  `<project>/.claude` by its flattened path (ADR-0009). The project set is
  the **union** of the first two, never just one of them, and each member
  says which of them named it. A registry key whose directory is gone stays
  in the set with `location: 'gone'`; one whose directory has no `.claude`
  stays with `hasStore: false`. Only a member with `hasStore` is a store, so
  only one of those can take a skill — a move into any other is refused as a
  `bad-request` naming the `.claude` directory that would have to exist.
  The exact registry path (or verified fallback guess) stays in main's
  `ProjectRecord.guessedPath`; `SessionProject` exposes only the resulting
  location/store facts, attribution, IDs and aggregate counts (094).
- Because the set is a union, its size is not the same figure as "projects
  with transcripts", and the wider one must never be shown wearing the
  narrower one's label. `StoresOverview.sessions` carries both:
  `projectCount` is the union, and `transcriptProjectCount` is how many of
  those hold at least one transcript — derived from the same tier-1
  inventory, not from a second scan (ADR-0007). A registry key Claude has on
  record but never worked in sits in the gap between them, so the pair is
  what the projects home prints, each number named for the set it counts
  (entry 038).
- Which project a thing belongs to travels as a field, never as a substring
  of its id (ADR-0008): `SkillInfo`, `HookInfo`, `SettingsLayerInfo` and
  `PluginScopeState` each carry `projectId`. The folder name beside it
  (`PluginScopeState.projectLabel`, `HookInfo.projectLabel`) is for display
  only — two projects can share one. `hooksList` is the one shipped listing
  that is not flat: it returns `HookGroup[]`, the user layer's group first,
  because a flat table cannot say which project a hook belongs to.
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
- Settings can be reached through filesystem links ◇; this is a supported
  layout, not a newly observed Claude convention. Splices edit the resolved
  file and preserve in-store file and parent-link identity. Mutation targets
  must stay inside their resolved store root; missing destinations resolve
  through existing ancestors and dangling links refuse. The registry remains
  one named file under its resolved parent, not permission to follow a link
  into another home file. Temporary splice contents are synced and closed
  before rename; handled failures attempt cleanup without masking the original
  error. See ADR-0010 for concurrency and power-loss limits.
- Journal shape validation is covered by fixtures ✅: a line is accepted only
  when its record and every step have the fields the operation needs, including
  inverse splice edits and undo/failure links. Valid JSON with the wrong shape
  is skipped as one whole entry and reported as `parse-failed` at
  `journal.jsonl:<line>`. Other entries remain listed and reversible, with those
  read errors still returned. Optional historical fields and additional metadata
  are accepted; the journal is never rewritten to repair a line (095). Readable
  `undoOf`/`failedOf` references in rejected entries conservatively block undo of
  the related change, without supplying steps or claiming a completed undo.
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
  back only what actually ran. A `write` is the exception it cannot skip: its
  target is there whether or not the step ran, so undo refuses the whole entry
  rather than displace bytes it has nothing to put back.
- An undo never renames over a path that is occupied. The time between an
  operation and its undo belongs to whoever else writes there — Claude
  saving a transcript at the same uuid a sweep trashed is the ordinary case
  — so a `move` or a `trash` being reversed stats its restore path first and
  displaces any occupant into the undo's own
  `<kondo-data>/trash/<undo-id>/` before putting the recorded bytes back.
  That displacement is a `trash` step on the undo entry, decided while the
  entry is built, because the entry is written before its steps run and a
  step it does not carry is bytes nothing records.

## Claude Code compatibility review — 2026-09-06

The store observations above describe what was checked at their original dates.
They do not prove complete support for newer Claude Code conventions.

- Multiple scopes can keep different installed versions of one plugin ✅.
  `installed_plugins.json` holds an array of installation entries per id;
  cleanup now preserves **every** in-store `installPath` in that array, in
  any order. Fixture sweep/undo tests cover user, project and local records
  together. This refines the plugin-residue description above: there can be
  several installed versions, not one. The inventory still presents only the
  first installation. [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference#plugin-uninstall).
- Directory-discovered `@skills-dir` plugins and overrides for built-in skills
  are supported by current Claude documentation ✅. Kondo's configuration-orphan
  inference does not yet account for these, so absence from its installation
  inventory is **not** proof that a preference is obsolete.
  [Directory plugins](https://code.claude.com/docs/en/plugins-reference#skills-directory-plugins),
  [removing a skill](https://code.claude.com/docs/en/skills#remove-a-skill).
- MCP approval, settings restrictions and per-project disablement are distinct
  states in Claude Code ✅. Kondo's current boolean and historical disable-list
  reader do not represent all of them; its displayed `on` does not prove that
  Claude has approved or connected that server. Reconcile reader and toggle
  conventions before claiming complete MCP management support.
  [MCP status](https://code.claude.com/docs/en/mcp#server-status),
  [disable a server](https://code.claude.com/docs/en/mcp#disable-a-server-without-removing-it).
- Plugin components can use layouts beyond `<install>/skills/` ✅, which is
  still the only layout Kondo's plugin-skills reader inventories.
  [Plugin skills](https://code.claude.com/docs/en/plugins-reference#skills).
- `CLAUDE_CONFIG_DIR` selects a different Claude configuration directory ✅.
  Kondo currently checks `KONDO_STORE_ROOT` instead and otherwise defaults to
  the ordinary user store; profile selection remains a compatibility gap.
  [Environment variables](https://code.claude.com/docs/en/env-vars).
