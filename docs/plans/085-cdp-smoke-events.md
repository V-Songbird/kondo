# Plan: renderer evidence in the CDP smoke

Status: **done — accepted**

The shared CDP client currently drops unsolicited protocol frames. Retain
renderer exceptions and error console events, and make the fixture smoke fail
on those events or request URLs outside `file:` and `devtools:`.

## Scope and decisions

- Add subscriptions with unsubscribe, retaining request/response correlation
  and rejecting pending commands when the connection closes.
- Install Runtime collectors before enabling the domain. The smoke installs
  its request collector before Network.enable and reloads with monitoring on.
- Keep evidence across renderer reloads and app relaunches. Error console
  output fails; intentional bridge error values do not receive an exemption.
- No production seam changes, store changes, or external negative requests.
  Page CDP does not monitor main-process traffic, other targets, or guarantee
  coverage of initial startup before attachment.
- The first Windows smoke observed the bundled mark as a `data:` image request.
  Preserve the requested scheme policy by adding `?no-inline` to the mark
  imports in `src/app/app.tsx` and `src/features/themes/themes.tsx`; Vite emits
  the same SVG as a local asset. No broader scheme exemption is introduced.
- Add `test/e2e/renderer-health.mjs` and `test/cdp.test.mjs` for reusable smoke
  assertions and deterministic protocol regressions. Update the plan index
  and tier 5 documentation along with the forecast client and smoke files.

## Verification checklist

- [x] `npm test`: unsolicited delivery, early Runtime evidence, command
  correlation/cleanup, and synthetic exception/console/request failures.
- [x] `npm run typecheck`: strict checks pass.
- [x] `npm run lint`: lint passes without warnings.
- [x] `npm run build`: built app ready for isolated smoke.
- [x] `npm run test:e2e`: fixture smoke with monitored reload and relaunch.
- [x] `git diff --check`: ran; task-owned changes pass. The repository-wide
  command flags only pre-existing trailing whitespace at AGENTS.md:9, preserved.

The initial implementation preserved the dirty tree without committing. The
user subsequently accepted the result and authorized committing task-owned
changes, merging into main, and deleting the working branch.

## Observed verification

Windows x64, Node/Vitest and Electron 44: 37 test files passed, 461 tests
passed (16 CDP regressions), and 5 existing symlink cases skipped with EPERM.
All 17 built-app smoke tests passed after emitting the mark as a local SVG;
the initial strict-policy failure supplied the concrete data-URL evidence.
The emitted SVG and source have identical SHA-256 hashes. Typecheck, lint,
and build passed. No installed-artifact, Linux, or macOS run was performed.

The smoke validates all three fixture roots and verifies the debugging browser
endpoint against the fixture child's output before attaching. It removes
inherited dev-renderer and run-as-Node environment overrides. Runtime evidence
and monitored document requests were collected across reload and relaunch,
with no console errors even during intentional bridge error-value checks.
Capture ends at CDP disconnect; initial pre-attachment startup, splash/worker
targets and Electron main-process requests remain outside this page monitor.
