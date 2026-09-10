# Plan: Conservative hook script cleanup

Status: **done — owner accepted 2026-09-09**

The A8 fixture names `~/.claude/hooks/live.js` through `$HOME`. The current
recognizer cannot resolve that command, but cleanup treats the missing reference
as proof that the script is unused. Even perfectly parsed settings cannot prove
absence across sources Kondo does not inventory (decision 109).

## Scope

Keep positive script-reference diagnostics separate from evidence of disuse.
Retain every user hook script because coverage is partial, with an
explicit blocked reason in the existing preview contract. Preserve readable hook
rows and itemized errors. Neither malformed settings nor an empty hooks object
establish global absence. Ordinary cache cleanup and Undo remain available.

## Decisions

| Decision | Reason |
|---|---|
| Withhold the entire script category | Settings layers omit execution sources and scripts can invoke helpers; subtracting recognized paths cannot certify disuse. |
| Preserve existing script diagnostics | Cleanup safety does not require a larger tokenizer: variables, quoting, compound commands, multiple scripts and unrecognized syntax all remain excluded from cleanup. No shell is executed and no environment is expanded. |
| Keep the category identifier, counts at zero and a blocked explanation | Existing callers and the renderer already support category refusal; no new IPC or UI layout is necessary. |

## Boundaries

Read only user settings and verified projects' existing `.claude` layers. A
reported script path never authorizes reading script contents or probing outside
ADR-0002. Do not enumerate plugin, managed or arbitrary project sources to claim
completeness. Do not change hook declarations or the 098 settings/Undo suspension.

## Verification

Reproduce A8 before the fix. Fixtures cover variables, quoting/spaces, compound
commands, multiple scripts, malformed/missing/unsupported settings, unreadable
layers, no recognized script and empty hooks. Assert blocked preview, refused
direct/mixed selection, unchanged bytes/history, and permitted cache trash/Undo.
Run the full suite with two workers, strict typecheck, lint, staged guards, build,
whitespace validation, and the fixture Electron smoke with an exclusive turn.
Native Windows results do not establish macOS/Linux runtime behavior.

## Implementation and evidence

The implementation removes the cleanup-only reference set and candidate walk.
`scanTidyCandidates` always returns an empty hook category with a blocked reason;
the existing workspace gate refuses a direct or mixed selection before writes.
Hook listing, the first-token recognizer and its existing diagnostics remain
unchanged. Cleanup no longer reads settings to infer script disuse.

- A8 fixture against the original adapter: failed with one offered live script
  where zero was required. The regression passes with the correction.
- Hook/tidy suites: 102 passing tests, including 25 conservative-cleanup cases.
- Full Windows suite: 700 passed, 14 skipped because fixture symlink creation
  returned EPERM; no timeouts or assertions were relaxed.
- Strict typecheck, lint, production build and staged documentation guards pass.
  Build required execution outside the sandbox because esbuild could not read
  the worktree's parent directory. Whitespace validation passes.
- The existing hook fixture triggered Jig's real-store guard across multiple
  lines of synthetic settings data. Preparing those settings as a value before
  `writeFileTree` preserved the exact commands and passed without changing guards.
- Full Electron fixture smoke: 26 passed, no skips. A focused repeat of the new
  hook case passed after adding viewport framing for its screenshots. Both
  1360×860 and 900×600 show the disabled category and reason, preserve keyboard
  navigation, refuse mixed selection and preserve fixture bytes and history.
  The smoke's renderer error and network monitors pass; Electron was closed.

Acceptance and main integration belong to the coordinating session and owner.

## Owner acceptance

The owner accepted this implementation and authorized local main integration on
2026-09-09. The combined reviewed source at8bac2b6 passed713 tests with14 existing
Windows file-symlink skips,26/26 Electron tests, typecheck, lint, staged guards and
build. This local acceptance does not establish final release approval.
