# Confirm Undo effects and resume recorded actions

A failed Undo must not consume the original operation. A write-ahead intent is
not proof of completion, and a thrown filesystem or journal call is not proof
that nothing happened. History and inline feedback must retain this distinction.

## Decision

New journal operations use version 2. An intent carries the ordered main-only
move/copy actions and starts at cursor zero. Before an action, a synced checkpoint
records the source digest. After the action, another checkpoint advances the
cursor. A separate completion checkpoint closes the operation. Only a completed
Undo contributes an `undoneBy` link. Checkpoints are append-only and never appear
as separate user operations. A torn final line is retained and separated from the
next append by a newline.

Undo reuses its original intent on retry. Confirmed actions are skipped, even if
someone later edited the restored path. Only the pending action is reconciled:
unchanged source plus absent destination means not run; matching destination plus
absent source means a completed move. A copy requires the matching destination
and either matching or absent source. Both endpoints of a move still existing,
changed bytes, missing evidence or unsafe links refuse recovery and retain all
remaining bytes. Reading digests does not authorize paths outside their owning
store or trash boundary, and physical fingerprints stream file contents.

Displacing an occupant and restoring the saved tree are separate actions in the
same Undo intent. A failed restoration can therefore resume without displacing
the occupant a second time. Progress validation rejects invalid cursors, pending
digests, action endpoints, repeated/reordered actions, inconsistent parent links,
and Undo action sets that omit any confirmed forward step. Damaged records can
block recovery but cannot establish completion.

## Compatibility and results

Legacy records remain readable without migration or rewriting. Historical success
keeps its old meaning. A legacy failed forward operation retains its existing
conservative path checks. A failed legacy Undo has no action evidence and blocks
automatic recovery; neither it nor its failure marker proves completion. Unknown
or malformed records still yield itemized errors alongside healthy history.

[ADR-0019](0019-frame-logical-tree-digests.md) versions logical copy fingerprints;
[ADR-0020](0020-frame-physical-recovery-digests.md) does the same for physical
move fingerprints. An old bare digest cannot prove a pending action's tree
equality: it remains uncertain and blocked without changing history or bytes.
A fingerprint carrying the other action type's prefix is refused the same way.
Confirmed progress retains its historical interpretation.

`JournalEntryInfo` adds `outcome` (complete, partial, none, uncertain), `recovery`
and a visible `undoBlockedReason`. `failed` remains for compatibility. A journaled
partial or uncertain forward call returns its entry alongside errors, preserving
inline access to Undo. Null never signals a successful Undo. Partial Undo means
some actions happened; a preserved occupant alone does not mean an original file
has already been restored. The UI calls this an incomplete Undo.

## Considered options

- **Ignore failed Undo links alone.** Insufficient: replay can displace later edits
  and repeat completed actions; interruption may leave no failure marker.
- **Infer completion from a destination merely existing.** Rejected: it could be
  another writer's file or an incomplete cross-volume copy.
- **Intent, fingerprint, cursor and explicit completion (chosen).** Supports
  conservative continuation without rewriting history or discarding bytes.

## Consequences and limits

Progress adds journal writes and file hashing. Checkpoints use file sync, but
injected interruption/restart tests are not proof of filesystem ordering after
power loss on every platform. Path checks are not a transaction with external
writers; ambiguous recovery remains a refusal, not automatic repair. The process
queue serializes Kondo writes, not external programs. Historical Undo containing
a settings `write` or `splice` is refused before this machinery runs
([ADR-0010](0010-splice-config-files-never-whole-file-writes.md)).
