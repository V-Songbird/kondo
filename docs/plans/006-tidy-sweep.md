# Plan: 006 — the tidy sweep with a dry-run preview

Status: **done — shipped in `a4bc8b2`**

The cached-scan confirmation design below is historical. Task 102 and
[ADR-0015](../adr/0015-bind-removal-to-reviewed-state.md) replace it with
main-owned review tokens and current precondition validation.

Written after the code rather than before it, which is the wrong order and is
recorded here rather than hidden: the implementing session's file surface was
scoped to `electron/`, `src/` and `test/`, so this file was flagged and then
written on the owner's say-so. Everything below is the design as built.

Roadmap entry `006`. A store with 8,921 project directories accumulates stale
sessions, empty transcripts, orphaned sidecars and dead caches that nobody
clears by hand — reclaiming that space is why kondo measures staleness at
all. Entries `003`–`005` each moved one thing; this one moves hundreds, and
that is the whole difficulty: the sweep has to be a *single* reversible
operation, and the user has to see what it would do before it does it.

## Scope

**Workspace** — `electron/main/workspace/tidy.ts`. `scanTidyCandidates`
reads the four categories off the cached tier-1 inventory (ADR-0007) and
opens no transcript; `toTidyPreview` projects them into counts and bytes;
`tidyPlan` turns the chosen categories into one `MutationPlan` of `trash`
steps. `workspace.ts` gains `tidyPreview` / `tidySweep` and drops its cached
inventory after a successful sweep or undo.

**Seam** — `tidyPreview` and `tidySweep(categories)`, plus `tidyCategories`,
`TidyCategoryPreview` and `TidyPreview`.

**Renderer** — `src/features/tidy/tidy.tsx`, a new "Tidy" view: one row per
category with a checkbox, its count, what it reclaims and a few example
paths, then a confirmation bar before anything moves.

## Out of scope

Emptying the trash, any retention policy (`001` decision 7 still stands), the
undo and trash UI (`007` — this view reports the sweep's journal summary and
offers no undo button, exactly as the skill and plugin toggles do), and
Later-column analysis like duplicate detection.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The preview and the sweep read the same cached scan | The invariant is that the sweep moves the set the preview named. Rescanning at sweep time would move a set the user never saw. |
| 2 | A vanished candidate refuses the whole sweep | `mutate` already refuses a `trash` step with nothing at its path. All of the preview or none of it beats a silently different set. |
| 3 | Reclaimable caches are a fixed allowlist, never a heuristic | `cache`, `paste-cache`, `debug`, `downloads`, `shell-snapshots`, `telemetry`. `backups/` and `file-history/` grow the same way and look just as reclaimable, but they back checkpoint and rewind. |
| 4 | An empty cache directory is not a candidate | Moving it reclaims nothing and puts journal noise where a directory Claude recreates on its next run used to be. |
| 5 | A zero-byte transcript is *empty*, never *stale* | The two categories would otherwise both claim it, and the second `trash` step of the pair would fail on a path already moved. |
| 6 | A session's sidecar directory rides with its transcript, as one item | Leaving it behind only makes it tomorrow's orphan. It is one more step in the same entry, not an item of its own. |
| 7 | Sidecar bytes are not counted in the preview | Measuring every sidecar means walking the projects tree, which is what ADR-0007 exists to prevent. `userStoreReport` already reports "transcript bytes" for the same reason. |
| 8 | An orphan sidecar *is* measured | Its directory is its whole value, there is no transcript to stand in for it, and the inventory has already proved which directories those are. |
| 9 | A new `store` EntityKind, `entityId: 'store:user'` | A sweep spans transcripts, sidecar state and cache directories, so no entity below the store is the thing it changed. Reusing `session` would put a lie in a durable journal file. |
| 10 | Nothing to sweep writes no journal entry | A no-op that leaves an entry behind is not a no-op, and `undo` would then have something meaningless to reverse. |
| 11 | `SessionRecord.hasSidecar` became `sidecar: string \| null` | The match that finds a sidecar is case-insensitive, so a flag plus a lowercased UUID is a guess at a real directory name. The sweep has to displace the exact one. |

## Seam changes

`KondoApi` gains `tidyPreview(): Promise<Scan<TidyPreview>>` and
`tidySweep(categories: TidyCategory[]): Promise<Scan<JournalEntryInfo |
null>>`, with `kondo:tidy-preview` and `kondo:tidy-sweep`. `tidyCategories`
is a runtime array so the renderer builds its rows from it and the main
process validates against it — one source of truth. `EntityKind` gains
`store`, which forces its capability-matrix row: no listing produces a
`store:` id, and the row refuses every operation, so a later store-level
toggle is refused rather than invented (ADR-0006).

## Tests

`test/tidy.test.ts`, against a fixture world with one fresh session, one
stale session carrying sidecar state, one empty-and-stale transcript, one
orphaned sidecar, two reclaimable caches, an empty `telemetry/` and a
`backups/` that must survive:

- The preview names per-category counts and bytes, and the store hashes
  identical before and after it — including no journal entry.
- The set of paths that leave the store equals the set the preview named,
  plus the sidecar the contract says rides along, and nothing else.
- A sweep of one category moves that category and leaves the rest.
- An unknown category, and a non-array argument, are `bad-request` with
  nothing moved.
- One sweep is one journal entry: `op: 'trash'`, `kind: 'store'`, six steps.
- Undo restores the whole sweep byte-for-byte, and the preview reads back
  its original totals.
- Every swept path is under `<kondo-data>/trash/<id>/user/`.
- The journal entry is appended before the store is touched (ADR-0001).
- `sessionProjects` after a sweep reflects it without an explicit rescan.
- A store with nothing to reclaim previews zero, sweeps to `null`, hashes
  unchanged, and writes no journal entry.

## Done when

A user opens Tidy, sees counts and bytes for what kondo would reclaim,
picks categories, answers one confirmation, and the store shrinks — with
every swept item sitting in kondo's trash under a single journal entry that
one undo reverses whole.
