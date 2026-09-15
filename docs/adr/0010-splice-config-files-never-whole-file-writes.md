# Plan configuration edits as splices; refuse them until concurrent writes are preserved

`~/.claude.json` is ~2 MB and Claude Code rewrites it during every session
(ADR-0009); the same is true in miniature of a `settings.json` a user has open
in an editor. A whole-file `write` planned from a scan discards whatever
another writer saved between the scan and the write, and restoring a whole
snapshot on Undo discards it a second time. Removing a member from an object
is not a smaller whole-file write either: its correctness depends on the bytes
around it still being the bytes that were parsed.

## Decision

- **Plan edits as splices.** A `splice` step names a store, a path, the digest
  of the bytes it was planned against, and an ordered list of
  `{ at, remove, insert }` edits, each offset relative to the result of the
  edits before it. Its Undo is the inverse edit list applied to the file's
  current bytes, never a stale snapshot. An absent settings layer is planned as
  a whole-file `write` after an explicit creation confirmation. A file kondo
  cannot parse faithfully produces no plan at all (ADR-0005). The
  `user-config` store root is exactly the named registry file under its
  resolved parent.
- **Refuse execution.** Every plan containing a `write` or `splice` step —
  mixed plans with moves or trash, and confirmed creation of a missing layer,
  included — is refused on every platform before step preparation, journaling,
  temporary-file creation or any store mutation. Requested and prepared steps
  are checked again after asynchronous planning and preflight. Undo applies the
  same refusal to every historical entry containing either step, retaining its
  journal records, inverse edits and recovery bytes without recording
  completion. Unrelated moves, trash and their Undo remain available. Kondo's
  appearance preference is outside this gate.

Why refusal: the digest check and the replacement are separate operations. A
writer can replace the target after Kondo's final read and before its rename,
and the rename then overwrites bytes Kondo never read; the same race affects
inverse splices during Undo. Synchronizing the temporary file protects its own
contents, not the competing writer's, and Node's path-based rename neither
conditions replacement on the digest nor retains the displaced target.

This refuses settings-based skill, plugin and MCP toggles, plugin scope moves
and clearing, configuration-leftover removal, and skill moves that also change
settings. Discovery and plan construction still run; a matrix row that allows
an operation, or a returned plan, does not mean execution is permitted.

## Considered options

- **Write the whole file.** Rejected: silently discards concurrent writes in
  both directions.
- **Re-read, re-plan, then write the whole file.** Rejected: the window
  merely shrinks, and Undo still restores a snapshot that is stale by
  construction.
- **Merge: reparse, apply the change to the parsed object, reserialize.**
  Rejected: it reformats every top-level key the user never asked kondo to
  touch (87 in the registry), and it resolves a genuine conflict by guessing.
- **Execute splices behind the digest check.** Rejected once measured: it
  preserves formatting and detects changes made before its read, but a fixture
  write injected between the digest check and the rename was overwritten.
- **Another hash check, an advisory lock other writers do not share, asking
  the user to close Claude, or a forced-write option.** Rejected: none of them
  preserves a competing write.

## Re-enabling

Execution returns only with a preservation backend that demonstrates, on
native failure paths, that competing writes survive and recovery is honest.
Known constraints: Node's `rename` overwrites and has no exchange operation;
Windows `ReplaceFileW` can fail partway and leave the replaced file under its
backup name and the replacement under its temporary name; Linux atomic
exchange is a candidate whose filesystem support and retention behaviour still
need verification. Windows settings writes may stay unavailable even then.

## Absence evidence for configuration cleanup

A settings key is not leftover merely because Kondo's local catalog lacks it.
Plugin installation reads keep completeness separately from rows; partial or
unsupported data preserves healthy entries and errors without authorizing
absence. A missing-plugin candidate needs a complete version-2 inventory and
positive marketplace identity; directory, inline, synced and unknown sources
are retained, including their disable preferences.

Skill overrides carry no source identity, and bundled, managed, command and
additional-directory skills cannot all be enumerated, so every skill override
is preserved. A list of known bundled names was rejected: a new Claude skill
would silently turn a valid disable preference into a cleanup candidate.

Preview and action both force a fresh project-location inventory and re-read
plugin records, because a recreated project need not change the cache
fingerprint. If a requested candidate has become uncertain, the whole
selection is refused rather than the remainder removed. Removal itself is a
settings edit and is refused as above.
