# Plan: Evidence-based platform and installation guidance

Status: **in progress** — implementation verified; awaiting owner acceptance.

Align the README, generated release notes and release procedure with recorded
platform evidence, and make the intended package architectures independent of
the build host.

## Scope

- Declare arm64 DMG, x64 NSIS and x64 AppImage targets in `package.json`.
- Use the same coverage statement in all three release documentation surfaces.
- Document per-app macOS opening steps and distribution-specific FUSE packages.
- Update the changelog and obsolete factual descriptions in ADR-0011.

## Decisions and evidence

- Preserve artifact naming, unsigned settings and task 080's smoke gates.
- Recorded Windows UI validation is in `2026-09-06-ux-workflow.md`; installed
  NSIS validation (17 fixture smoke checks) is in `080-release-artifact-smoke.md`.
- The release workflow configures all three packaged smoke gates. Its GitHub
  runs endpoint returned 404 during this task; no successful hosted release
  execution is established. macOS/Linux manual validation is not recorded.
- DMG installation/Gatekeeper and Linux FUSE mounting are outside the smoke
  coverage. State these limits without treating configured jobs as passed tests.
- Missing `arch` previously used the build host architecture, not always arm64;
  the original task's explanation of Intel Mac builds was inaccurate.
- Follow primary-source installation guidance, with quarantine removal scoped
  to the trusted `/Applications/Kondo.app` bundle only.

## Seam changes and exclusions

None. No application code, store access, installer execution, system quarantine
changes, publishing, tags, pushes or merges are needed.

## Acceptance checklist

Complete the required checks in this order:

- [x] `npm test`: 432 passed; five existing Windows file-symlink EPERM skips.
- [x] `npm run typecheck`: strict TypeScript passes.
- [x] `npm run lint`: lint passes.
- [x] `git diff --check`: no whitespace errors; reviewed identical support text,
  architectures, artifact names, installation commands and preserved smoke gates.

Also validate the builder configuration with the installed schema and target
resolver, parse the release YAML and Bash notes script, and inspect generated
notes without publishing. These checks do not establish package execution.

## Observed verification

- The installed electron-builder 26 schema accepted the configuration; its CLI
  normalization and target resolver selected exactly x64 NSIS, arm64 DMG and
  x64 AppImage. Its filename expansion resolved `Kondo Setup 0.5.0.exe`,
  `Kondo-0.5.0-arm64.dmg` and `Kondo-0.5.0.AppImage` without changing defaults.
- YAML parsing and comparison against the task baseline established that the
  entire package job and all release settings outside the notes script are
  unchanged. Bash syntax validation passed. Executing only the notes script
  against a synthetic changelog preserved the release entry, excluded the
  older entry, and emitted the identical coverage statement and literal quoted
  quarantine command. Missing and empty version sections both failed as required.
- The fixture suite passed 432 tests across 36 files; five existing file-link
  cases skipped with EPERM on Windows. Typecheck and lint passed. The final
  diff, including all task checkpoints, passed whitespace and consistency review.
- No package build or OS installation was executed in this documentation task.
  No successful hosted release execution was established. The existing Windows
  evidence above is recorded prior work; macOS/Linux execution, DMG/Gatekeeper,
  and FUSE mounting are not new verification claims.

## Primary sources checked

- [electron-builder v26 CLI](https://www.electron.build/v26/docs/cli/): target
  objects accept an architecture list; absent configuration defaults to the host.
- [Apple opening instructions](https://support.apple.com/en-us/102445): the
  per-app Privacy & Security override. The optional quarantine fallback is
  supported by [Apple's xattr manual](https://github.com/apple-oss-distributions/file_cmds/blob/main/xattr/xattr.1)
  for command semantics; it is not presented as Apple's recommended fix.
- [AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html),
  [Ubuntu 22.04 libfuse2](https://packages.ubuntu.com/jammy/libfuse2) and
  [Ubuntu 24.04 libfuse2t64](https://packages.ubuntu.com/noble/libfuse2t64): use
  the distribution's FUSE 2 compatibility library when mounting requires it.

## Done when

All three documentation surfaces agree on evidence and architectures, the
existing package defaults select the intended architectures explicitly, and
installation guidance is accurate and scoped. Implementation awaits acceptance.
