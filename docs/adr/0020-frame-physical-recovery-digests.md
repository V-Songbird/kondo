# Frame physical recovery digests and identify move fingerprints

Physical relocation hashed each JSON entry header immediately followed by its
file bytes. File content could therefore contain the next entry's header and
make a different physical tree produce the same encoded input. Recovery also
stored these unversioned hashes, so an interrupted move could not say which
encoding supplied its evidence.

## Decision

`relocation.physicalDigest` keeps SHA-256 and its 64-character hexadecimal
result. Its input begins with `kondo:physical-v2:` followed by a zero byte.
Entries sort by complete `/`-separated relative path. Each record contains a
one-byte ASCII type (`D`, `F` or `L`), an unsigned 64-bit big-endian path byte
length and the UTF-8 path. A link adds the length and UTF-8 bytes of its stored
target text. A file adds its inventoried unsigned 64-bit content length followed
by exactly those bytes.

The digest opens each regular file only after boundary resolution. The opened
handle must still be a file of the inventoried size. Reads remain streamed and
may use any short-read chunks, but they stop and refuse after observing one byte
beyond the framed length. EOF before the framed length, or changed size,
modification time or change time, also refuses. The handle still closes on every
result. Link text
is hashed as metadata and never grants permission to open its target.

New journal-v2 move actions, including Undo moves, persist
`physical-v2:<hex>`. Copy actions continue to persist `tree-v2:<hex>`. The
parser keeps bare, logical and physical fingerprints readable, then recovery
requires the prefix matching the recorded action. A bare pending fingerprint or
a copy/move prefix mismatch remains uncertain and blocks before endpoint
resolution, content reads, journal appends or filesystem effects.

Append-only progress validation also checks a typed pending fingerprint before
any later checkpoint may clear it, whether by advancing the cursor or recording
a same-cursor failure. A typed mismatch makes the linked history damaged and
cannot establish completion or `undoneBy`. Bare pending fingerprints may still
advance so already-completed legacy histories keep their established meaning.

Confirmed cursors and completed operations retain their historical meaning even
when an earlier append-only checkpoint contains a bare fingerprint. No journal
row is migrated or rewritten. An older application treats the new physical
prefix as invalid progress and blocks the related history rather than using an
encoding it does not understand.

## Considered options

- **Add separators.** Rejected because arbitrary bytes can contain them.
- **Hash one buffer per file.** Rejected because physical recovery must retain
  bounded memory use for large trees.
- **Recompute the legacy hash during recovery.** Rejected because reproducing
  the ambiguous encoding cannot establish equality.
- **Typed, length-framed streaming records (chosen).** Preserves physical link
  identity and bounded reads while making record boundaries unambiguous.

## Consequences

Every current physical digest changes, and interrupted legacy move or Undo
evidence requires manual review. Completed legacy work remains readable and
undoable. EXDEV copy verification uses the framed digest on both endpoints.
The checks do not make path resolution atomic with external writers, serialize
other processes, or establish filesystem ordering after power loss.
