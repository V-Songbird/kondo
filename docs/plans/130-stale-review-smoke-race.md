# Plan: stale-cache review smoke race

Status: **done — accepted 2026-09-15**

Electron smoke test 20, "cleanup refuses a cache that appeared after review,
then a fresh choice applies and undoes", failed only on hosted Windows. The
smoke gates `ci.yml` and every release artifact upload, so on 2026-09-15 the
owner asked for a fix instead of more evidence under entry 120.

## Hosted evidence

| CI run | Commit | Windows smoke | Test 20 |
|---|---|---|---|
| 34959802084, attempt 1 | `667e9aa` | failed, 25 of 26, 60.1 s | timed out after 15.94 s |
| 34959802084, attempt 2 | `667e9aa` | passed, 26 of 26, 41.3 s | passed in 2.16 s |
| 34962607773, attempt 1 | `884dc59` | failed, 25 of 26, 58.4 s | timed out after 15.88 s |
| 34964933145, attempt 1 | `0808dab` | failed, 25 of 26, 57.2 s | timed out after 15.92 s |

On `884dc59`, Ubuntu and macOS smoke passed test 20 in 2.12 s and 1.94 s.
Every failure stopped in the second `selectAndReview` call, just after the
stale-review refusal, waiting for `document.activeElement` to be Cancel (last
value `false`). The wait itself takes 15 s, so everything before it took under
a second. The failing Windows runs were also slower across the whole suite
(57–60 s) than the passing attempt (41 s).

## Diagnosis

1. On `stale-plan`, `sweep` in `src/features/tidy/tidy.tsx` shows the refusal,
   clears the selection and calls `reload()`.
2. `useScan` keeps the previous scan while a same-subject reload runs with
   `loading` set, so `AsyncView` keeps the table on screen and shows
   "Refreshing…".
3. The category checkbox does not depend on `state.loading`; Review selected
   items does, and stays disabled until the refreshed preview returns. That is
   intended: the refused sweep consumed the previous review token (ADR-0015),
   so a review built on the old preview would only be refused again.
4. The smoke's renewed selection checked the box as soon as the checkbox was
   enabled and called `keyboardActivate(review)`, which waits only for the
   button to exist. While the preview was still reloading, `focus()` on the
   disabled button left focus on the checkbox, Enter did nothing there and no
   confirmation opened. The Cancel wait then timed out.

Test 12 already waits for `!review.disabled` before it activates Review; test
20 did not.

## Fix

`selectAndReview` in test 20 waits until Review selected items is enabled
before keyboard activation. No assertion, timeout or application behavior
changed.

## Local evidence

A temporary copy of the smoke, kept outside the repository, recorded the page
state between `focus()` and Enter: whether Review was disabled, whether the
table showed "Refreshing…", the focused element, and whether the confirmation
opened. A mutation observer timed the stale alert and the refresh. To model a
slower host deterministically, the copy attached to the main process's
inspector and delayed only the `kondo:tidy-preview` reply by 1.5 s through
Electron's internal invoke-handler map. Renderer, bridge and fixtures were
unchanged.

| Condition | Runs | Result |
|---|---|---|
| `main`, preview delayed 1.5 s, test 20 only | 2 | Both failed with the hosted error. At activation, 265–267 ms after the alert, Review was disabled, the table showed "Refreshing…" and focus stayed on the checkbox; Enter opened no confirmation. The refresh ended about 1.63 s after the alert. |
| Fix, preview delayed 1.5 s, test 20 only | 2 | Both passed. The refresh ended 1.58–1.62 s after the alert; activation waited until 1.60–1.73 s and opened the confirmation with focus on Cancel. |
| `main`, no delay, full smoke | 2 | Both passed 26 of 26. The refresh ended 76–118 ms after the alert and the renewed activation came 196–212 ms after it, a local margin of 78–133 ms. |
| `main`, bounded CPU load, full smoke | 2 | Not usable for test 20. Both launches failed the renderer health check before any test ran: Electron's sandboxed preload reported `Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null`. |
| Fix, `npm run test:e2e` | 5 consecutive | All passed 26 of 26, in 26.9–28.5 s each. |
| Fix, preview delayed 1.5 s, full smoke | 1 | Passed 26 of 26. The refresh ended 1.58–1.62 s after the alert; both renewed activations came after it and opened the confirmation with focus on Cancel. |

The bounded load was one busy Node process per logical processor (16), stopped
by process id after each run. Local runs used the Electron version locked at
`884dc59` (44.0.0).

## Remaining uncertainty

- Hosted preview timing was not measured. The 1.5 s delay models a slow
  preview reply; it does not show how long the hosted preview took.
- The hosted failures match this mechanism in error, stack and timing, but
  only a hosted Windows run with the fix can show that the failure is gone
  there.
- The sandboxed preload failure under CPU load is a separate startup failure.
  It was not investigated under this entry.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Fix the smoke, not the application | Review stays disabled during the refresh on purpose; enabling it earlier would offer a consumed token. |
| 2 | Wait at the call site, not inside `keyboardActivate` | Test 12 already uses this form, and the other activations keep their current behavior. |
| 3 | Keep the diagnostic out of the repository | The instrumentation and the preview delay were temporary evidence, not coverage. |

## Seam changes

None.

## Tests

- Test 20 keeps every existing assertion: refusal focus, cleared selection,
  Return to review focus, disabled Review with nothing selected, renewed
  confirmation focus on Cancel, and byte-exact apply/Undo.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run guards` and
  `git diff --check` pass.

## Done when

Test 20 passes on hosted Windows because the renewed review starts only after
the refreshed preview is available, and the owner accepts the evidence.

## Owner acceptance

The owner accepted this result on 2026-09-15, conditional on hosted
validation: the Windows smoke job on the pull request must pass three times.
A sample that fails only with the sandboxed-preload startup error tracked as
entry 132 does not count and is rerun once. The squash commit will record the
runs.
