# Plan: Remove remaining personal project context from the publication snapshot

Status: **in progress**

The repository became public on 2026-09-15, so the current tree is exposed
now. Task 111's audit found two disclosures that survive in it: a personal
corpus observation naming a real local project path in `docs/domain.md`, and
a private repository identifier reused as a fixture in
`test/library-catalog.test.ts`. Both are replaced with neutral synthetic text
of the same shape, keeping the domain rule and the test behaviour intact.

## Scope

Documentation and test fixtures only; no workspace, seam or renderer change.

| Item | Where | Replacement |
|---|---|---|
| Corpus observation and real local project path — `17 directories held only memory/ and 23 held no transcript at all (24 of 8,641 on 2026-09-05, two of them live projects — D:\Projects\Knowledge\GRFEditor among them)` | `docs/domain.md`, `memory/` bullet of the `projects/` section | The same verified fact without counts, survey date or real path: both directory shapes occur, and some are live projects — synthetic example `D:\Code\example-app` — whose memory is Claude's only record there |
| Private repository identifier `project:code:slag` | `test/library-catalog.test.ts`, the "makes one object per name, however many scopes hold it" case | `project:code:other`, matching the neutral `project:code:x` already used in the same file |

The domain rule preserved verbatim: "no transcript" is not "scratch" — a
transcript-less directory is offered whole only when it holds no `memory/`,
shows no recent activity, and either carries a throwaway name or has an
*unlocated* path; one holding `memory/` under a live or unlocated path is
Claude's record of a project and is offered nowhere.

## Out of scope

Git history, repository visibility, public identity and destination — those
stay with plan 111 and the task 114 publication review.
`docs/plans/111-public-history-baseline.manifest`, its evidence file and its
reproduction script stay byte-identical, because 111's reproduction checks
their source commit and SHA-256. Other personal hits found by the sweep are
reported, not fixed here.

## Sweep method

Read-only over the tracked tree: `git ls-files` as the file set, then
`git grep -n -i` for the owner's user name, `D:/Projects` and `D:\Projects`
paths, and the replaced identifier `slag`, excluding the two 111 evidence
files the invariants freeze. Every hit outside the two known items is listed
in the completion report with its file and line.

## Seam changes

None.

## Tests

No new assertions. `test/library-catalog.test.ts` keeps every assertion it
had: the two `run-kondo` skills in different scopes still collapse to one
catalog object named `run-kondo` with `places` 2, and the catalog still lists
`['hush', 'run-kondo']`. Only the fixture's project identifier string
changes.

## Done when

The public tree states the memory-only-project rule with a synthetic example
and no personal corpus observation or real local path, the catalog test uses
a neutral synthetic project identifier, and guards, tests, typecheck and lint
all pass.
