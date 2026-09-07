# Plan: Keep private and machine-local state out of publication

Status: **done** — implementation accepted; included in the owner's requested
consolidation onto `main`. Release publication remains separate.

Task 082 separates shared project documentation and checks from private agent
memory, workstation setup, and generated planning records. Removing paths from
the Git index must preserve every existing local copy.

## Scope

- Ignore and untrack `.claude/memory/`, `.claude/rules/jetbrains-mcp.md`,
  `.idea/`, and the generated Jig plan, authored, backlog, and discarded files.
- Keep shared Claude settings, portable rules and the fixture-run skill, plus
  Jig configuration, manifest, checks, and hooks available to a fresh clone.
- Keep `ROADMAP.jsonl`, its migration backups, and all of `.foreman/` local under
  the owner's approved policy; document the split and its tradeoffs.
- Update the documentation map, plan index, and decision record/index.

## Out of scope

Git history rewriting, local data deletion, application behavior changes,
publishing, pushing, merging, and changing installed guard behavior.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Use ignore rules plus `git rm --cached` for local files | Ignore rules alone do not remove already tracked files; local copies must survive. |
| 2 | Make no commits in this run | The worktree started with existing roadmap changes. |
| 3 | Keep the queue and all Foreman data local; publish direction, plans, and ADRs | Owner approved preserving full local history without requiring repeated scrubbing; see ADR-0013. |

## Seam changes

None. No renderer, bridge, workspace adapter, or store I/O changes.

## Verification checklist

Each row is completed before running the next required check.

- [x] `git ls-files -- .claude/memory/ .claude/rules/jetbrains-mcp.md .idea/ '.jig/plan*.json' .jig/plan.md .jig/authored.json .jig/backlog.json .jig/discarded.json`
  returns no files; hashes prove pre-existing local copies survived, and
  `git check-ignore` confirms every targeted path is ignored (21 files verified).
- [x] `npm test` passes against fixtures (35 files, 407 tests; no skips reported).
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] `git diff --check` and `git diff --cached --check` pass; staged and unstaged changes are task-owned,
  existing roadmap work is preserved, and required shared support files remain
  in the index.

## Verification results

The 21 targeted local files retain their original SHA-256 hashes and are absent
from the index. All 19 shared Claude/Jig support files remain tracked;
`npm run guards` reports no findings. Foreman CLI snapshots confirm every entry
other than 082 is unchanged. Index removals are staged by `git rm --cached`;
documentation and ignore edits are unstaged. No commits were made.

The owner approved keeping roadmap/Foreman data local. The queue and both
previously tracked Foreman files are ignored and removed from the index, bringing
the total to 24 files. Their hashes were checked immediately after untracking;
subsequent task closure updates only local Foreman bookkeeping through its CLI.
`ROADMAP.md`, the documentation map, and ADR-0013 describe what clones receive.

The owner subsequently requested committing all outstanding work and merging it
onto `main`. The consolidation verified all 24 local records still exist and
reran all 407 tests, typecheck, lint, and guards successfully.

## Done when

The chosen local-only files are ignored and absent from the index, their local
copies remain intact, shared project tooling remains tracked, and documentation
explains what a fresh clone receives. Implementation is recorded as awaiting
acceptance after all required checks pass.
