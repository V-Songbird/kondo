# Plan: single-instance startup and window security

Status: **done — accepted by the user**

Task 084 prevents two launches from owning the same Kondo journal and trash.
At task start the main window was hardened, but startup had no single-instance
lock and the splash had no explicit navigation guards.

## Scope

Acquire Electron's lock before readiness or workspace creation, quit on refusal,
and restore/focus the original window on another launch. Preserve startup's
splash handover and macOS window reopening without recreating the workspace.
Pin isolation, sandboxing, navigation denial and both existing CSP policies.
Apply the same window security rules to the splash.

## Decisions

| Decision | Rationale |
|---|---|
| Set Electron userData to the resolved KONDO_DATA_ROOT override before locking | Two profiles must not bypass exclusion for the same journal/trash; fixture runs must not contact a live app |
| Queue focus until the main window is shown | Another launch may arrive during readiness, preference loading or splash handover |
| Reopen a closed window with the existing workspace | macOS keeps the primary process alive after all windows close |
| Exercise the real entry module with mocked Electron | String matches alone cannot prove refusal prevents startup or handlers enforce security |

## Seam changes and exclusions

No typed bridge, store adapter, renderer, network or release changes. This is
per-data-root application exclusion, not cross-user or distributed locking.

## Verification checklist

- [x] `npm test -- test/safety.test.ts`: structural rules and actual entry-module
  behavior pin both windows, CSP modes, lock refusal, startup races and focus.
- [x] `npm test`: all fixture-only regressions pass (445 passed; five existing
  Windows symlink cases skipped with EPERM).
- [x] `npm run typecheck`: strict TypeScript passes.
- [x] `npm run lint`: lint passes without warnings.
- [x] `npm run build`: build succeeds. The standalone Electron regression
  verifies exclusion, secondary exit, native restoration and native/renderer
  focus on Windows with disposable synthetic stores (two tests passed).
- [x] `git diff --check`: ran; the only failure is pre-existing trailing
  whitespace in AGENTS.md:9. The task-owned diff passes; the user's edit stays
  untouched. Documentation reviewed with the implementation.

## Observed verification and limits

The safety suite has 17 passing tests across structural and mocked entry-module
checks. Ten deliberately weakened variants were rejected: main isolation, Node
integration, sandboxing, splash isolation, window-open denial, navigation denial,
both CSP strings, bypassed locking and startup after lock refusal. Source was
restored after the probes. A review found that visibility alone could mistake
a window hidden after startup for an unfinished window; readiness is now explicit
and that hidden-window case has a regression.

The built-app test uses an inspector fallback because this Electron version
omits `Browser.getWindowForTarget`. The final Windows run uses different Chromium
profile flags with the same data root and verifies one surviving primary page.
macOS/Linux native behavior and packaged binaries were not exercised in this
task; lifecycle branches and packaged CSP are covered with mocks. No real stores
were used. The existing AGENTS.md edit made the initial checkout dirty, so the
implementation was left uncommitted for acceptance. The user subsequently
accepted task 084 and authorized committing it, merging to main and deleting
the working branch; AGENTS.md remains outside the task commit.

The user accepted the implementation after the recorded validation.
