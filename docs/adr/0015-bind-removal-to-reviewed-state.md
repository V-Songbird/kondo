# Bind removal to the state the user reviewed

A category name or entity id does not say which bytes the user reviewed.
Audit A5/A9/A11 demonstrated newly discovered caches entering an approved sweep,
a resumed transcript retaining a cached stale classification, and an edited
skill being removed after an earlier identical-copy verdict.

## Decision

The workspace retains removal reviews in main memory behind opaque tokens.
Tidy previews bind category candidates; session removal has a selected-id
preview; duplicate-skill groups bind all members and their equivalence.
Only the token and previously emitted ids/categories cross back through IPC.
Renderer-supplied paths, digests or candidate objects never authorize removal.

Applying a review consumes its token, resolves the exact selection and checks
its current identity, contents and operation-specific eligibility. Changed
membership, missing entities, resumed or changed session data, and changed
skill groups refuse the whole selection with `stale-plan`. The renderer clears
selection and offers a fresh review. An expired, missing or already consumed
token cannot be retried as a deletion. Cancel discards the UI's review.

Revalidation runs before journaling, after mutation step planning. It does not
silently drop changed members, acquire newly eligible members or turn a stale
review into a partial success. Unselected categories do not expand the selected
scope. Reads use the existing owning-root boundary helpers. Preview bookkeeping
is disposable and never writes Claude truth into a persistent approval store.

## Journal and Undo

One workspace serializes mutation, Undo and empty-trash execution. Otherwise
two distinct valid tokens could both validate a duplicate group before either
removal ran, removing every copy. The queued operation revalidates when it
actually reaches the write path. This queue is local to the workspace.

A stale review writes neither a mutation entry nor store bytes. Accepted plans
retain ADR-0001: journal first, displace to Kondo trash, preserve Undo. An I/O
failure after the journal is appended continues to use the existing failure
record and recovery rules; it is not labeled a preflight refusal.

## Cost and limits

Removal review pays for validation of the candidate trees, including content,
that a normal listing avoids under ADR-0007. This is explicit removal work,
not a new startup scan. Reviews expire after 15 minutes; main retains at most 128 reviews and 8 MiB
of serialized review data. Tokens are single use; reopening a review
is the recovery for a token that main no longer holds.

The store has no transaction shared with Claude or another filesystem writer.
Path validation, hashing, journal append and relocation are separate operations.
A writer can still change the filesystem after the last preflight observation.
These checks establish tested preconditions, not elimination of every concurrent
filesystem race. General process activity detection and cross-process locking
remain separate concerns.
