# Mutations are reversible

Kondo edits the state a user's entire Claude history lives in. A bug that
deletes the wrong session directory is unrecoverable and would end trust in
the tool permanently. So the write path has one law: **every mutation kondo
performs can be undone**, and the mechanism is uniform rather than
per-feature.

Two pieces:

- **Journal.** Before touching a store, kondo appends a journal entry
  (`<kondo-data>/journal.jsonl`) describing the operation, the paths, and
  what is needed to reverse it. Journal write fails → the mutation does not
  run. `<kondo-data>` is kondo's own data directory — Electron's `userData`
  path for the app, or `KONDO_DATA_ROOT` — and must never sit inside a Claude
  store (docs/foundations.md, "Kondo's own footprint").
- **Kondo trash.** Nothing is unlinked. "Delete" moves the item into
  `<kondo-data>/trash/<journal-id>/`, preserving relative structure. A move
  into another store is copy → verify → trash the source; a move inside one
  store, such as returning a benched skill to `skills/`, is one journaled
  move. Emptying the trash is the only destructive act, always explicit, never
  bundled into another action.

Settings edits are planned as reversible splices, but every plan containing
one is refused before any effect
([ADR-0010](0010-splice-config-files-never-whole-file-writes.md)).

## Considered options

- **OS trash (Recycle Bin / Trash).** Rejected as the mechanism: no reliable
  cross-platform restore API tied to a journal id, and the journal has to
  cover every kind of change, so kondo owns the whole trail.
- **Git snapshots of stores.** Rejected: copying multi-gigabyte stores into a
  repo per mutation is unaffordable, and users' stores must not gain hidden
  `.git` directories.
- **Journal + kondo-owned trash (chosen).** One code path, testable
  byte-for-byte (see testing.md safety invariants).

## Consequences

- Undo is a first-class feature surface, not best-effort: History lists the
  journal newest-first, an undo on every reversible entry, and the trash size
  beside them.
- Disk cost: trashed data persists until the user empties it; the UI must
  show trash size.
- Emptying is the one operation the journal does not cover, and cannot: an
  entry promising an undo that cannot happen is the one lie the journal must
  not tell. So `trashEmpty` is its own seam operation on its own channel,
  taking no argument, reached by nothing else in the app. It reports the
  difference between one measurement before and one after, so a half-finished
  removal still reports what actually left. The journal survives it, and an
  Undo whose trash bytes are gone is refused with that cause.
- Every new mutation feature starts by defining its journal entry and inverse
  — a feature that cannot state its inverse does not ship.
- Removal is a *capability*, not a special case: `trash` is a
  `CapabilityOperation` beside `enable`, `disable` and `move`, answered by the
  same kind × scope × operation lookup before a step exists (ADR-0006). Its
  plan is a single `trash` step rather than the move's copy → verify → trash:
  that recipe protects bytes about to be released somewhere else, and here the
  kondo trash *is* the copy.
- Progress, completion and recovery of interrupted operations follow
  [ADR-0018](0018-confirm-undo-effects-and-resume.md).
