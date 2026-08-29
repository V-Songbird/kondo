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

- Undo is a first-class feature surface, not best-effort.
- Disk cost: trashed data persists until the user empties it; the UI must
  show trash size.
- Every new mutation feature starts by defining its journal entry and inverse
  — a feature that cannot state its inverse does not ship.
