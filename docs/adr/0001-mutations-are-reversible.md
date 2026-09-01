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
  path for the app — never located inside any Claude store
  (docs/foundations.md, "Kondo's own footprint").
- **Kondo trash.** Nothing is unlinked. "Delete" moves the item into
  `<kondo-data>/trash/<journal-id>/`, preserving relative structure. A move
  is copy → verify → trash the source. Disable is a rename/settings edit that
  is its own inverse. Emptying the trash is the only destructive act, always
  explicit, never bundled into another action.

## Considered options

- **OS trash (Recycle Bin / Trash).** Rejected as the mechanism: no reliable
  cross-platform restore API tied to a journal id, and settings *edits* need
  undo too — the journal must cover both, so kondo owns the whole trail.
- **Git snapshots of stores.** Rejected: copying multi-gigabyte stores into a
  repo per mutation is unaffordable, and users' stores must not gain hidden
  `.git` directories.
- **Journal + kondo-owned trash (chosen).** One code path, testable
  byte-for-byte (see testing.md safety invariants), works identically for
  file moves and settings edits.

## Consequences

- Undo is a first-class feature surface, not best-effort. It has a screen of
  its own — the journal newest-first, an undo on every reversible entry, and
  the trash size beside them.
- Disk cost: trashed data persists until the user empties it; the UI must
  show trash size.
- Emptying is the one operation the journal does not cover, and cannot: an
  entry promising an undo that cannot happen is the one lie the journal must
  not tell. So `trashEmpty` is its own seam operation on its own channel,
  taking no argument, reached by nothing else in the app — and the journal
  itself survives it, so the history stays readable after the bytes it could
  have restored are gone.
- Every new mutation feature starts by defining its journal entry and inverse
  — a feature that cannot state its inverse does not ship.
- Journaling first means an entry can outlive the work it describes: a step
  that fails leaves an entry naming steps the store never got. The file is
  append-only, so the correction is a following marker line rather than an
  edit, and `JournalEntryInfo.failed` carries it across the seam so the
  journal screen stops offering a part-run operation as a finished one. Undo
  of such an entry is tolerant per step — an effect that is absent while its
  source is still in place means that step never ran, and reversing it is a
  no-op rather than a failure. An absent source is the emptied trash, and
  still refuses.
