# Plan: Claude configuration profiles (104)

Status: **in progress**

Kondo ignores `CLAUDE_CONFIG_DIR`, so it can read a different Claude profile
than the one Claude Code uses (publication audit finding A7). This slice makes
Kondo read the profile Claude Code uses, gives a desktop launch that inherits no
terminal environment a way to choose one, shows which profile is open, and keeps
each profile's journal and trash apart. It changes which store is read and
shown, never store contents.

## The verified convention

Read on 2026-09-15 from the installed Claude Code 2.1.271 binary on Windows and
from the [environment variables](https://code.claude.com/docs/en/env-vars) and
[settings](https://code.claude.com/docs/en/settings) pages:

- The configuration home is `CLAUDE_CONFIG_DIR`, NFC-normalized, else
  `~/.claude`. The documentation says all settings, session history and plugins
  are stored under it; the binary also resolves `projects/`, `output-styles/`,
  `teams/`, `ide/` and `.credentials.json` from it. Every user-store entry in
  [domain.md](../domain.md) is a child of that directory, so all of them move.
- The registry is `.claude.json` in `CLAUDE_CONFIG_DIR` when the variable is
  set, else in the home directory: **inside** a chosen directory, **beside** the
  default store. A legacy `.config.json` in the configuration home replaces it
  when that file exists.
- Nothing else moves: project stores (`<project>/.claude`), `<project>/.mcp.json`,
  managed settings and the Claude desktop app's store keep their locations.
  Claude Code also looks for IDE lock files in `~/.claude/ide`.
- The variable can be set in the shell, in user settings or in managed
  settings; project and local settings cannot set it. Claude Code itself
  reports a non-absolute value as an error where it places worktrees.
- A process started with `CLAUDE_CONFIG_DIR` set to the default directory reads
  `~/.claude/.claude.json`, the in-store file domain.md lists, rather than
  `~/.claude.json`. Kondo follows the same rule.

## Scope

Workspace:

- `locator.ts` resolves the store set in precedence order, records which
  selection won and which it did not follow, places the registry inside a
  chosen directory, and derives Kondo's data root for a store set.
- `profile.ts` (new, beside `appearance.ts`) builds the display-safe profile
  description and claims a data root for one store set in `stores.json`.
- `workspace.ts` composes `profileGet` (one line; entry 103 also edits this
  file). `mutations.ts` gets a comment fix only: the `user-config` root can now
  be the user store itself.

Composition root: `index.ts` selects the data root before the single-instance
lock, claims it after the lock and before the workspace, and refuses a
mismatched data root with an error box.

Seam: `profileGet` in `shared/contract.ts`, `ipc.ts` and the preload.

Renderer: `src/app/app.tsx` names the profile in the title strip and the window
title, and shows a notice when a launch selection was not followed; the strip
style lives in `src/index.css`.

## Out of scope

- An in-app profile picker or relaunch, and discovering profiles by scanning
  the home directory for `.claude*` folders (guessing, ADR-0006).
- `CLAUDE_CONFIG_DIR` set in a settings `env` block, in managed settings or in
  an editor extension's environment setting.
- The legacy `.config.json` registry.
- Copying, moving or merging history between data roots.
- A `KONDO_DATA_ROOT` inside a Claude store (entry 115).
- Resolving directory aliases when keying data roots: two spellings of one
  directory through a junction or link get two data roots.
- macOS and Linux verification.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The registry follows Claude Code: `<chosen directory>/.claude.json` for `CLAUDE_CONFIG_DIR` and `--claude-config-dir`; `~/.claude.json` beside the default store; a `KONDO_STORE_ROOT` fixture keeps its sibling registry. | The 2.1.271 binary resolves the registry from `CLAUDE_CONFIG_DIR` or the home directory. Tests and the run-kondo fixture rely on the sibling layout. |
| 2 | Precedence, highest first: `KONDO_STORE_ROOT`, then `--claude-config-dir=<absolute path>`, then an inherited `CLAUDE_CONFIG_DIR`, then `~/.claude`. `KONDO_DESKTOP_STORE_ROOT` and `KONDO_DATA_ROOT` keep overriding their own roots. | Fixture overrides must never be displaced by a developer's shell. An explicit launch choice beats an inherited one. |
| 3 | Only an absolute value is followed; an empty value counts as unset. A displaced or non-absolute selection is listed with its reason, never dropped silently. | A relative directory depends on the working directory, which a desktop launch does not share with the shell (ADR-0005). |
| 4 | A desktop launch chooses a profile with the `--claude-config-dir` launch argument on its shortcut or launcher. No picker in this slice. | Works without the terminal environment on every OS, takes no input from the renderer, needs no dialog or relaunch. A native picker cannot be driven by the fixture harness. |
| 5 | Kondo's data root is `KONDO_DATA_ROOT` when set; Electron's `userData` for the default store set; otherwise `<userData>/profiles/<key>`, where the key hashes the user root, registry and desktop root. It is chosen before the single-instance lock and never changes. | Journal steps name stores, not roots, so a journal must stay with one store set. One lock per profile lets two profiles run side by side. Existing history stays where it is. |
| 6 | A data root records the store set it serves in `stores.json` on first use. A launch with another store set is refused before the workspace exists. | Derivation cannot stop an explicit `KONDO_DATA_ROOT` being reused for a second profile; the record can. |
| 7 | No silent profile migration: Kondo copies, moves and merges nothing between profiles or data roots, and writes to no profile. | History belongs to the store it changed. |
| 8 | The seam gains `profileGet()`, returning the source, the tildified root and one sentence per ignored selection. It takes no argument and no path. | Main owns the selection (ADR-0008); display-safe descriptors only. |
| 9 | The title strip names the profile on every screen; a notice band appears only when a selection was not followed; the window title names the profile too. | Visible at every window size and destination without moving the layout; two profile windows stay distinguishable. |
| 10 | Windows is the verified platform; macOS and Linux profile launches are documented as untested. | The entry's constraint. |

## Seam changes

`shared/contract.ts` adds `ClaudeProfileSource` (`fixture`, `argument`,
`environment`, `default`), `ClaudeProfile` (`source`, `root` as a display path,
`ignored` as sentences) and `KondoApi.profileGet(): Promise<Scan<ClaudeProfile>>`
on channel `kondo:profile-get`. ADR-0004 records the seam addition and the data
root per profile; ADR-0003 records the precedence.

## Tests

`test/locator.test.ts`:

- Written first and green on the unmodified code: with the three `KONDO_*`
  overrides, an inherited `CLAUDE_CONFIG_DIR` and a `--claude-config-dir`
  argument change none of the user, desktop and data roots, `userConfigFile` or
  `userConfigRoot`. Breaking the precedence turns it red.
- Red before the fix: with only `CLAUDE_CONFIG_DIR`, the user root is that
  directory, the registry is `.claude.json` inside it, the desktop root is
  unchanged and the source is `environment`.
- The argument beats the environment, the fixture beats both, and each
  displaced selection is listed; relative values are ignored and listed; empty
  values are unset; Windows and POSIX absoluteness follow the injected platform.
- Data roots: an explicit override wins, the default store set keeps Electron's
  directory, any other set gets a stable `profiles/<key>` directory that differs
  per profile, ignores case on Windows and changes with a desktop override.

`test/workspace.test.ts`:

- An injected profile whose `.claude.json` sits inside it, with a decoy registry
  one level up: projects come from the inside registry, and `profileGet` reports
  `environment` with the tildified root.
- Fixture overrides with an inherited `CLAUDE_CONFIG_DIR`: projects come from
  the fixture's sibling registry, and `profileGet` reports `fixture` and names
  the ignored variable.
- `claimDataRoot`: the first claim writes `stores.json`, the same store set
  passes, another store set and a damaged record are refused and leave the file
  unchanged.

`test/safety.test.ts`, running the real entry module with mocked Electron:

- With `CLAUDE_CONFIG_DIR` and no data override, `userData` becomes the derived
  root before the lock; with `KONDO_DATA_ROOT` as well, the explicit root wins.
- A refused claim shows an error box and quits without a workspace, IPC or
  window.

Built app, through `.claude/skills/run-kondo/` against synthetic stores, with
screenshots kept: fixture overrides plus an inherited `CLAUDE_CONFIG_DIR` show
the fixture root and the notice; `CLAUDE_CONFIG_DIR` alone, with the desktop
store and Electron profile kept in the fixture, names the profile; the launch
argument with an inherited `CLAUDE_CONFIG_DIR` names the argument's profile.

## Done when

The title strip tells a user which Claude profile Kondo reads and how it was
chosen. Started with `CLAUDE_CONFIG_DIR` or `--claude-config-dir`, Kondo reads
the profile Claude Code uses, registry included, while its own fixture
overrides still win. Each profile keeps its own history and trash, and a data
folder that already served another profile refuses to open.
