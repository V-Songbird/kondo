# Plan: 001 — the mutation journal and kondo trash

Status: **done**

Roadmap entry `001`. ADR-0001 says every mutation kondo performs can be
undone, and the mechanism is uniform rather than per-feature. Nothing in the
app writes yet, so the journal and the trash are built first, on their own,
with no feature riding on them. Every later write task — the skill and plugin
toggles, the skill move, the tidy sweep — goes through what this slice
defines. Getting the entry shape wrong here is expensive later; getting it
right makes each of those tasks small.

## Scope

**Locator** — `<kondo-data>` is currently named in ADR-0001 and
foundations.md and resolved by no code. `createLocator` gains `kondoDataRoot`
alongside `userRoot` and `desktopRoot`, injected from Electron's `userData`
path at the composition root and overridable by `KONDO_DATA_ROOT` for tests.
It is never inside a Claude store, and a safety test asserts that.

**Journal** — `<kondo-data>/journal.jsonl`, append-only, one JSON object per
line. Written *before* the store is touched; a failed journal write means the
mutation does not run. Each entry carries enough to reverse itself:

```jsonc
{
  "id": "01JQ...",          // sortable, generated once, names the trash dir
  "at": "2026-08-29T...Z",  // ISO-8601
  "op": "move" | "settings-edit" | "trash",
  "kind": "skill" | "plugin" | "session" | "setting",
  "entityId": "skill:user:alpha-skill",   // ADR-0008 id, never a path
  "steps": [ /* per-op inverse data — see Decisions #2 */ ],
  "undoneBy": null          // journal id of the undo entry, once undone
}
```

**Trash** — `<kondo-data>/trash/<journal-id>/`, preserving the path relative
to its store root so a restore is unambiguous. Nothing is unlinked. Emptying
the trash is a separate explicit operation and is not part of this slice.

**Mutation core** — a `mutate(op)` wrapper every future write goes through:
journal, then act, then re-read the store (ADR-0006 — the store is the
state). Plus `undo(journalId)` and `journalList()`. Path confinement is
enforced here, reusing `pathWithin` from `scan.ts`: a write outside a known
store root or `<kondo-data>` is refused, not journaled.

**Seam** — `journal.list`, `journal.undo`, `trash.size`. No mutation channel
ships in this slice; there is nothing yet to mutate.

## Out of scope

Every actual mutation (`003`–`006`), the undo and trash UI (`007`), the kind
registry (`002` — independent, and `mutate()` must not assume it), emptying
the trash, and any retention or expiry policy.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Journal ids are lexicographically sortable and generated once | The id names the trash directory, so it must be filesystem-safe and collision-free, and reading the journal in order must not mean parsing every timestamp. |
| 2 | One entry per user-visible operation, holding N steps | A skill move is copy plus trash; a sweep is hundreds of moves. Undo has to restore them together or a half-undone sweep is worse than no undo. |
| 3 | Undo is itself journaled, and the original is marked `undoneBy` | Otherwise the journal claims a state the disk does not have, and redo is impossible. |
| 4 | Trash preserves the path relative to its store root, not the absolute path | Absolute paths are machine-specific and the restore target is derived from the store root at undo time, not from what was recorded. |
| 5 | Journal write failure aborts the mutation | ADR-0001's whole promise. An unjournaled write is an un-undoable one. |
| 6 | `<kondo-data>` never sits inside a Claude store | Kondo's trash would otherwise show up in kondo's own store scan, and a sweep could trash its own undo history. |
| 7 | No expiry, no size cap in this slice | Retention is a user-facing policy decision (SECURITY.md says trash persists until emptied). Inventing one here would hide data loss inside a plumbing task. |

## Tests

The ADR-0001 safety invariants docs/testing.md defers to the first mutation,
each against a fixture world:

- A journal entry is written **before** the store is touched, proven by a
  mutation whose act step throws: the journal has the entry, the store is
  unchanged.
- `undo` restores a fixture **byte-for-byte**, hashed before and after,
  including a multi-step operation undone as one.
- No write lands outside a known store root or `<kondo-data>`, proven the way
  `boundary.test.ts` proves reads: spy every `fs` write call across a
  mutation sweep and assert containment.
- A failed journal write leaves the store untouched.
- `<kondo-data>` resolves outside every store root on all three platforms.
- A corrupt journal line is skipped and reported, never fatal (ADR-0005).

## Done when

A test-only mutation runs end to end against a fixture store, its journal
entry is on disk before the change, and `undo` restores the fixture
byte-for-byte. `npm test`, `npm run typecheck`, `npm run lint` and
`npm run guards` all green.

## What actually shipped

`electron/main/workspace/mutations.ts` holds `mutate`, `undo`, `list` and
`trashSize`; the workspace exposes the last three on the seam as
`journalList`, `journalUndo` and `trashSize`. `mutate` stays main-process
only — there is still nothing to mutate. Four places where the code differs
from the design above:

| # | Divergence | Why |
|---|---|---|
| 1 | `undoneBy` is not stored; it is derived at read time from the undo entry's `undoOf` | The file is append-only, so it cannot also rewrite a past line. One field on the undo entry says the same thing and keeps that true. |
| 2 | Each step records `created` — the directories it had to make | Without it an undone move leaves an empty `skills.disabled/` behind, and "byte-for-byte" is a lie. Undo removes those directories only while they are still empty. |
| 3 | Store roots are named (`user`, `desktop`), and a step names one plus a relative path | Decision 4 wanted store-relative paths; naming the root is what makes them resolvable, and it is also the confinement check. Project roots arrive with `005`. |
| 4 | Undoing a `write` first moves the current bytes into the undo's own trash | "Nothing is unlinked" has to hold for undo too, or a restore silently destroys what kondo wrote. |

The safety invariants live in `test/mutation.test.ts` (12 cases), and
`test/boundary.test.ts` now sweeps the journal and trash reads too.
