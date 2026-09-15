# Plan: sandboxed preload startup failure under load

Status: **in progress**

The Electron smoke on hosted Windows sometimes fails its renderer health check
while the app starts. Electron's sandboxed renderer logs
`Electron sandboxed_renderer.bundle.js script failed to run` and
`TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null.`
The collector retains that evidence, so one bad launch fails every later test
and the `after` hook. A local Windows run under bounded CPU load reproduced it
in 2 of 2 runs (plan 130). This plan finds whether Electron, the smoke harness
or kondo's startup causes it.

## Evidence so far

| Source | Commit | Electron | Failing launch |
|---|---|---|---|
| Hosted Windows, PR #8 (coordinator record) | `a0a524b` | 44.0.0 | tests 17 and 18 |
| Hosted Windows, PR #10, run 34962747263, attempt 1 | `335c21c` | 44.0.0 | relaunch in test 26 |
| Hosted Windows, PR #12, run 34965192570, attempt 1 | `5c6b099` | 44.3.0 | relaunch in test 18; 19–26 and `after` fail on the retained evidence |
| Hosted Windows, `main`, run 34966874681, attempt 1 | `33718b7` | 44.3.0 | relaunch in test 18; 19–26 and `after` fail on the retained evidence |
| Hosted Windows, `main`, run 34967772492 | `bada8df` | 44.3.0 | first launch; every test and `after` fail |
| Local Windows, 16 busy Node processes | `884dc59` | 44.0.0 | first launch, 2 of 2 runs |

- Every logged failure was thrown inside `launch()` in `test/e2e/smoke.mjs`:
  the message carries the child's launch output. The monitored reload had
  already become ready, with `window.kondo` present, before the health
  assertion ran.
- In the `bada8df` run and the local runs the errors belong to execution
  context 2 of the page. That suggests the first document rather than the
  reload; experiment 1 must confirm it.
- The failure appears with vitest 3.2.7 and 5.x.
- The same two messages are reported for another Electron app on Windows,
  in the same second a new web view opens
  (anthropics/claude-code#86577).

## What Electron does

Read from the Electron source at `v44.3.0` and `main`, not yet observed at
runtime:

- Since electron/electron#51602 (merged 2026-05-19 and released in the 42, 43
  and 44 lines), the browser pushes a sandboxed frame's preload scripts and
  process data over `mojom.ElectronFrameStartup` from
  `WebContents::ReadyToCommitNavigation`, instead of the renderer asking with
  a synchronous IPC.
- `MaybeSendRendererStartupData` returns without pushing when the
  `RenderFrameHost` is not live.
- The renderer stores the push in `ElectronApiServiceImpl`, one per
  RenderFrame, and the sandbox bundle reads it at `DidCreateScriptContext`.
  Without it, `startupData` is null and the bundle throws before kondo's
  preload runs, so `window.kondo` never exists in that document.
- Electron's comments say the push always lands before `CommitNavigation`.
  The observed error shows that at least one document ran without it.
- electron/electron#53860 (on `main`, merged into 44-x-y and 45-x-y) adds a
  push at frame creation, but only for renderers that are not sandboxed.
  kondo's sandboxed windows still depend on the push before navigation.

## Hypotheses

1. **Electron:** under contention, the first document of a new sandboxed frame
   can run the sandbox bundle without the startup push. A later navigation in
   the same frame reuses the stored data, which would explain why the reload
   recovers.
2. **Harness:** attaching CDP, enabling its domains or sending `Page.reload`
   during the first navigation, or relaunching right after the previous
   instance exits, creates the condition.
3. **Application:** creating the splash and the main window together, or
   another startup step in `electron/main/index.ts`, creates or widens it.

## Experiments

Synthetic fixtures only. Load is one busy Node process per logical processor,
stopped by process id. Electron runs in the serialized slot and stops through
`Browser.close` or the app's own `app.quit()`. Diagnostics stay in a temporary
copy outside the repository.

1. **Instrumented smoke launches**, with and without load. Per launch: Electron
   version, first launch or relaunch, and the times of the previous exit, the
   spawn, the DevTools endpoint, CDP attach and reload. Also the console error
   timestamps and execution contexts, the document URL and `typeof window.kondo`
   before the reload, and whether the reload recovers.
2. **Late attach**: launch kondo under load and attach CDP only after startup
   has settled, then read the replayed console and `window.kondo`. Failures
   here rule out the harness's early attach and reload as the trigger.
3. **Minimal Electron app** on the same Electron version, with no kondo code
   and no debugging port. It opens a sandboxed window with a preload, with and
   without a second window created at the same moment, under load. The main
   process detects failures through `console-message` and the preload's
   global.
4. If a kondo-side trigger appears, test the smallest change under the same
   conditions.

## Out of scope

- Relaxing or skipping the renderer health assertion, retrying a launch to
  hide the error, sleeps or larger timeouts.
- Attributing a retained violation to the test that produced it, unless later
  checks would still fail on any new violation.
- Patching Electron or reporting upstream; the owner decides.

## Seam changes

None expected.

## Done when

Either a kondo-side root cause is fixed and repeated `npm run test:e2e` runs
pass with and without load, or the Electron cause is documented with a minimal
reproduction and the affected versions for the owner to decide on.
