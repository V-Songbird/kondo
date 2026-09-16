# The Claude data landscape

Everything kondo knows about Claude's on-disk world. This document is the
single source of truth for store facts; adapters implement it, tests encode
it, and PRs that learn something new must update it.

None of these formats are publicly documented or stable. Every fact carries a
marker:

- ✅ **verified** — observed directly on a real Windows machine; each
  observation carries its own date or entry. The store survey was last
  refreshed on 2026-09-05, and the settings schema was read from the Claude
  Code 2.1.255 and 2.1.258 binaries. No version range is guaranteed.
- ◇ **expected** — inferred from platform conventions or public knowledge;
  verify before relying on it in code.

Adapters must treat all of it as best-effort: unknown files appear, schemas
drift. Unknown ≠ error (see ADR-0005).

The names below are Claude's and kondo's, not the user's. Where an adapter
writes a string a person will read — a capability refusal, the summary a
mutation plan carries into History — it should use the right-hand column of
[glossary.md](glossary.md)'s UI-words table instead. A store fact keeps its
spelling here.

## Store locations

| Store | Location | Owner |
|---|---|---|
| User store | `~/.claude` ✅, or the directory a Claude profile names ✅ — see below | Claude Code CLI |
| User registry | `~/.claude.json` ✅ beside the default user store, `<profile>/.claude.json` ✅ inside a selected profile — see below | Claude Code CLI |
| Project store | `<project>/.claude` ✅ | Claude Code CLI, per project |
| Desktop store | Windows: `%APPDATA%\Claude` ✅ · macOS: `~/Library/Application Support/Claude` ◇ · Linux: `$XDG_CONFIG_HOME/Claude`, falling back to `~/.config/Claude` ◇ | Claude desktop app (Electron `userData`) |

On Linux, the locator accepts only an absolute `XDG_CONFIG_HOME`; unset,
empty and relative values use `~/.config`, following the
[XDG specification](https://specifications.freedesktop.org/basedir/latest/).
The Claude Linux location remains expected ◇; fixture tests establish Kondo's
resolution, not a live Claude installation. `KONDO_DESKTOP_STORE_ROOT` takes
precedence. Kondo's own app data still comes from Electron's `userData` or
`KONDO_DATA_ROOT`; this lookup does not move either application's data.

### Claude profiles

✅ Read on 2026-09-15 off the Claude Code 2.1.271 binary and the
[environment variables](https://code.claude.com/docs/en/env-vars) and
[settings](https://code.claude.com/docs/en/settings) pages:

- `CLAUDE_CONFIG_DIR` replaces `~/.claude` as Claude Code's configuration home,
  NFC-normalized. Everything the user store holds is a child of that directory
  and moves with it — settings, `projects/`, `plugins/`, `skills/`,
  `output-styles/`, `ide/`, `teams/` and `.credentials.json` among them.
- The registry moves **into** it: Claude Code reads `.claude.json` in
  `CLAUDE_CONFIG_DIR` when the variable is set, and `~/.claude.json` when it is
  not. A process started with the variable pointing at `~/.claude` therefore
  reads the in-store `~/.claude/.claude.json` listed below, not `~/.claude.json`.
- A legacy `.config.json` in the configuration home replaces the registry
  wherever that file exists ✅.
- Nothing else moves: project stores, `<project>/.mcp.json`, managed settings
  and the Claude desktop app's store keep their locations. Claude Code also
  keeps looking for IDE lock files in `~/.claude/ide`.
- The variable can be set in the shell, in user settings or in managed
  settings ✅; project and local settings cannot set it.

Which directory Kondo reads is fixed at launch, before the single-instance
lock, in this order:

| Rank | Selection | User store | Registry |
|---|---|---|---|
| 1 | `KONDO_STORE_ROOT` (fixture runs and tests) | that directory | `.claude.json` beside it |
| 2 | `--claude-config-dir=<absolute path>` on Kondo's own command line | that directory | `.claude.json` inside it |
| 3 | An inherited absolute `CLAUDE_CONFIG_DIR` | that directory | `.claude.json` inside it |
| 4 | Neither | `~/.claude` | `~/.claude.json` |

An inherited variable never displaces a fixture root, so a developer's shell
cannot point a fixture run or a test at a real profile. An empty value is no
selection, and a relative one is not followed because it would resolve against
a working directory a desktop launch does not share with the shell. Kondo names
the profile it reads and every selection it did not follow, and accepts no
directory from the renderer (ADR-0008). It writes to no profile and copies
nothing between profiles.

Kondo's own data root follows the profile: `KONDO_DATA_ROOT` stands as given,
Claude's default store set keeps Electron's `userData`, and any other store set
gets `<userData>/profiles/<key>`, keyed by the user, registry and desktop roots.
A data root records the set it serves in `stores.json` and refuses a launch that
brings another one, because a journal step names a store rather than a root
(ADR-0001, ADR-0004). Windows is the verified platform: the rules above are the
binary's, which is the same on every OS, while Kondo's own profile launches have
been exercised on Windows only ◇.

The privacy boundary (ADR-0002): inside a project, kondo opens **only** the
`.claude` directory. Everything else in the project is off-limits, with one
named exception: `<project>/.mcp.json` (project-scope MCP servers), which the
ADR-0002 amendment grants and `test/boundary.test.ts` pins. Outside the user
store and those directories kondo opens exactly two files — that one and
Claude's registry, beside the user store or inside the selected profile — and
stats exactly one path, the project root.

✅ **Kondo boundary behavior, verified with synthetic fixtures:** scanner
helpers take the owning user, desktop or verified project `.claude` root. Both
the requested path and its final resolved target must stay in that root; a link
into another store is not permission to cross between them. In-store aliases
remain readable. External links, dangling links and recursive cycles produce
itemized errors and preserve healthy siblings. The registry and project MCP
exceptions authorize their exact filename under the resolved parent, so a link
from either file to a sibling is refused. An ordinary absent optional file is
still empty data, rather than a broken-link error.

Directory walks validate entries before descending; transcript streams and
duplicate digests validate before opening bytes, including after a cached
inventory. Copy verification needs a complete readable tree and refuses a
partial digest. Configured store-root aliases remain the locator's authority;
these pathname checks do not eliminate concurrent replacement races.

Copies into another live store materialize safe linked contents and verify the
complete result. Moves to Kondo's trash preserve the original link entries for
undo. An archived link is metadata: trash inventory, physical copy verification
and removal never follow it back into a live store. Undo validates those links
against the future restored tree before journaling or displacing an occupant.
Trash size counts physically retained regular-file bytes, excluding referents
and link metadata.

These limits describe access to Claude's data. Kondo's separate
[application footprint](foundations.md#kondos-own-footprint) also holds its
journal, trash, caches and appearance preference. The Themes screen stores
that preference in Kondo's `appearance.json`; it does not read or write
Claude's own `theme` setting to select Kondo's appearance.

## Settings execution restriction

✅ **Kondo policy, established by source and synthetic fixtures:** every plan
containing a `write` or `splice` — mixed plans and confirmed creation of an
absent layer included — and every historical Undo containing one is refused on
all platforms before journaling or filesystem effects
([ADR-0010](adr/0010-splice-config-files-never-whole-file-writes.md)). The
settings conventions and planners described below are the basis for inventory
and future planning, not permission to execute a settings change. Unrelated
moves, trash and their Undo remain available, and Kondo's own appearance
preference is unaffected.

## User store: `~/.claude`

Observed top-level entries ✅ (one machine; expect variation by version and
usage):

| Entry | What it is |
|---|---|
| `projects/` | Session transcripts, one subdirectory per working directory. The heart of kondo's session features. |
| `settings.json` | User-scope settings. Observed keys: `env`, `permissions`, `skillOverrides`, `hooks`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `outputStyle`, `language`, `modelSettings`, `autoUpdatesChannel`, `tui`, `theme`, and more ✅. The toggle surfaces kondo cares about: `enabledPlugins`, `skillOverrides`, `hooks`. `skillOverrides` is `{ <skill> → 'on' \| 'name-only' \| 'user-invocable-only' \| 'off' }` ✅ — the four values Claude Code's own settings schema admits, read off the 2.1.258 binary. Its description, verbatim: `name-only` lists the skill without its description, `user-invocable-only` hides it from the model but keeps `/name`, `off` hides it from both, absent = on. **Only `off` is a disabling**; the middle two leave the skill loaded. For this key precedence is the ordinary local > project > user ✅, and `/skills` writes the key into the *local* layer. It does **not** reach plugin-shipped skills ✅: Claude pins those to `on` before consulting it, and only managed-policy and CLI-flag settings override that — neither of which kondo reads. Kondo resolves it per skill and carries the winner as `SkillInfo.override`, with `enabled` false when it says `off`; configuration cleanup preserves every override because its skill sources cannot be completely enumerated (ADR-0010). **It is also what kondo's skill toggle plans** (execution refused, see above): `disable` splices `<skill>: "off"` into the scope's layer — the one already naming the skill, else `settings.local.json` for a project skill and `~/.claude/settings.json`, the only user layer Kondo reads, for a user skill — and `enable` removes the member from every layer in the chain that says `off`. A project page switches a *global* skill off for that project alone the same way: the `off` lands in the project's own layer and only that project's layers are ever withdrawn from, so `ProjectDetail.inheritedSkills` reads each global skill against the project's local and project layers and reports `off here` apart from `off in All projects`. The `hooks` object is `{ <event> → [ { matcher?, hooks: [ { type, command, timeout? } ] } ] }` ✅. |
| `enabledPlugins` | An object keyed by `<plugin>@<marketplace>` whose value is a boolean — both `true` and an explicit `false` observed in the wild ✅. An explicit `false` is how a layer overrides a lower one, so it is what kondo plans to disable (execution refused); a key that is simply absent is silence, not a false. **Only `true` and `false` state anything.** A member holding any other value — a string, a number, `null`, an array, an object — reads as `'unknown'`: kondo has no evidence for what Claude makes of it, so it is never coerced into on or off, it never wins precedence over a layer that does state a boolean, and the plugin control presses none of its three positions for it. The scan carries one `parse-failed` per such member, naming the settings file and — only when the key matches the `<name>@<marketplace>` grammar, since any other key is file text — the member key, never the value (ADR-0022). The member still counts as the file mentioning the plugin, so a click can still target and repair it. A legacy array form is read (a listed key is enabled) but never written. |
| `skills/` | User-scope skills, one directory per skill with a `SKILL.md`. |
| `skills.disabled/` | **Kondo's parking spot, not Claude's convention** ✅. The directory exists on the owner's machine, but the string `skills.disabled` occurs nowhere in the Claude Code 2.1.255 or 2.1.258 binaries — nothing reads it. A skill moved here does stop loading, for the plain reason that it is no longer in `skills/`, which is the "remove from `.claude/skills`" half of Claude's own advice. Claude's *named* per-skill switch is `skillOverrides` above, which is what the toggle plans; Kondo never moves skills here. Kondo still reads the directory back as the `user-disabled` scope and offers each skill in it the way back into `skills/` (ADR-0006). A History row names that scope in the glossary's words — `All projects`, `All projects, disabled`, `this project`, `this project, disabled`, `from a plugin` — rather than printing the id segment; a scope the mapping does not know prints as itself. |
| `plugins/cache/<mp>/<plugin>/<ver>/skills/` | Skills a plugin ships ✅ — the default of several layouts, listed under "Plugin component layouts" below. These belong to the plugin, not the user: kondo's skills catalogue deliberately excludes them, because benching or relocating one leaves the plugin referring to a directory that is no longer there. They belong to the plugins view, alongside the plugin that owns them, where `pluginSkills(pluginId)` reads them on demand when a plugin's row is opened. The `plugin` skill scope and its capability-matrix row keep that listing read-only. |
| `plugins/` | Plugin machinery ✅: `installed_plugins.json` (see "Plugin installation records" below), `known_marketplaces.json`, `plugin-catalog-cache.json` (holds keys differing only by case — parse case-sensitively), `cache/<marketplace>/<plugin>/<version>/` (the installed code), `marketplaces/`, `data/<plugin>-<marketplace>/`, `.install-manifests/<id>.json`, `.last_inuse_sweep`. Residue accumulates ✅: 28 of 39 cached version directories were not the installed version, `.in_use` markers sat on every version (so the marker does not mean "current"), 4 install manifests and 47 of 55 `data/` directories belonged to plugins no longer installed. Several scopes can keep different installed versions of one plugin ✅, one installation entry each; Kondo's plugin inventory keeps every entry and presents the first under a stated order, never the file's array position. Kondo sweeps both: `superseded-plugin-versions` offers every `cache/<mp>/<plugin>/<version>/` tree that **no** installation entry of that plugin names as its `installPath` — the walk starts from the manifest's plugin ids and skips each version directory an entry names, and that explicit check is what keeps every installed version out of the candidates — and `orphan-plugin-residue` offers the `data/` directories and `.install-manifests/` files whose `<name>@<marketplace>` id the manifest does not declare. `data/` slugs are derived forwards from each declared id (`@` → `-`), because reading a directory name backwards into an id is ambiguous the moment either half holds a dash. An `installed_plugins.json` that is missing, unreadable or malformed offers **nothing** rather than treating every plugin as uninstalled (ADR-0005); an empty `plugins: {}` is a different answer and does mean everything under `data/` is residue. A cache tree for a plugin absent from the manifest entirely falls under neither category — none was observed, since every cached marketplace/plugin pair was still installed. |
| `commands/` | User-scope slash commands (`.md` files) ✅. Read as placed entries — see below. |
| `hooks/` | Hook scripts ✅. Two scripts observed while `settings.json` `hooks` was `{}`. That does not prove disuse: Kondo inventories only selected settings layers, not every execution source. Each hook row keeps only the status of the first script its command names (`present`, `missing`, or `unverifiable`); the command and the path stay in main (ADR-0022). Variables are not expanded and paths outside the approved roots are not probed (ADR-0002). ✅ Synthetic fixtures: cleanup retains **all** hook scripts, including ones absent from the recognized references. `unarmed-hook-scripts` remains a compatible category identifier with zero candidates and an explicit blocked reason; the screen names it "Hook scripts kondo keeps" and the journal summary "kept hook script(s)", because a script no recognized reference names is still a script kondo cannot call unused. A hook row's refusals are kondo's own: it does not support switching an individual hook and does not move a hook between settings files ([ADR-0017](adr/0017-hook-layer-boundary.md)). |
| `agents/`, `output-styles/`, `rules/` | User-scope subagents, output styles and rules ◇ (documented by Claude Code; absent on this machine). Read as placed entries — see below. |
| `history.jsonl` | Global prompt history. Line schema: `display`, `pastedContents`, `timestamp`, `project`, `sessionId` ✅. |
| `sessions/` | Live-session registry: `<pid>.json` + `<pid>.<hash>.key` pairs ✅. Presence ≠ running; stale entries linger. |
| `session-env/` | Per-session environment snapshots, one dir per session id ✅. Nothing prunes it. Kondo sweeps it: a uuid-named directory with no transcript behind it is the `orphan-session-env` tidy category, decided on the name alone and offered as its own reversible trash step. A snapshot whose transcript is still on disk is never offered — including one whose transcript the same sweep is about to move, since candidates come from a single scan. |
| `tasks/` | Background task state, one dir per task id ✅ (`pins.json` ◇, not seen on the last pass). |
| `jobs/` | Job state, dirs per job id ✅. |
| `file-history/` | Edit history backing checkpoint/rewind ✅. Excluded from Kondo's cleanup allowlist; safe session-specific pruning is unverified ◇. |
| `shell-snapshots/` | Shell state snapshots ✅. Tidy candidate. |
| `backups/`, `paste-cache/`, `cache/`, `debug/`, `telemetry/`, `downloads/`, `ide/` | Support and cache directories ✅. Kondo's user-cache allowlist includes `paste-cache`, `cache`, `debug`, `telemetry`, `downloads` and `shell-snapshots`; it excludes `backups` and `ide`. An empty cache directory reclaims nothing and is never a candidate. Directory presence alone does not prove safe cleanup. |
| `chrome/` | Claude in Chrome's native-messaging host (`chrome-native-host.bat`) ✅. 1 KB; not a cache. |
| `plans/` | Plan-mode plans as markdown, one file per plan with a generated slug name ✅ (3 observed, 60 KB). The user's writing; never a tidy candidate. |
| `daemon`, `daemon.log` | Daemon socket/state and log ✅. |
| `stats-cache.json`, `statusline-command.sh`, `CLAUDE.md` | Misc: usage stats cache, statusline script, the user's global instructions ✅. `todos/` ◇ (documented, absent here). |
| `feedback/`, `daemon-auth-cooldown`, `daemon-auth-status.json`, `gh-pr-status-cache.json`, `.last-update-result.json`, `.last-cleanup`, `statusline-command.sh.bak`, marker files (`.caveman-active`, …) | Small support and state files ✅. Listed by name and size only. |
| `.credentials.json`, `.claude.json`, `.mcp.json` | Inside the user store: a credentials file (**read-never**, like the desktop token files), and two small JSON files (`.mcp.json` held an empty `mcpServers`) ✅. Not to be confused with `~/.claude.json` below — although a launch whose `CLAUDE_CONFIG_DIR` names this very directory reads this file as its registry ✅ (Claude profiles above). |

### Configuration absence and incomplete inventory

✅ **Kondo behavior, verified with synthetic fixtures:** installed-plugin reads
carry complete, partial or unavailable evidence independently of displayed rows.
Only the supported version-2 object with well-shaped installation arrays can
establish absence. Missing, unreadable, invalid or unsupported manifests offer
no missing-plugin candidates; readable installation entries survive alongside
itemized errors. Plugin-residue cleanup also withholds an incomplete manifest.

A boolean preference is a missing-plugin candidate only if the manifest is
complete and its marketplace is identified by an installation entry or an object
with source metadata in `known_marketplaces.json`. An empty valid manifest can
prove absence for a known marketplace; a missing manifest cannot. Legacy arrays,
unknown value shapes and sources without marketplace evidence are retained.

◇ **Documented Claude behavior, checked 2026-09-08:** directory plugins use
`<name>@skills-dir` without an install step; synced plugins use `@synced` and
session directory plugins use `@inline` without marketplace installation records.
See [the official plugin reference](https://code.claude.com/docs/en/plugins-reference#skills-directory-plugins).
Kondo preserves these preferences, even when no matching directory was found.
It does not claim to inventory every plugin source or load plugins itself.

◇ **Documented Claude behavior, checked 2026-09-08:** `doctor: off` can hide
bundled Doctor, and legacy commands participate in the skill system. See
[the official skills reference](https://code.claude.com/docs/en/skills#bundled-skills).
Bundled, managed and additional-directory skills cannot all be enumerated from
Kondo's bounded stores. Consequently **all skillOverrides are retained**, even
unknown names; scanning more local skill folders cannot prove global absence.
The skill-override response kind remains in the contract and is not emitted by
configuration cleanup.

✅ Preview and removal force a fresh session inventory as well as using a
fresh per-call plugin context. Recreating a registered project root invalidates
its previous absence even when the registry and transcript directories did not
change. A candidate lost after inventory degradation causes the entire mixed
selection to refuse before planning effects. Proved dead registry projects and
their MCP declarations remain available despite unrelated plugin errors. The
UI shows partial-scan problems and explains preserved preferences. The removal
itself is a settings edit and is refused.

### Plugin installation records

✅ Read off the Claude Code 2.1.271 binary's own version-2 schema on
2026-09-15, field descriptions and all. `installed_plugins.json` is
`{ version: 2, plugins: { <name>@<marketplace>: <entry>[] } }`, and one entry
is:

| Field | Type | Claude's own description |
|---|---|---|
| `scope` | `managed` \| `user` \| `project` \| `local` | Installation scope |
| `projectPath` | string, optional | Project path (required for project/local scopes) |
| `installPath` | string | Absolute path to the versioned plugin directory |
| `version` | string, optional | Currently installed version |
| `installedAt` | string, optional | ISO 8601 timestamp of installation |
| `lastUpdated` | string, optional | ISO 8601 timestamp of last update |
| `gitCommitSha` | string, optional | Git commit SHA for git-based plugins |
| `resolvedVersion` | string, optional | Tag-derived semver this install resolved to |
| `auto` | boolean, optional | True when pulled in as a dependency |

✅ **Kondo behavior:** every record survives into `PluginInfo.installations`,
ordered by scope rank (`managed`, `user`, `project`, `local`), then project
path, version and install path. Array position in the file is not an ordering
Claude promises, so the stated one is what makes the same store render the same
way twice, and no record can hide another of the same plugin. The row's
displayed `version`, `installScope`, `installedAt`, `lastUpdated` and
`installPath` are that first installation's — a projection, never a separate
fact. A record whose `installPath` leaves the user store keeps its place in the
list with `followed: false` and contributes no components; the refusal is
itemized where the path is resolved (ADR-0005). `resolvedVersion`, `auto` and
`gitCommitSha` are read past, not surfaced.

◇ A `version: 1` file holds one entry per id rather than an array, and Claude
Code converts it on load. The same build also knows a second filename,
`installed_plugins_v2.json`. Kondo reads neither: it reports any version but 2
as unsupported and establishes no absence from it.

### Plugin component layouts

✅ Read off the same 2.1.271 binary. A plugin's manifest is
`<plugin root>/.claude-plugin/plugin.json`, and each component field takes one
path string or an array of them, relative to the plugin root:

| Field | Default | How a declared path combines with the default |
|---|---|---|
| `skills` | `skills/` | **Adds** — "Loaded in addition to the skills/ directory" |
| `commands` | `commands/` | **Replaces** — "When set, the commands/ directory is not auto-loaded" |
| `agents` | `agents/` | Replaces, same wording |
| `outputStyles` | `output-styles/` | Replaces, same wording |
| `hooks` | `hooks/hooks.json` | Adds — "in addition to those in hooks/hooks.json" |

A `skills` entry names a skill directory, and `.` or `./` denotes the plugin
root itself. A `commands` entry names "a command file or skill directory", so a
flat `<name>.md` loads as a skill too. `commands` also accepts an object
mapping command names to `{ source }` or `{ content }`. The build treats a
directory as plugin-shaped when it holds `.claude-plugin/` or one of
`commands/`, `skills/`, `agents/`, `hooks/`, `themes/`, `output-styles/`,
`monitors/`, `workflows/`, `SKILL.md`, `.mcp.json` or `.lsp.json` at its top
level.

✅ **Skills-directory plugins.** Any folder under a skills directory holding
`.claude-plugin/plugin.json` loads as `<name>@skills-dir`, with no marketplace
and no install step. The two skills directories are `~/.claude/skills/` and
`<project>/.claude/skills/`, the second only in a workspace the user has
trusted. The same pass skips that folder *as a skill* ("`[skills] skipping
<dir>: .claude-plugin/plugin.json is not a regular file or exceeds <n>`"), so a
folder is a plugin or a skill and never both.

✅ **Kondo behavior, verified with synthetic fixtures:** `pluginSkills` reads,
per followed installation, the default `skills/`, every additive manifest
`skills` path, and either the manifest's `commands` paths or the default
`commands/`. The read boundary is the install root rather than the whole user
store, matching Claude Code's own refusal of a component path that escapes the
plugin directory. Two sources shipping one name resolve to a single row, the
first under the order above, as Claude keeps the first copy it loaded. Kondo
lists skills-directory plugins as plugins and keeps their folders out of the
skills catalogue — `countStoreEntries` still counts one as a skill, because
tier 1 counts by `readdir` alone (ADR-0007), which joins the tier-1/tier-2
disagreement recorded under "Cross-store facts".

Kondo does **not** read: a plugin's agents, output styles, hooks, MCP or LSP
servers, themes, monitors or workflows; the object form of `commands`; or a
`SKILL.md` at the plugin root. An unreadable manifest, a manifest field in a
shape Kondo does not read, and a component path that leaves the install
directory are each itemized in `Scan.errors` with a fixed sentence, and the
layouts that *are* readable still list beside them (ADR-0005, ADR-0022).

### `~/.claude.json` — the registry

One file beside the store, ~2 MB, 87 top-level keys ✅, rewritten by Claude
during every session. Each Kondo reader (session inventory, MCP listing,
skill usage, configuration leftovers, MCP toggle planning) parses it
separately and keeps only the parts named here (ADR-0009). Because it is
rewritten under kondo, the cached inventory stats this file (mtime and size)
and the `projects/` directory on every read and rebuilds when either moved
(ADR-0007) — a project entry Claude adds or a directory another tool removes
is seen without a restart:

- `projects` ✅ — an object keyed by the **absolute path** of every directory
  Claude Code has run in (4,335 keys observed; 4,309 spelled with `/` on
  Windows and 26 with `\`, 17 paths present under both spellings). This is
  the reverse map for `projects/` below. Per entry, kondo reads
  `mcpServers` (per-project MCP servers, 20 entries observed),
  `disabledMcpServers` (7), `hasTrustDialogAccepted`, and the legacy
  `disabledMcpjsonServers`, `enabledMcpjsonServers` and
  `enableAllProjectMcpServers` approvals (empty here) that Claude's startup
  migrates into the project's `settings.local.json`. `allowedTools` is present
  but unread, and the rest — `lastSessionFirstPrompt`, `lastCost`, token counts,
  `lastSessionId` — is session telemetry kondo never surfaces. 52 keys pointed at directories that no longer exist ✅:
  that is the dead-project signal. These keys are also **half of
  the project set**: kondo lists the union of them and the `projects/`
  directories below, joined on the flattened path, so a directory Claude has
  registered but never kept a transcript for is still a project. Each member
  carries `sources` (`registry`, `transcripts`, or both), `location`
  (`here`, `gone`, `unlocated` or `unreadable`) and `hasStore`, the last being
  whether it holds a `.claude` at all.
- `mcpServers` ✅ — user-scope MCP servers: `{ name → { type, command, args,
  env } | { type, url, headers } }`. `env` and `headers` can hold secrets.
- `skillUsage` and `pluginUsage` ✅ — usage counters, `{ name → {
  usageCount, lastUsedAt } }` (127 skill keys observed). The key is the
  skill's own **name**, bare for a user- or project-placed skill and
  `<plugin>:<name>` for a plugin-shipped one. Read for the "never used"
  badge: a name with no key, or a key whose `usageCount` is 0,
  has never been loaded. Only that boolean crosses the seam — the counts and
  timestamps are how often and when a user works, and stay in the main
  process. No `skillUsage` key at all (or no readable `~/.claude.json`) is a
  third state, carried as `null`: kondo cannot tell, and badges nothing.
- Everything else (`oauthAccount`, `userID`, `machineID`, experiment caches)
  is identity or telemetry: parsed with the file, never kept or surfaced.

The registry and settings planners express existing-file changes as narrow
`splice` steps carrying the digest of the bytes read, and an absent settings
layer as a whole-file `write` after a creation confirmation (ADR-0010).
Configuration-leftover plans remove dead `projects` entries with the
`mcpServers` declared inside them; settings plans edit only the members a
toggle or scope move needs. Historical splice journal entries carry inverse
edits rather than whole-file snapshots. Every such plan is refused before
effects.

### MCP servers — three scopes, two files

An MCP server declaration is `{ type?, command, args?, env? }` for a local
process or `{ type, url, headers? }` for a remote one ✅. **`env` and
`headers` hold API keys and bearer tokens**, so kondo builds nothing from
either — not their values and not their key names. What it keeps is the name,
the transport, and the file that declares it.

| Scope | Where | Id | Approval |
|---|---|---|---|
| `user` | `mcpServers` of `~/.claude.json` ✅ | `mcp:user:<name>` | none needed |
| `local` | `projects[<abs path>].mcpServers` of `~/.claude.json` ✅ (20 entries observed) | `mcp:local:<flat>/<name>` | none needed |
| `project` | `mcpServers` of `<project>/.mcp.json` ✅ | `mcp:project:<flat>/<name>` | Claude asks before using it |

`<flat>` is the flattened project path (ADR-0009), which is what joins a
declaration to the project directory it belongs to. Kondo reads `.mcp.json`
for every project whose path is there and which the registry names or which
holds a `.claude` store — a project with no store still has its committed
servers loaded by Claude — while the stores a mutation resolves stay the
verified ones. Discovery is tier-1 (ADR-0007): one registry parse, the
settings layers that are read anyway, one `stat` per registry entry that
actually declares a server, and one `.mcp.json` read per such project.

**What Claude Code does with a declaration**, read from the 2.1.271 binary and
cross-checked in the 2.1.269 and 2.1.270 binaries on 2026-09-15 ✅, against the
[MCP guide](https://code.claude.com/docs/en/mcp),
[settings](https://code.claude.com/docs/en/settings) and
[managed MCP](https://code.claude.com/docs/en/managed-mcp) pages checked the
same day ◇. Three independent mechanisms decide it:

- **The per-project switch.** `projects[<abs path>].disabledMcpServers` in
  `~/.claude.json` ✅ (7 entries observed) is what the `/mcp` toggle writes, by
  exact name and whatever scope declared the server — a user-scope one
  included, for that project alone. `enabledMcpServers` beside it is the opt-in
  list for built-in servers that default to off, which kondo does not list.
- **Approval of a `.mcp.json` server.** `enabledMcpjsonServers`,
  `disabledMcpjsonServers` and `enableAllProjectMcpServers` in settings files,
  which Claude's own approval prompt writes into that project's
  `settings.local.json` ✅. A rejection in any settings file rejects the server.
  An approval counts when the project's registry entry records
  `hasTrustDialogAccepted: true`; in an untrusted project only user, managed or
  `--settings` approvals count, plus a local file git does not track ✅. Names
  in these keys match after Claude's normalization — every character outside
  `[A-Za-z0-9_-]` becomes `_` ✅. Older versions kept the same three keys in the
  registry entry; the current startup merges them into that project's
  `settings.local.json` and deletes them ✅, so kondo reads them as statements
  of that layer.
- **Allow and deny lists.** `deniedMcpServers` and `allowedMcpServers` may sit
  in any settings file and merge from every scope ◇. A deny entry matches an
  exact `serverName`, an exact `serverCommand`, or a `serverUrl` with `*`
  wildcards, and nothing overrides it; an allowlist blocks what it does not
  match. `allowManagedMcpServersOnly` and a `managed-mcp.json` with exclusive
  control are managed-only ◇.

✅ **Kondo projection, verified with synthetic fixtures:** each declaration
carries one status for the place it is declared for, the first of these that
holds: `overridden` (a higher-precedence declaration of the same name is the
one Claude reads), `restricted` (a readable `deniedMcpServers` names it),
`rejected`, `pending`, `disabled` (the project's switch), `unknown`, then
`approved` or `configured`. `unknown` replaces a positive answer whenever it
depends on something kondo may not read: a settings layer or a registry that
did not parse, a project folder kondo could not look at, an allowlist or a URL
or command deny rule (kondo evaluates neither), or an untrusted project whose
only approval sits in its local layer.
Managed settings, `managed-mcp.json`, `--settings`, the approvals a running
session holds and the environment stay outside the boundary and are stated
rather than guessed. No status says a server connects.

A `local` declaration's registry path is looked at once, and the look has three
answers ✅. A path that is there adds nothing. A path that is **gone** (ENOENT)
reports `orphan: true` — the dead-project signal in its MCP form — and makes
the whole registry entry a leftover `configOrphansPreview` offers to splice out
(ADR-0010). Any **other** failure is neither: kondo could not look, which is
not evidence of deletion, so the declaration is not an orphan, records its
`stat-failed` error, reads `unknown` with a fixed sentence naming the folder
kondo could not check, and has both switch directions refused — without the
Leftovers sentence, because Leftovers never offers it. Only ENOENT is deletion,
the same split `sessions.ts` makes for a project's `location`.

That switch is also what kondo's toggle plans (execution refused): `disable`
adds the name to the project's `disabledMcpServers` and `enable` takes it out,
as one splice of the list's value carrying its planned digest (ADR-0010). A
user-scope declaration is switched from a project's page, which names the
project in the request — `ProjectDetail.inheritedMcpServers` is what that page
lists. Approval is read and never planned, because Claude gates it behind its
own prompt; `.mcp.json` is never written (ADR-0002), and a declaration is never
moved between files.

`~/.claude/.mcp.json` also exists inside the user store (empty `mcpServers`
on the observed machine ✅) and is **not** one of the three scopes above;
kondo does not read it.

### What settings-derived data crosses

◇ **Documented Claude behavior, checked 2026-09-15:** the
[settings reference](https://code.claude.com/docs/en/settings-reference)
documents 168 top-level keys. Seven of them (`autoConnectIde`,
`autoInstallIdeExtension`, `copyOnSelect`, `diffTool`, `externalEditorContext`,
`permissionExplainerEnabled`, `teammateDefaultModel`) belong in `~/.claude.json`
rather than a settings file. The [hooks reference](https://code.claude.com/docs/en/hooks)
documents 33 events and five handler types (`command`, `http`, `mcp_tool`,
`prompt`, `agent`); a matcher of `*`, an empty string or none matches
everything. The [MCP guide](https://code.claude.com/docs/en/mcp) documents the
`stdio`, `http`, `sse` and `ws` declaration types, with `streamable-http` as an
alias of `http`.

✅ **Kondo projection, verified with synthetic fixtures:** a settings-file
summary carries only the 161 documented settings-file names it states, and
`unlistedKeys` when it states others. A hook row carries a documented event or
null, a documented handler type or null, `hasMatcher`, the status of the first
script its command names, and the file, layer and project that arm it; command
text, matcher patterns and script paths stay in main. An MCP transport outside
the documented set reads as `unknown`, and a declaration also carries one
validated status with, where that status needs one, a fixed sentence naming the
settings file that decided it. Settings read failures and hook-script
stat failures carry a fixed sentence and the settings file's display path. A
JSON syntax error from a settings file, the registry, `.mcp.json`, the plugin
manifest or a journal line carries one fixed sentence, because V8's message
quotes the parsed source. An incomplete plugin installation entry is named only
by a `<name>@<marketplace>` key; any other key is file text and gets a fixed
sentence. The lists live in `shared/contract.ts` (ADR-0022); a
name Claude documents later reads as unlisted or unrecognized until they are
updated.

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

`move` **is** permitted, because putting the file in the other
scope's directory is exactly how Claude loads it there — nothing is invented.
A promotion runs the skill move's plan unchanged: copy, verify, trash, as one
journal entry, so ADR-0001's undo restores it or none of it. `output-style`
is the exception, and only in one direction: a project store has no
`output-styles` directory to read, so a project destination is refused for
that kind rather than kondo creating the first one anybody has seen.

A name can repeat across scopes, and that is the one thing kondo removes by
hand. `skillDuplicates` groups the skill listing by name and
returns only groups of more than one, digesting each member's tree — the
digest is what says whether the copies are actually the same skill, because
two scopes can hold the same name over completely different work. A name that
repeats nowhere is never hashed (ADR-0007), and a member whose tree could not
be read carries no digest and makes its group not identical: "kondo could not
tell" must never render as "safe to remove". Removal is a fourth capability
operation, `trash`, allowed only in the four scopes a user placed a skill in
by hand — a plugin-shipped skill follows its plugin, and a plugin's files are
the plugin's to remove.

✅ **Kondo logical equality, verified with synthetic fixtures:** tree
digests frame each entry's type, complete relative path and file bytes with
explicit lengths. Empty files/directories and binary contents count; safe
internal links match their materialized copies. Thus a common `SKILL.md` plus
`a=bc` differs from `ab=c`, and no removal-review token is issued. Unreadable
members still prevent equality. The public digest remains SHA-256 hexadecimal;
see [ADR-0019](adr/0019-frame-logical-tree-digests.md) for its encoding.

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
  directories; the rest are scratch directories Claude has already forgotten. Kondo still stats the
  path before claiming it, and records the outcome as four states, never one
  flag: `here`, `gone` (the registry named the path and the stat came back
  ENOENT — a *dead project*), `unlocated` (no key, and the guess never
  verified — which is not evidence of anything) and `unreadable` (the registry
  named it and the stat failed some other way: a permission kondo does not
  have, a volume no longer mounted, an I/O error). Only ENOENT is evidence of
  deletion, so only `gone` makes a dead-project candidate; an `unreadable`
  project carries a `stat-failed` scan error and is never offered as dead,
  because an unmounted volume still holds every byte it ever did (ADR-0005).
  Throwaway names are judged separately: a worktree or job marker, or a known
  project path (registry key or verified guess) under a temp root, can offer
  an inactive directory without `memory/` whatever its location.
- Scale is real: **9,171 project directories** observed on one machine ✅
  (9,031 of them under a temp directory — benchmark and scratchpad runs);
  11,517 registry-plus-directory members on 2026-09-05, 8,498 of them
  throwaway by name and 50 gone from disk. Scanning must be stat-based and
  lazy; never parse every transcript up front (ADR-0007), and a listing must
  not put one row per member on screen: the projects home names a row by the
  last path segment with the parent beneath (`ProjectRow.name` / `parent`,
  built in `workspace.ts`), folds throwaway and gone rows behind a count
  (`ProjectRow.throwaway` / `location`), and pages the rest.
- Temporary-project classification uses the locator's lexical and
  canonical temporary roots. Native realpath expands Windows 8.3 short names
  (verified locally and covered by an injected classification regression) ✅.
  MacOS `/var` and `/private/var` aliases are expected
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
    sessions as the `desktop-released-sessions` tidy category.
    ✅ **Kondo source inspection:** the scanner associates the marker
    by filename without parsing its contents, so it verifies neither the
    marker's reason nor that a Desktop or cloud copy is gone. The screens
    therefore name the marker rather than the deletion: the session row says
    `desktop released marker`, the tidy category `Conversations with a desktop
    released marker`, and its History row `conversation(s) with a desktop
    released marker` ([ADR-0016](adr/0016-desktop-session-boundary.md)).
  - `.benchmarks/<name>/runs/<stamp>/` ◇ — benchmark runs written by
    `claude plugin eval`; one project directory held one. Known, never
    offered.
  - `memory/` — the project's persistent memory files. Directories that hold
    only `memory/`, and directories that hold no transcript at all, both
    occur ✅, and some of them are live projects — `D:\Code\example-app`, say
    — whose memory is the only thing Claude has recorded there.
    So "no transcript" is not "scratch": the tidy sweep offers a
    transcript-less directory whole only when it holds no `memory/`, shows no
    recent activity, and either carries a throwaway name (a worktree or job
    marker, or a known project path under a temp root) or has an *unlocated*
    path. Throwaway names are checked first; otherwise one whose path is
    `gone` is a dead project, and one holding `memory/` under a live or
    unlocated path is Claude's record of a project and is offered nowhere.
  - Occasional top-level `.json` files ◇ (five seen in one directory; not
    yet understood, reported as unknown).
- Transcript lines are typed events. First line observed with keys `type`,
  `leafUuid`, `sessionId` ✅; message lines carry timestamps and roles ◇.
  Kondo streams a transcript line by line, never whole, for its line and
  message counts, first user prompt and first and last timestamps; worked
  time is not computed yet.
- ✅ **Kondo implementation:** every removal size is measured over the exact
  deduplicated `trash` steps the review token binds — the per-category
  `tidyPlan` steps `tidyPreview` snapshots, and the `sessionTrashPlan` steps
  `snapshotSessions` snapshots — never a second walk of the store. Regular-file
  bytes are summed with `inspectPhysicalTree`, giving directories and links
  nothing, exactly as `trashSize` counts the trash, so a confirmed move grows
  the trash by exactly the figure the screen showed. A transcript's sidecar
  directory and `.desktop-released.json` marker are steps of the same plan, so
  their bytes are in that figure; the per-session `bytes` in a listing remains
  one transcript, which is the stat the inventory took (ADR-0007). Category
  figures are disjoint — a path counted in one is counted in no other — so a
  combined selection is the sum of its categories. `RemovalSizeEstimate`
  carries three figures separately, because displacing into kondo's trash frees
  no disk space and only a permanent empty does: what moves, what the trash
  then holds, and what emptying it would free. A preview whose reviewed path
  could not be read, or which was issued no review token, is marked
  `incomplete` and its figures are a floor.
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

### Reviewed removal policy

✅ Synthetic removal regressions verify this Kondo policy. Removal safety uses current filesystem evidence, not a claim that Claude has
finished with a file. `tidyPreview`, `sessionTrashPreview` and `skillDuplicates`
retain exact reviewed identities and content/activity preconditions in main.
Category additions, missing or changed members, resumed transcripts and changed
duplicate groups require renewed review before mutation (ADR-0015). Session
sidecars and released markers are part of the reviewed displacement, and of the
size the preview reports for it.

A temporary/worktree/job name alone is not enough to make its saved tree eligible.
Scratch trees with memory, recent entries or unreadable activity evidence are
withheld and counted separately; their sessions do not fall through into another
cleanup category. Explicit selected-session removal remains a separate review.
These are Kondo policies over observable state, not proof of process inactivity.

### Session removal scope

✅ **Kondo implementation, source-reviewed with existing synthetic coverage:**
`sessionTrashPlan` in `kinds.ts` moves only the selected Code transcript,
recognized sibling sidecar directory and `.desktop-released.json` marker when
present. `workspace.ts`'s `snapshotSessions` refuses ambiguous or unrecognized
entries in the selected UUID namespace rather than silently expanding that set.
Desktop IDs are refused. `test/session-duplicates.test.ts` and
`test/tidy.test.ts` cover selected displacement, review changes and Undo.

Selected removal leaves `session-env/`, `history.jsonl`, `file-history/`,
`backups/` and Desktop records untouched. `orphan-session-env` is a separate
category: a fresh inventory must no longer contain a transcript for that UUID.
Even if a sweep removes a transcript, that sweep does not also treat its
previously live snapshot as orphaned. Whole-project tidy categories instead
move the reviewed saved-data tree under `projects/`; their scope is broader
than selected removal but does not include those global or Desktop residuals.

◇ Exact retained-content relationships, safe pruning rules and completeness
across Claude versions remain unverified for file history, backups, shared
Desktop artifacts and external copies. They must not become new deletion
candidates from a matching UUID alone. Kondo's trash retains displaced bytes;
its journal and scan cache are separate retained records, not cleared by
selected removal or trash emptying — the scan cache can keep derived
opening-prompt data and source paths after removal. No action promises
privacy erasure ([ADR-0016](adr/0016-desktop-session-boundary.md)).

## Project store: `<project>/.claude`

- `settings.json` (project scope, committed) and `settings.local.json`
  (local scope, git-ignored) — same schema family as user settings ◇.
  `settings.local.json` carrying `enabledPlugins` is observed in the wild ✅;
  `hooks` and `permissions` are expected here too ◇. Claude's MCP approval
  prompt writes its answer here as well — `enabledMcpjsonServers`,
  `disabledMcpjsonServers` or `enableAllProjectMcpServers` ✅ — which is why
  this file decides whether a `.mcp.json` server loads.
- `skills/`, `agents/`, `rules/`, `hooks/` ✅ — project-scope variants,
  observed in every sampled project store (`agents/*.md`, `rules/*.md`,
  `hooks/` scripts with `__pycache__` and `*.test.js` noise beside them).
  `commands/` ◇. Kondo reads `skills/`, `agents/`, `commands/` and `rules/`
  (see "Placed entries" above); `hooks/` holds scripts, and a script on disk
  is not an armed hook, so it is read through the settings layers instead.
  A **project** layer's relative hook path resolves against that project
  directory ✅ — the directory Claude runs its hooks in — which is how
  `.claude/hooks/guard.sh` in a project `settings.json` verifies. The
  `unarmed-hook-scripts` category is blocked: neither user nor project
  scripts can be classified as unused from this incomplete inventory.
- `worktrees/` and `docs/` ✅ — seen in one store. Claude registers a git
  worktree under `.claude/worktrees/` as a project of its own in
  `~/.claude.json`, so it is both inside the boundary and a duplicate-project
  candidate.
- `CLAUDE.md` ◇ — the in-boundary placement of a project's instructions.
  `./CLAUDE.md` and `CLAUDE.local.md` at the project root are outside
  ADR-0002 and invisible by design.
- `skills.disabled/` ◇ — the project-scope counterpart of the user store's
  parking spot, unobserved in the wild: no Claude Code build reads it in *any*
  scope. Kondo reads it back as the `project-disabled` skill scope and never
  moves skills into it; the per-skill switch Claude honours here is
  `skillOverrides` in this project's settings layers (ADR-0006).
- Settings precedence: local > project > user ◇. Settings-file summaries list
  these layers (ADR-0021), and a plugin's state is resolved through
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
  These edits are refused by the execution gate. Which file a position plans to edit is chosen in the main process:
  the highest-precedence layer of that scope that *already states a value*,
  and `settings.local.json` when none does.
- Handing a plugin to another scope is those same statements twice, never a
  relocation: nothing installed moves on disk. Kondo plans `false` in the
  layer that enabled it and `true` in the destination scope's layer, as one
  plan (`pluginMove`) carrying one splice per file, each with its own digest.
  A destination that does not exist yet is a write, with a creation
  confirmation. Both forms are refused whole before any effects. The
  destination *file* is chosen by the same rule as a toggle's.

## Desktop store

**Partial, read-only session support** ([ADR-0016](adr/0016-desktop-session-boundary.md)).
✅ Source inspection: `desktopSessions` is exposed through the workspace/typed
bridge but has no renderer consumer. The adapter reads names, sizes and mtimes,
not session JSON contents. Code rows receive only a filename-stem match through
`desktopSessionStems`; that match merges devices/accounts into one set and is
not content equality or a verified backup. The separate `desktop-caches`
cleanup category is unaffected.

Electron app data — 10.9 GB on the owner's machine on 2026-09-05 ✅, against
1.6 GB for the Claude Code store. Observed top-level entries, by what they
are:

| Entry | What it is | Kondo |
|---|---|---|
| `vm_bundles/` (`claudevm.bundle/`, `warm/`) | 9.3 GB ✅ — the cowork VM image and its warm copy. Whether the app re-downloads a missing bundle is not established ◇. | Reported. **Never offered**: not a cache until proven one. |
| `claude-code/<version>/`, `claude-code-vm/<version>/` | 416 MB + 205 MB ✅ — the Claude Code CLI the desktop app bundles, one directory per version (2.1.258 and 2.1.260 seen; only the newer has a `-vm` twin). The older version looks superseded ◇, the way a plugin's cache versions are. | Reported. Not offered until the app's rollback behaviour is known. |
| `Code Cache/`, `Cache/`, `GPUCache/`, `DawnGraphiteCache/`, `DawnWebGPUCache/`, `Shared Dictionary/` | 317 MB + 157 MB + … ✅ — Chromium's own caches; the app rebuilds each on its next launch, which is what "clear cache" means in any Electron app. | The `desktop-caches` tidy category, at the root and inside each `Partitions/<name>/`. |
| `Partitions/<name>/` | 129 MB ✅ — one Chromium profile per isolated web view (`cowork-artifact-<ids>`, `cowork-file-preview`, `launch-preview-cowork-shared`, `launch-preview-static`), each with the same cache directories beside its `Local Storage`, `IndexedDB`, `Network`, `Preferences`. | Only the cache directories inside are offered. |
| `local-agent-mode-sessions/<device-or-install-uuid>/<account-uuid>/` | 287 MB ✅ — desktop/cowork sessions: `local_<session-uuid>.json` + `local_<session-uuid>/` per session, `agent/`, `artifacts.json`, `cowork-*-cache.json`. | Filename match and metadata listing API only; no session UI consumer. Session contents are not opened by this adapter. Never swept or removed by Code session removal. |
| `claude-code-sessions/<uuid>/`, `scratch-workspaces/`, `git-shadow/`, `git-worktrees.json` | 9 MB + … ✅ — cowork's working state: the CLI sessions it drove, the scratch checkouts it works in, shadow git data. | Reported only. |
| `logs/` (14 files), `sentry/`, `Crashpad/` | 56 MB ✅ — the app's own logs, error reports and crash dumps. | Reported only ◇ — a candidate once the app's retention is known. |
| `pending-uploads/` | 22 MB, 60 PNGs ✅ — pasted images awaiting upload. | **Never offered**: in-flight user data. |
| `IndexedDB/`, `Local Storage/`, `Session Storage/`, `WebStorage/`, `File System/`, `blob_storage/`, `Network/`, `DIPS*`, `SharedStorage*`, `InterestGroups/`, `VideoDecodeStats/`, `Local State`, `Preferences`, `shared_proto_db/`, `fcache` | Chromium's state stores ✅. | Reported only; state, not cache. |
| `Claude Extensions/`, `Claude Extensions Settings/`, `ChromeNativeHost/`, `design/`, `document-baselines/`, `extensions-*.json`, `mcp-user-tool-toggles.json`, `cowork-enabled-cli-ops.json`, `claude_desktop_config.json`, `config.json`, `window-state.json` | The desktop app's own configuration and features ✅. | Reported only. |
| `ant-device-registry.json`, `ant-did`, `bridge-state.json`, `buddy-tokens.json`, `lockfile` | Device/identity state and Electron's single-instance lock ✅. **Read-never** for the identity and token files: names and sizes only. `lockfile` is opened `r+` — never read — when a tidy preview finds desktop-cache candidates, because Electron holds it with exclusive access while the app runs (EBUSY on Windows, verified with the app up), which is how kondo knows not to sweep caches the app has open. On every platform a `SingletonLock` / `SingletonSocket` / `SingletonCookie` beside it also blocks the sweep (such a marker may be left behind by a crash ◇, in which case kondo refuses a sweep that would have worked). | The `desktop-caches` block. |

Cloud sessions (claude.ai) have no local files unless mirrored here; kondo
only sees what is on disk.

The read-never policy is pinned by synthetic fixtures: `.credentials.json`
under the user root and `ant-did`, `ant-device-registry.json`,
`bridge-state.json`, `buddy-tokens.json` under the desktop root. The
protected-name assertion covers `fs/promises.readFile` calls, including failed
attempts; see [testing.md](testing.md) for the other read mechanisms the
boundary test observes. Names and sizes remain available to store reports.

## Cross-store facts

- A session id is a UUID and appears in: its transcript filename, the
  transcript's lines, `history.jsonl` entries, `session-env/`, and possibly a
  desktop-store directory. Kondo joins on it in two places only, and does not
  read `history.jsonl`. The transcript and its sidecar move together;
  `session-env/` uses a separate orphan join, not a removal cascade.
  `session-env/` held 5,213 directories against 11,686 transcripts ✅, and the
  `orphan-session-env` sweep offers only the snapshots the transcript set does
  not claim. The desktop store's `local_<uuid>.json` stems are joined to the
  code store's uuids for `SessionSummary.mirroredIn` ✅, which means a matching
  identifier only, not verified equal contents or completeness.
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
  location/store facts, attribution, IDs and aggregate counts.
- Because the set is a union, its size is not the same figure as "projects
  with transcripts", and the wider one must never be shown wearing the
  narrower one's label. `StoresOverview.sessions` carries both:
  `projectCount` is the union, and `transcriptProjectCount` is how many of
  those hold at least one transcript — derived from the same tier-1
  inventory, not from a second scan (ADR-0007). A registry key Claude has on
  record but never worked in sits in the gap between them, so the pair is
  what the projects home prints, each number named for the set it counts.
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
  The two tiers disagree in two places, both because tier 1 opens nothing: a
  directory under `skills/` with no `SKILL.md` counts as a skill and is not
  listed as one, and one holding `.claude-plugin/plugin.json` counts as a skill
  while the catalogue lists it as a plugin (see "Plugin component layouts").
- Timestamps are ISO-8601 strings in JSON files ✅. Staleness uses file mtime
  alone (`STALE_AFTER_DAYS`, 30 days), because it is cheap.
- All JSON/JSONL reads assume partial corruption is possible (interrupted
  writes). A bad line is skipped and reported, never fatal.
- Settings can be reached through filesystem links ◇; this is a supported
  layout, not a newly observed Claude convention. Settings execution is
  refused before any link or target is changed. Other mutation targets must
  stay inside their resolved store root; missing destinations resolve through
  existing ancestors and dangling links refuse. The registry remains one named
  file under its resolved parent, not permission to follow a link into another
  home file.
- Journal shape validation is covered by fixtures ✅: a line is accepted only
  when its record and every step have the fields the operation needs, including
  inverse splice edits and undo/failure links. Valid JSON with the wrong shape
  is skipped as one whole entry and reported as `parse-failed` at
  `journal.jsonl:<line>`. Other entries remain listed, with those
  read errors still returned. Entries containing `write` or `splice` remain
  readable but their Undo is refused before effects. Optional historical
  fields and additional metadata are accepted; the journal is never rewritten
  to repair a line. Readable `undoOf`/`failedOf`/`progressOf` references in
  rejected entries conservatively block undo of the related change, without
  supplying steps or claiming a completed undo.
- A journal step names a store root and a path relative to it, and records the
  directories it created; Undo removes those directories only while they are
  still empty.
- Bytes kondo displaces leave their store entirely: they land in
  `<kondo-data>/trash/<journal-id>/<store-name>/<path relative to that
  store>`, which sits outside every store above (ADR-0001) and so never
  turns up in a scan of one. A store name holding a colon — `project:<dir>`
  — spells it with a dash on the way in, because no Windows path segment may
  carry one. Emptying that trash is the only removal of store bytes kondo
  ever performs; every other operation moves them. The displaced copy is the
  only copy, so an entry whose bytes were emptied can no longer be reversed —
  `undo` refuses it and says so, rather than half-restoring.
- ✅ Version 2 Kondo journal behavior, verified with synthetic fixtures:
  intention, pending-action digest, confirmed cursor and completion are separate
  append-only records. Only a completed Undo sets `undoneBy`; failed or interrupted
  attempts remain incomplete. A retry reuses the attempt, skips confirmed actions
  and compares both endpoints of the pending action to its recorded digest.
  Ambiguous evidence retains all remaining bytes and refuses recovery. Physical
  file fingerprints stream bytes; archived links remain metadata. The parser
  checks action identity, order and exact coverage of confirmed forward steps.
  A torn tail remains in place and a later append begins on a separate line.
- ✅ Pending logical copies record `tree-v2:<hex>` fingerprints (ADR-0019).
  Bare fingerprints from older pending copies remain readable but cannot prove
  equality. Recovery stays uncertain and blocked, with an explanation in History,
  without appending progress or changing either endpoint. Confirmed historical
  cursors and completed copies remain undoable. No journal migration rewrites evidence.
- ✅ Pending physical moves and Undo moves record `physical-v2:<hex>`
  fingerprints (ADR-0020). Physical tree identity frames entry kind, UTF-8 path,
  stored link text and streamed file length/content separately. Bare pending
  move fingerprints and fingerprints carrying the other action type's prefix
  remain readable but cannot prove equality. Recovery blocks before endpoint
  reads, journal appends or effects and keeps all bytes. Completed legacy cursors
  remain usable, but a later checkpoint cannot clear mismatched typed evidence
  into completion or a successful Undo. Link text stays metadata rather than
  authority to read a target.
- ✅ Legacy records and failure markers remain readable without migration.
  A failed legacy Undo lacks action evidence, so it cannot consume the original
  or authorize automatic replay. New partial forward results include the journal
  entry alongside errors, keeping inline recovery reachable. `none` reports no
  confirmed action effects; `uncertain` reports missing confirmation. These are
  Kondo execution facts, not newly observed Claude file conventions.
- An undo never renames over a path that is occupied. The time between an
  operation and its undo belongs to whoever else writes there — Claude
  saving a transcript at the same uuid a sweep trashed is the ordinary case
  — so a `move` or a `trash` being reversed stats its restore path first and
  displaces any occupant into the undo's own
  `<kondo-data>/trash/<undo-id>/` before putting the recorded bytes back.
  That displacement is a `trash` step on the undo entry, decided while the
  entry is built, because the entry is written before its steps run and a
  step it does not carry is bytes nothing records.

## Known compatibility gaps

Checked against Claude Code documentation on 2026-09-06; each is open work in
[ROADMAP.md](../ROADMAP.md).

- A `CLAUDE_CONFIG_DIR` set in user or managed settings, rather than in the
  environment a launch inherits, still selects a profile for Claude Code ✅,
  and a legacy `.config.json` still replaces the registry ✅ (checked
  2026-09-15). Kondo follows only its own environment and `--claude-config-dir`
  and reads only `.claude.json`, so in either case it shows the default store
  while Claude Code uses another. See Claude profiles above.
  [Environment variables](https://code.claude.com/docs/en/env-vars).
- A `version: 1` `installed_plugins.json` still loads for Claude Code, which
  converts it in memory ✅ (checked 2026-09-15), and the same build knows a
  second filename, `installed_plugins_v2.json`. Kondo reads neither, so on such
  a machine it reports the file as unsupported and establishes no absence from
  it. See Plugin installation records above.
- A plugin's agents, output styles, hooks, MCP and LSP servers, themes,
  monitors and workflows are components Claude loads and Kondo does not list ✅.
  Only the skill-producing layouts are inventoried. See Plugin component
  layouts above.
