# The Claude data landscape

Everything kondo knows about Claude's on-disk world. This document is the
single source of truth for store facts; adapters implement it, tests encode
it, and PRs that learn something new must update it.

None of these formats are publicly documented or stable. Every fact carries a
marker:

- ✅ **verified** — observed directly on a real machine (last: 2026-08-28,
  Windows, Claude Code ~2.x).
- ◇ **expected** — inferred from platform conventions or public knowledge;
  verify before relying on it in code.

Adapters must treat all of it as best-effort: unknown files appear, schemas
drift. Unknown ≠ error (see ADR-0005).

## The three store kinds

| Store | Location | Owner |
|---|---|---|
| User store | `~/.claude` ✅ | Claude Code CLI |
| Project store | `<project>/.claude` ✅ | Claude Code CLI, per project |
| Desktop store | Windows: `%APPDATA%\Claude` ✅ · macOS: `~/Library/Application Support/Claude` ◇ · Linux: `~/.config/Claude` ◇ | Claude desktop app (Electron `userData`) |

The privacy boundary (ADR-0002): inside a project, kondo opens **only** the
`.claude` directory. Everything else in the project is off-limits.

## User store: `~/.claude`

Observed top-level entries ✅ (one machine; expect variation by version and
usage):

| Entry | What it is |
|---|---|
| `projects/` | Session transcripts, one subdirectory per working directory. The heart of kondo's session features. |
| `settings.json` | User-scope settings. Observed keys: `env`, `permissions`, `skillOverrides`, `hooks`, `statusLine`, `enabledPlugins`, `extraKnownMarketplaces`, `outputStyle`, `language`, `modelSettings`, `autoUpdatesChannel`, `tui`, `theme`, and more ✅. The toggle surfaces kondo cares about: `enabledPlugins`, `skillOverrides`, `hooks`. |
| `enabledPlugins` | An object keyed by `<plugin>@<marketplace>` whose value is a boolean — both `true` and an explicit `false` observed in the wild ✅. An explicit `false` is how a layer overrides a lower one, so it is what kondo writes to disable; a key that is simply absent is silence, not a false. A legacy array form is read (a listed key is enabled) but never written. |
| `skills/` | User-scope skills, one directory per skill with a `SKILL.md`. |
| `skills.disabled/` | Claude's own disable convention: a skill moved here stops loading ✅. Kondo adopts this for enable/disable (ADR-0006). |
| `plugins/` | Plugin machinery: `installed_plugins.json`, `known_marketplaces.json`, `plugin-catalog-cache.json`, `cache/<marketplace>/<plugin>/<version>/` (the installed code), `marketplaces/`, `data/` ✅. |
| `commands/` | User-scope slash commands (`.md` files) ◇. |
| `hooks/` | Hook scripts referenced from settings ◇. |
| `history.jsonl` | Global prompt history. Line schema: `display`, `pastedContents`, `timestamp`, `project`, `sessionId` ✅. |
| `sessions/` | Live-session registry: `<pid>.json` + `<pid>.<hash>.key` pairs ✅. Presence ≠ running; stale entries linger. |
| `session-env/` | Per-session environment snapshots, one dir per session id ✅. Orphan-sweep candidate. |
| `tasks/` | Background task state, one dir per task id, plus `pins.json` ✅. |
| `jobs/` | Job state, dirs per job id ✅. |
| `file-history/` | Edit history backing checkpoint/rewind ✅. Grows silently; tidy candidate. |
| `shell-snapshots/` | Shell state snapshots ✅. Tidy candidate. |
| `backups/`, `paste-cache/`, `cache/`, `debug/`, `telemetry/`, `downloads/`, `ide/` | Support and cache directories ✅. Reclaimable space lives here. |
| `daemon`, `daemon.log` | Daemon socket/state and log ✅. |
| `stats-cache.json`, `statusline-command.sh`, `CLAUDE.md`, `todos/` | Misc: usage stats cache, statusline script, the user's global instructions, todo lists ✅ (todos ◇ on this machine). |

### `projects/` — sessions

- One directory per working directory Claude Code has run in, named by
  flattening the absolute path: `D:\Programs\cmder` → `D--Programs-cmder`,
  `C:\Users\X\.claude-jobs\...` → `C--Users-X--claude-jobs-...` ✅. The
  flattening is lossy (both `\` and leading dots become `-`), so the reverse
  mapping is heuristic — kondo verifies a candidate original path exists
  before claiming it.
- Scale is real: **8,921 project directories** observed on one machine ✅.
  Scanning must be stat-based and lazy; never parse every transcript up front
  (ADR-0007).
- Inside a project directory ✅:
  - `<session-uuid>.jsonl` — the transcript, append-only JSONL.
  - `<session-uuid>/` — optional sibling directory (subagent transcripts,
    tool state). A sibling without its `.jsonl` is an orphan.
  - `memory/` — the project's persistent memory files.
- Transcript lines are typed events. First line observed with keys `type`,
  `leafUuid`, `sessionId` ✅; message lines carry timestamps and roles ◇.
  Kondo reads the first and last lines to bound a session in time, and
  message timestamps (streamed, never whole-file) for worked time.

## Project store: `<project>/.claude`

- `settings.json` (project scope, committed) and `settings.local.json`
  (local scope, git-ignored) ◇ — same schema family as user settings;
  `enabledPlugins`, `hooks`, `permissions` appear here too.
- `skills/`, `commands/`, `agents/`, `rules/`, `hooks/` ◇ — project-scope
  variants.
- `skills.disabled/` ◇ — the project-scope counterpart of the user store's
  disable convention. Unobserved in the wild; kondo writes it because ADR-0006
  chose the scoped equivalent over inventing state, and reads it back as the
  `project-disabled` skill scope.
- Settings precedence: local > project > user ◇. The settings viewer renders
  these as layers, and the plugins view resolves a plugin's state through
  them: the highest layer that states a value is the one that wins. Layers
  belonging to different projects share a rank — Claude resolves settings per
  session, so across projects there is no ordering to have.

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
  desktop-store directory — this is how kondo joins data across stores and
  finds duplicates and orphans.
- Timestamps are ISO-8601 strings in JSON files ✅; file mtimes are the
  fallback signal and are what staleness uses first (cheap).
- All JSON/JSONL reads assume partial corruption is possible (interrupted
  writes). A bad line is skipped and reported, never fatal.
