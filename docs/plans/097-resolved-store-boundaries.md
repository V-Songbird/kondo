# Plan: resolved store boundaries

Status: **done — implementation in 6a65e4f, accepted by the owner**

Task 097 closes link escapes in Claude-store scans and recursive mutations.
The baseline placed-entry reader opened a linked SKILL.md without checking its
resolved destination. All evidence and validation use synthetic temporary stores.

## Scope

Require an explicit owning boundary at filesystem helpers and propagate it through
user, project and desktop adapters, transcript streams, duplicate digests, lock
probes and mutation copy/restore operations. Keep errors itemized and healthy
siblings available. The renderer and typed IPC contract do not change.

## Decisions

| Decision | Reason |
|---|---|
| Validate lexical and resolved containment before I/O, using the owning store root | A child directory or a different allowed store cannot authorize an escaped link |
| Exact-file boundaries for the registry and project MCP exception | These exceptions never grant access to sibling files |
| Follow safe in-store links with ancestor-cycle detection in recursive walks | Useful aliases remain readable; loops terminate with errors |
| Resolve missing destinations through existing ancestors and reject dangling links | Missing files must not turn broken links into writable paths |
| Walk recursive operations explicitly and validate source and destination entries | Checking only the top of a tree misses nested escapes |
| Preserve archived link metadata and validate the future restore tree | Trash must not follow links into live stores, and undo must retain link identity |

Path checks limit stable link traversal; they do not eliminate hostile concurrent
filesystem replacement (TOCTOU). Root selection remains the locator's authority.
The implementation used no real-store access, network or release changes.
The owner subsequently accepted it and authorized integration into local `main`.

## Verification checklist

- [x] `npm test -- test/boundary.test.ts`: 26 passed, 13 explicitly skipped;
  external sentinels never opened through
  links, streams, handles or nested recursion; safe aliases survive; unsupported
  native link setup is reported explicitly.
- [x] `npm test`: 40 files passed, 565 tests passed, 14 explicitly skipped,
  including link, splice and undo regressions.
- [x] `npm run typecheck`: strict main, seam and renderer types pass.
- [x] `npm run lint`: lint passes.
- [x] `git diff --check`: clean whitespace plus review of every changed I/O path
  and matching domain/ADR guarantees.

## Completion

All checks ran on Windows against synthetic roots. The 14 suite skips are native
file-symlink creation refusals (`EPERM`); directory-junction regressions ran.
`test/relocation.test.ts` adds 13 passing cases with no skips, including preserved
link identity through rename and simulated EXDEV, future internal targets,
physical trash sizing/removal, copy corruption, and cleanup failure followed by
an undo refusal that preserves the healthy source. No native cross-volume or
cross-platform run is claimed.

The helper/caller surface expanded to sessions, desktop/tidy adapters, workspace
fingerprints, caches, kind dispatch and the physical relocation helper. The
first full run exposed an old assertion counting an attempted content read of
an absent manifest; resolution now rejects absence before opening, so that test
continues to prove lazy reads while counting the two existing manifests.

Configured-root overlap remains separate from containment within a selected
root. The owner approved tracking its lexical-only checks as Foreman 115;
no overlap fix is included here. No real stores were read or changed, and no
release state was changed. The owner accepted task 097 and authorized its local
integration and working-branch removal.
