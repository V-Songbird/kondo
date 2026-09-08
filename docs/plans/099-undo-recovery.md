# Plan: honest Undo results and resumable recovery

Status: **done — accepted by the owner on 2026-09-08**

A fixture that refuses the first restore rename reproduces A1: Undo marks the
original undone despite moving no files, and a new workspace cannot retry.
Forward partial failures also return null and hide the inline recovery action.

## Scope

Keep append-only history and all recovery bytes. Record a versioned execution
intent, a synced pending-action fingerprint before each action, completed-action
checkpoints and an explicit completion. Undo resumes its existing intent and
never repeats confirmed actions. Moving an occupant aside and restoring the
saved tree are separate actions. Only completed Undo links consume an original.

## Decisions

| Decision | Reason |
| --- | --- |
| Reconcile only the pending action against its recorded physical digest and both endpoints | A thrown rename or journal write does not establish whether an effect happened. |
| Skip confirmed actions, including after restart | Later external changes at restored paths must not be displaced again. |
| Preserve and refuse ambiguous endpoints | Both copies after a failed cross-volume removal, changed bytes or damaged checkpoints cannot prove a safe continuation. |
| Keep legacy successful records readable; block legacy failed Undo without action evidence | Old failure markers cannot distinguish a refusal from a partial restoration. |
| Retain 098 for every write/splice and historical mixed Undo | This work does not authorize settings publication. |

## Seam and UI

Add explicit complete/partial/none/uncertain outcomes plus a main-process Undo
availability reason and recovery state to JournalEntryInfo. Keep existing
channels and failed compatibility. Return journaled partial operations alongside
errors. History and LastChange distinguish no effects, partial effects and
uncertainty; null never means success. Keep focus, named native buttons, existing
Signal styles and visible refusals.

## Tests

Synthetic stores only. Cover a no-effect refusal and restart retry; partial
forward feedback; partial Undo and an occupied restore path; interruption before
an action, after its effect and before checkpoint/close; persistence failure;
ambiguous endpoints; corrupt progress and legacy records; unchanged 098 refusal.
The built Electron smoke checks real bridge results, inline and History labels,
keyboard retry/focus and fixture bytes in Chalk/Carbon at both supported sizes.
Run npm test, typecheck, lint, guards (also with owned files staged), build,
test:e2e and git diff --check. Interruption injection is not proof of power-loss
filesystem durability or cross-platform desktop behavior.

## Out of scope

Settings writes, a native transactional filesystem backend, real-store tests,
roadmap mutations, integration, release and final acceptance.

## Done when

A failed Undo cannot claim restoration or consume the original. A safe retry
continues from recorded effects, partial forward changes remain reachable inline,
and the UI explains uncertain recovery without moving unverified bytes.

## Implementation evidence

The no-effect refusal regression failed on the baseline because `undoneBy` was
set. It now passes after recreating the workspace. The implementation records
separate occupant/restore actions, resumes confirmed progress, rejects omitted
Undo actions and confines even historical trash references to their own bucket.
Physical digests use bounded file reads so the existing transcript streaming
invariants still pass. The 098 settings gate remains unchanged.

The Windows fixture suite passes with two workers; 14 file-symlink cases skip
because the host denies their creation. Typecheck, lint and build pass. The
built-app smoke passes all 24 tests, including inline refusal/retry and History
relaunch recovery. Both themes and window sizes were inspected in two bounded
rounds; no horizontal overflow, renderer errors or outgoing requests were found.
The Impeccable detector found no issues. Repository guards are also checked with
this task's files staged before the local commit.

No main integration, publication, roadmap mutation or final acceptance is part
of this executor's work. The coordinator owns those later decisions.

## Owner acceptance

The owner accepted this result and local main integration on 2026-09-08.
The coordinator reviewed both 099 and 100 together at fe91a87: 676 tests passed
with 14 existing Windows file-symlink skips, and Electron smoke passed 25/25.
Typecheck, lint, staged guards, build and whitespace checks passed. This is
local development acceptance; release and publication gates remain separate.
