# Splice configuration files; never write one whole

`~/.claude.json` is ~2 MB and Claude Code rewrites it during every session
(ADR-0009). The same is true in miniature of a `settings.json` a user has
open in an editor. Kondo's `write` step replaces a whole file with bytes
planned from a scan, and its undo restores a whole snapshot from the trash.
Against a file nobody else touches that is exactly right. Against one Claude
is writing, both halves are destructive: the write discards whatever Claude
appended between the scan and the write, and the undo discards it a second
time by putting the pre-scan snapshot back. A user who removes one dead
project entry would lose a session's worth of registry updates and never be
told.

The `write` step also cannot express removal at all. Taking a member out of
an object is not a smaller whole-file write — it is the one edit whose
correctness depends on the bytes around it still being the bytes that were
parsed.

Decision: a `splice` step. It names a store, a path, the digest of the bytes
it was planned against, and an ordered list of `{ at, remove, insert }`
edits. At apply time it re-reads the file, hashes it, and **refuses** unless
the digest still matches; then it applies the edits and writes the result.
The journal records the edits, so the undo is the inverse splice applied to
the file's current bytes — never a stale snapshot. The undo checks a digest
of its own, the one the splice produced, and refuses the same way.

An edit's offsets are relative to the result of the edits before it in the
list, so removing two adjacent members of the same object needs no overlap
arithmetic and each edit stays as narrow as the member it removes.

## Considered options

- **Write the whole file, as today.** Rejected: silently discards Claude's
  concurrent writes, in both directions.
- **Re-read, re-plan, then write the whole file.** Rejected: the window
  merely shrinks, and the undo still restores a snapshot that is stale by
  construction.
- **Merge: reparse, apply the change to the parsed object, reserialize.**
  Rejected twice over. It reformats 87 top-level keys the user never asked
  kondo to touch, and it resolves a genuine conflict by guessing.
- **Splice with a digest refusal (chosen).** The one answer that cannot lose
  a byte it did not plan to.

## Consequences

- A digest mismatch is a refusal (`stale-file`), not a retry and not a forced
  write. Kondo says the file changed and asks the user to look again. Racing
  Claude by re-planning in a loop is explicitly not the fix: whoever wrote
  last wrote something kondo has not seen.
- `~/.claude.json` becomes writable, and enters the write path the way
  ADR-0003 requires: a named store root (`user-config`) from the locator,
  confined to that one file name, never an ad-hoc path.
- The undo is the inverse edit list, so ADR-0001 holds without a snapshot in
  the trash. The cost is that an undo also refuses once Claude has written
  the file again — the journal entry stays, and stays honest about why it
  cannot be reversed, which is better than reversing it onto bytes it never
  saw.
- Nothing is unlinked, so ADR-0001's promise is unchanged. What a splice
  displaces lives in the journal's `edits` rather than in `<kondo-data>/trash`.
- The write goes through a temporary sibling of the target, renamed over it,
  so a reader racing kondo sees the old bytes or the new ones and never a
  torn 2 MB file. The temporary has to share a filesystem with the file it
  replaces, so for the registry it lives in the home directory for the
  length of one step and is renamed or removed inside it. The write-boundary
  test pins that as the one path a splice touches outside a scanned store.
- A file kondo cannot parse faithfully still produces no plan at all
  (ADR-0005): the splicer answers null and the caller refuses rather than
  reformatting.
