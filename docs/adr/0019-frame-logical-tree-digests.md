# Frame logical tree digests and identify persisted fingerprints

Concatenating entry names and file bytes loses their boundaries: a shared
`SKILL.md` plus `a=bc` and the same manifest plus `ab=c` hash identically.
This is an encoding ambiguity, not a SHA-256 collision. A duplicate-removal
review or verified copy must distinguish those trees.

## Decision

`scan.digestTree` keeps SHA-256 and its public 64-character hexadecimal result.
Its input begins with `kondo:tree-v2:` followed by a zero byte. Entries sort by
their complete relative path using JavaScript string comparison. Each record
contains a one-byte ASCII type (`D` or `F`), an unsigned 64-bit big-endian path
byte length, and the UTF-8 path. A file additionally contains an unsigned
64-bit big-endian content length and exactly those bytes. Directories have no
content field. Empty entries count, including the root at relative path `''`.

Paths use `/` between components; the root's absolute location and basename do
not enter the digest. Lengths count bytes, not characters or filesystem read
chunks. As before, files are read into complete buffers. Modes and timestamps
do not define logical equality. Internal links hash as the contents a logical
copy materializes; strict tree preflight and owning-root validation before
every content read remain mandatory. Partial trees never prove equality.

`skillDuplicates`, reviewed group snapshots and copy verification consume the
same logical digest. New journal-v2 pending copy fingerprints carry
`tree-v2:<hex>` so recovery can identify the encoding. The parser still reads
old bare hexadecimal fingerprints, but a pending copy with one remains
`uncertain`, with recovery blocked and a visible reason. Even an apparently
unchanged source or destination cannot certify that old evidence. Recovery
does not recompute the old digest, append progress or move bytes in this case.

Confirmed historical cursors and completed operations retain their existing
meaning and remain undoable; the journal is never rewritten. Physical move
fingerprints and settings `write`/`splice` refusal (098) are unchanged. An older
application rejects the new pending strings as invalid progress and blocks
recovery, rather than accepting an unsupported format.

## Considered options

- **A separator alone.** File bytes can contain the separator or another entry's
  header; lengths and entry types make boundaries explicit.
- **A different hash algorithm.** Does not fix ambiguous input encoding.
- **Legacy-hash fallback.** Would restore the same false equivalence during
  recovery; refused even when that costs automatic recovery of an old attempt.

## Consequences

All current logical digests change together; public shape and opaque review
tokens remain unchanged. No persisted digest cache needs migration. Old pending
copies require manual review while their bytes remain available. This does not
make pathname checks atomic with external writers or change physical relocation
verification; those are separate concerns.
