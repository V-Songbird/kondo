# Plan: Session projection and protected-file boundary

Status: **done — implementation verified; awaiting acceptance**

Task 094 removes an unused OS path from the session-project payload and
makes the five read-never filenames explicit regression targets.

## Scope

Keep `ProjectRecord.guessedPath` inside main for project resolution. Remove
it from `SessionProject` and its runtime projection. Add synthetic protected
files to the boundary fixture and check attempted `fs/promises.readFile`
calls across its API sweep, including a controlled failing-read regression.
Update ADR-0008, domain, foundations and testing documentation.

## Decisions

| Decision | Rationale |
|---|---|
| Retain internal paths and existing IDs | Project-store resolution still needs them; no ID migration is needed. |
| Observe calls before their outcome | A failed protected read is still a privacy violation. |
| Keep observation limits explicit | A readFile spy does not cover streams, file handles or synchronous reads. |

## Seam changes

Remove `SessionProject.guessedPath`. No channel or parameter changes; preload
forwards the same methods and the renderer has no consumer of this field.

## Out of scope

New filesystem enforcement mechanisms, UI changes, task 093 acceptance, and
real-store inspection or mutation.

## Acceptance checklist

- [x] `npm test -- test/boundary.test.ts test/workspace.test.ts`: payload omits
  the field, internal resolution works, all five sentinels exist, the sweep
  reads none, and a negative regression detects attempted protected reads.
- [x] `npm test`: full fixture suite passes with restored spies (533 passed;
  five existing file-symlink cases skipped on Windows with EPERM).
- [x] `npm run typecheck`: strict checks pass.
- [x] `npm run lint`: passes.
- [x] `git diff --check`: passes and the final diff agrees with the docs.

## Done when

The session-project payload contains no guessedPath, internal project lookup
still works, and the fixture suite detects readFile attempts against each
protected filename. Record implementation complete awaiting user acceptance.

## What shipped

Removed the field from the contract and projection. Inspection also found
main-side `projectsList`/`projectDetail` callers that consumed the projection's
path; they now build names and temporary-project classifications from the
internal inventory. Existing project-home and tidy tests pass.

The boundary sweep exercises session listing/detail/near-duplicates, project
listing and both detail scopes, store reports, desktop sessions, skills and
duplicates, plugins and plugin skills, hooks, settings, journal, trash size,
appearance reads, tidy/configuration previews, and generic MCP/placed listings.
Workspace tests check both sessionProjects and entityList('project') payloads.
This is direct workspace API coverage, not a live Electron IPC transport test
or a mutation API sweep. Transcript streams and resolved symlink targets remain
outside the readFile observer. The five negative cases reject synthetic reads
before opening their sentinel contents and retain adapter error reporting.

Focused checks passed 21 tests, with four existing Windows file-symlink skips;
the full suite passed 533 tests, with five such skips (EPERM). No real stores
were used. Typecheck and lint passed after final caller/spy typing fixes.
