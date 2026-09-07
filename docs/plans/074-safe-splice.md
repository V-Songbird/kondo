# Plan: durable and confined splice replacement

Status: **in progress**

Implementation verified on Windows; awaiting user acceptance.

Task 074 fixes temporary-file leaks, missing sync, and replacement of a
settings symlink with a plain file. Mutation targets also need physical path
checks before any content read or write.

## Scope

Keep changes in the main-process mutation engine and path helpers, with
fixture regressions in the mutation and boundary suites. Update domain facts,
the changelog, and the security decision in ADR-0010. No seam changes.

## Decisions

| Decision | Reason |
|---|---|
| Resolve existing paths and the nearest existing ancestor of missing paths | Preserve creation of new layers without allowing parent-link escapes |
| Keep move/trash paths lexical after validation; dereference splice targets | Moving a link and editing its contents have different semantics |
| Require registry targets to remain the one named file under the resolved parent | The home directory is not an allowed store |
| Open temporary siblings exclusively, write, sync, close, then rename | Never publish incomplete temporary contents or replace a pre-existing temporary file |
| Attempt handle closure and temporary removal on failures; keep the original error | Cleanup failure must not conceal the failed write |

## Out of scope and limits

No scanner-wide symlink redesign, recursive copy hardening, new IPC, directory
fsync, or claim of protection against concurrent malicious path swaps. A
process crash can leave a temporary file; handled failures attempt cleanup.
File sync ordering is testable here; power-loss durability and other platforms
require separate evidence.

## Verification checklist

- [x] `npm test -- test/mutation.test.ts test/boundary.test.ts`: 54 passed,
  5 skipped (Windows file symlink creation returned EPERM). Partial-write
  cleanup, sync/close ordering, failure handling, link identity and undo,
  file/parent escapes and missing destinations using temporary fixtures.
- [x] `npm test`: 421 passed, the same 5 file-symlink cases skipped; all 35
  test files passed. Directory-junction cases ran successfully.
- [x] `npm run typecheck`: strict TypeScript passed.
- [x] `npm run lint`: passed without warnings.
- [x] `git diff --check`: owned changes reviewed; no whitespace errors.

## Done when

Splices preserve supported in-store links, sync new contents before publishing
them, clean temporary files on handled failures, and refuse resolved escapes.
Implementation remains subject to the user's final acceptance.

## Observed result

Partial writes, sync/close/rename failures, exclusive-open collisions and
cleanup failure were exercised against temporary files. Directory-junction
splice/undo, existing and missing escape targets, dangling parents, and undo
refusals passed. Dangling-path undo reports a resolution error instead of
incorrectly claiming its trash was emptied.

Five direct file-symlink cases could not run because fixture creation returned
EPERM: preservation through splice/undo, external target refusal, dangling
target refusal, registry sibling refusal, and the project MCP boundary. Run
these on a host permitted to create file symlinks before claiming that coverage.
No real stores were used. File sync ordering is verified; power-loss recovery,
parent-directory durability, concurrent path swaps, and other operating
systems were not tested.
