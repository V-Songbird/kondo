# Plan: 007 — undo and the trash, on screen

Status: **in progress**

Roadmap entry `007`. ADR-0001 promises every mutation kondo performs can be
undone, and `001` built the whole mechanism — journal, trash, `undo`. Four
features now write through it (`003`–`006`), so the journal has real entries
in it, and none of them is visible anywhere. Undo is currently a guarantee
the code keeps and the user cannot see, exercise, or audit. This slice turns
it into a screen. It also gives the trash the two things SECURITY.md asks
for: a visible size, and a way to empty it that reads like what it is.

## Scope

**Workspace** — `mutations.emptyTrash()`: remove `<kondo-data>/trash/` and
nothing else, and report what actually went. `trashSize`'s body becomes a
shared `readTrash()` both use. The workspace exposes it as `trashEmpty` and
adds no other machinery: the journal listing, the per-entry undo and the
trash size all already exist from `001`.

**Seam** — one method, `trashEmpty(): Promise<Scan<TrashReport>>`, on its own
channel `kondo:trash-empty`, taking no argument.

**Renderer** — `src/features/journal/journal.tsx`, on a new *Journal* tab.
The trash panel on top: size, restore-point count, root path, and the
empty-trash button. The journal beneath it, newest first, each row naming
what that mutation did with an Undo beside it. Undo and empty both re-read
both sources when they finish.

## Out of scope

Any new mutation, any second restore path (undo goes through `undo(journalId)`
exactly as `001` wrote it), redo, per-entry trash sizing, selective emptying
of one entry's bytes, and any retention or expiry policy — SECURITY.md is
explicit that trashed data persists until the user empties it.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Emptying is not journaled | A journal entry is a promise that undo can reverse it. Emptying is the one thing undo cannot reverse, so recording it as an entry would make the journal lie. The journal file itself survives the empty, so the history stays readable. |
| 2 | `trashEmpty` takes no argument and no other method calls it | ADR-0001 says emptying is never bundled into another action. The cheapest way to keep that true is to leave it nothing to be bundled *into*: no parameter to smuggle it through, and no call site inside `mutate` or `undo`. |
| 3 | It reports what was removed, not what remains | A recursive remove can stop half way. Measuring before and after and reporting the difference is the only number that is true in both cases, and it is what the UI needs to say what the user just lost. |
| 4 | `TrashReport` is reused rather than a second type added | The three facts are the same three facts; which one a report describes is the method that returned it. |
| 5 | Cancel is first and focused in the confirmation; the destructive button is second and red | ADR-0001 requires emptying never be the default. A confirmation whose dangerous choice takes the return key is a default in everything but name. |
| 6 | An entry whose bytes are already gone is refused by main, not greyed out in the UI | The renderer would have to guess which entries still have trash behind them. Main knows, and already answers with a scan error the view renders (ADR-0005). |
| 7 | Rows render `summary` and `entityId` only | Both are built in the main process from store structure, never from content (ADR-0002, ADR-0008). |

## Seam changes

One addition: `trashEmpty(): Promise<Scan<TrashReport>>` and the
`kondo:trash-empty` channel. `journalList`, `journalUndo` and `trashSize`
shipped with `001` and are unchanged, as is `JournalEntryInfo` — it already
carries `at`, `op`, `kind`, `entityId`, `summary`, `stepCount`, `undoneBy`
and `isUndo`, which is everything a row needs.

## Tests

`test/journal.test.ts`, against a fixture world:

- Three mutations, then `journalList` returns them newest first — and an undo
  arrives at the head with the entry it reversed carrying `undoneBy`.
- `journalUndo`, called with an id taken from `journalList`, restores the
  store byte-for-byte (hashed before and after).
- `trashEmpty` removes the trash contents and nothing else: both store trees
  hash unchanged, and `journal.jsonl` is byte-identical afterwards.
- It reports what went, and a second call on an empty trash is a clean zero
  rather than an error.
- No other operation empties the trash: a toggle, a move, a sweep and an undo
  all run in turn, and the trash only ever grows across them. Proven twice —
  by the reported size, and by every `fs.rm` call across the sweep being
  checked against the trash root.
- An entry whose bytes were emptied refuses its undo instead of half-restoring.

## Done when

The Journal tab lists what kondo has done, newest first, with an Undo on
every entry that can take one; the trash's size is on screen; and emptying it
takes a deliberate second click on a confirmation that names what is about to
be lost. `npm test`, `npm run typecheck` and `npm run lint` all green.
