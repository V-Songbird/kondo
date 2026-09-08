# Plan: Preserve concurrent settings writes

Status: **awaiting acceptance**

Task 098 addresses an external write after splice digest validation but before
temporary-file publication, in both apply and Undo. All evidence uses synthetic
stores from `test/helpers.ts`.

## Scope

Reproduce A2 at the filesystem publication seam before replacing that policy.
Preserve atomic old/new visibility and the displaced file, or refuse when the
available filesystem operation cannot provide that guarantee. Keep errors
itemized, preserve journal recovery, and serialize overlapping Kondo work.
Update ADR-0010, domain facts, testing guidance and the changelog.

## Decisions

- A second digest check cannot make an unconditional rename safe.
- A copied snapshot or an earlier hard link cannot preserve an external atomic
  replacement that arrives after capture; neither is sufficient by itself.
- The owner approved an interim refusal policy on 2026-09-08: any plan or
  historical Undo containing write/splice steps refuses before effects or
  journaling on every platform. No process-id check or advisory lock bypass.
- No renderer filesystem access or new public bridge parameters.

## Evidence and acceptance checklist

- [x] `npm test`: fixture apply/Undo interleavings, overlapping operations,
  partial failures, recovery and retry; existing safety invariants still pass.
- [x] `npm run typecheck`: strict main-process and renderer types pass.
- [x] `npm run lint`: passes after the preceding checks.
- [x] `git diff --check`: no whitespace errors after the preceding checks.

Also run the repository guards required by CONTRIBUTING.md. Final acceptance
remains separate from implementation and automated verification.

## Investigation evidence

Baseline: `c1612759a4a4fa931535c154c7380db9e2f2a99b`, clean checkout;
working branch: `foreman/preserve-concurrent-settings-writes`.

`npx vitest run test/mutation.test.ts -t 'publication boundary'` reproduced
A2 on Windows in both apply and Undo: both new regression cases failed because
an injected external write immediately before `fs.rename` was reported as a
successful settings edit. That run preceded the production restriction.
The regression suite now verifies that neither direction reaches publication.

Node's [rename API](https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback)
overwrites an existing destination and exposes no exchange operation.
[Windows ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
documents a partial failure that can leave the replaced file under its backup
name and the replacement under its temporary name. It does not establish the
required continuous old/new visibility on failure. Linux atomic exchange is a
possible native backend, with filesystem support and retention still to verify.
The owner was asked whether to expand to native preservation with refusals where
unsupported, or use an interim refusal policy. In particular, Windows settings
writes may remain unavailable under either policy until a safe backend is proven.

The existing `undoLinks` function treats failed undo records as completed links.
That behavior is already described by audit A1; it must be accounted for when
implementing retry semantics without silently taking over the separate Undo task.
## Implemented and verified

The owner approved temporary refusal on 2026-09-08. `createMutations` rejects
whole plans containing `write` or `splice` before step preparation and journal
append. It rechecks requested and prepared steps after asynchronous planning
and preflight to prevent an internal caller appending prohibited steps during
those awaits. Historical settings Undo refuses before filesystem effects or a
new journal entry; inverse edits, saved bytes and previous status are retained.
The existing workspace methods inherit this centralized gate without seam or
renderer code changes. Existing action alerts display the refusal.

The forecast expanded to integration fixtures and the current public claims in
README, SECURITY, ROADMAP, ADR-0006, domain, foundations, testing, and CHANGELOG.
No native backend or bypass was added. The old replacement implementation
remains unreachable through the gated mutation/Undo API; restoring it requires
new native concurrency evidence and successful per-feature coverage.

Evidence on Windows:

- `npm test -- --reporter=dot`: 614 passed, 14 platform-dependent skips,
  40 test files passed. Includes queued external in-place/atomic writes,
  an external replacement during historical Undo reads, historical complete,
  not-run and partial entries, missing targets, mixed plans, malformed history,
  repeated refusal and mutable-plan preflight cases.
- `npm run typecheck`, `npm run lint`, `git diff --check`: passed.
- `npm run build`: passed.
- `npm run test:e2e`: 22 passed with zero skips. Two keyboard-triggered settings
  attempts show the focused alert, retain unchanged fixture/settings/journal
  bytes, and create no success/Undo banner. Other file operations and Undo,
  renderer recovery and appearance checks remain green.

These results establish the enforced refusal and retained existing operations
on the tested host, not a safe native settings backend or cross-platform
execution of the skipped link cases. Final user acceptance remains outstanding.