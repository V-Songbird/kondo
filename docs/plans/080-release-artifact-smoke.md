# Plan: Smoke the release artifacts

Status: **in progress**

Implementation complete; awaiting acceptance. Local Windows verification is
recorded below; hosted release CI has not been run.

The release workflow currently tests unpacked Windows/Linux executables and
uploads the macOS DMG without a packaged smoke. Gate each upload on the same
fixture smoke against the installed Windows executable, Linux AppImage, or
macOS app bundle produced by that build.

## Scope

- Resolve exactly one NSIS installer, install silently to a unique runner temp
  directory, check the installer exit code and installed executable, then smoke.
- Resolve exactly one AppImage and run it with `--appimage-extract-and-run`
  under xvfb. Add narrowly scoped harness argument/teardown support as needed.
- Resolve exactly one `release/mac*/Kondo.app/Contents/MacOS/Kondo` executable
  and smoke it before uploading the DMG.
- Align testing tier 5 and release instructions with these gates and limits.

## Out of scope

Publishing, tags, signing, Gatekeeper, DMG mounting/installation, fonts, store
adapters, and UI changes. Never install over a developer's existing Kondo.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Require one artifact/executable match and successful smoke before upload | Missing or ambiguous build output must fail the release leg |
| 2 | Keep NSIS `/D=` last and unquoted in the native command line | NSIS treats the remaining command line as its destination, including spaces |
| 3 | Use AppImage extract-and-run | Exercises the distributed artifact without depending on runner FUSE support |
| 4 | Describe macOS coverage as app-bundle smoke | Launching the built executable does not exercise DMG installation or Gatekeeper |
| 5 | Preserve all fixture root overrides on every launch and restart | No smoke test may read or mutate real Claude stores |

## Seam changes

None. Changes are limited to release orchestration, the E2E launcher if needed,
its targeted regression coverage, and documentation.

## Verification checklist

- [x] `npm test`: 432 passed; five existing Windows file-symlink skips.
- [x] `npm run typecheck`: strict TypeScript checks pass.
- [x] `npm run lint`: lint passes.
- [x] `npm run package`: local Windows package builds with `--publish never`.
- [x] `npm run test:e2e`: all 17 checks passed against the installed Windows
  executable after checking installer scope.
- [x] `git diff --check`: clean whitespace and reviewed release failure gates.

Targeted launcher checks must cover AppImage argument forwarding and shutdown
without launching a real store. Inspect workflow syntax and ensure all OS smoke
steps precede upload. Linux and macOS execution require their respective runners;
local checks cannot establish those platform results.

## Observed verification

On Windows, `npm test` passed 432 tests (including 11 launcher regressions),
with five existing file-symlink cases skipped because symlink creation returned
EPERM. Typecheck, lint, packaging with `--publish never`, Jig guards and their
selftests passed. The generated NSIS artifact installed with exit 0 into a
unique temporary destination containing spaces; its executable and registration
were verified before all 17 fixture smoke checks passed, including restart.
The temporary installation, registration, shortcuts and newly created updater
cache were removed afterward. No existing installation or live store was used.

The release YAML and embedded Bash/PowerShell scripts parsed successfully.
Structural checks confirmed that all three smoke steps precede upload and the
aggregate `publish` dependency remains unchanged. Hosted Windows CI, Linux
AppImage execution, and macOS app-bundle execution have not run in this task;
a workflow rehearsal remains the cross-platform verification step.

## Done when

Every release matrix leg requires fixture smoke of its stated artifact before
upload, the existing aggregate publication gate remains intact, and the docs
state exactly what ran and what the macOS smoke does not establish.
