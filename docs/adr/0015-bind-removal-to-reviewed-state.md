# Bind removal to the state the user reviewed

A category name or entity id does not say which bytes the user reviewed.
Without a binding, newly discovered caches entered an approved sweep, a
resumed transcript kept a cached stale classification, and an edited skill
was removed on the strength of an earlier identical-copy verdict.

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

## What a review is worth in bytes

The size a preview reports is measured over the very trash steps the token
binds, deduplicated, and never over a second walk of the store. A session's
sidecar directory and released marker are steps of the same plan as its
transcript, so their bytes are in its figure. Regular-file bytes are summed the
way `trashSize` counts the trash, so a confirmed move grows the trash by exactly
the figure reviewed. Category figures are disjoint — a path counted under one
category is counted under no other — so a combined selection is the sum of the
categories it picked.

`TidyCategoryPreview.bytes` kept its name through that change and did not keep
its meaning. It was the transcript and directory bytes the inventory had already
stat'd, with a session's sidecar and marker riding along uncounted; it is now
every reviewed trash-step byte for that category. `SessionSummary.bytes` is the
field that still means one transcript, because a listing is a listing and stats
no companion (ADR-0007). Reading the first as the second is the misreading this
paragraph exists to prevent.

`RemovalSizeEstimate` crosses the seam with those bytes separated into three:
what will move, what kondo's trash then holds, and what a permanent empty would
free. Displacing frees no disk space, and one number would be read as the third.
A preview whose reviewed path could not be read, or which was issued no token,
carries `incomplete` and its figures are a floor rather than a total. The
renderer receives the figures and never a path to measure.

Revalidation runs before journaling, after mutation step planning. It does not
silently drop changed members, acquire newly eligible members or turn a stale
review into a partial success. Unselected categories do not expand the selected
scope. Reads use the existing owning-root boundary helpers. Preview bookkeeping
is disposable and never writes Claude truth into a persistent approval store.

## What a review discloses

A token binds a set of trash steps, and until entry 110 nothing said which
files those were. The confirmation counted conversations and gave three byte
figures; the transcript, its sidecar directory and its released marker were in
the figures and named nowhere. [ADR-0016](0016-desktop-session-boundary.md)
requires the opposite: name the exact candidates and the data that remains,
before the confirmation exists.

`SessionTrashPreview` therefore carries `candidates` — one
`SessionRemovalCandidate` per selected session, holding the transcript and, when
present, the sidecar and the marker — and `projects`, the rows the selection
spans. Both are display text, tildified outward like every other display path
in the contract. They travel one way: no handler reads one back, and they
authorize nothing. The token and the previously emitted ids remain the only
things that do, and revalidation is unchanged.

They are built from the same inventory records `sessionTrashPlan` walks, after
`snapshotSessions` has already refused a uuid namespace holding anything the
plan did not claim. A disclosure and a plan describing two different sets is
therefore not a state this code can reach; a session the inventory no longer
holds refuses the whole preview rather than producing one row short.

The renderer prints at most 20 candidates and then a count. The figures below
them still cover the whole selection, and what a review is worth in bytes is
unchanged by the disclosure. The list of records that remain — prompt history,
snapshots, file history, backups, kondo's own trash and journal — is renderer
copy, true of every removal; only the Desktop line is conditional, on
`SessionSummary.mirroredIn`, and it says the other store holds a file named
with the same ID rather than a copy of this conversation.

## Journal and Undo

The serial queue inside `createMutations` serializes mutation, Undo and
empty-trash execution. Otherwise two distinct valid tokens could both validate
a duplicate group before either removal ran, removing every copy. The queued
operation revalidates when it actually reaches the write path. This queue is
local to the process.

A stale review writes neither a mutation entry nor store bytes. Accepted plans
retain ADR-0001: journal first, displace to Kondo trash, preserve Undo. An I/O
failure after the journal is appended continues to use the existing failure
record and recovery rules; it is not labeled a preflight refusal.

## Cost and limits

Removal review pays for validation of the candidate trees, including content,
that a normal listing avoids under ADR-0007. This is explicit removal work,
not a new startup scan. Reviews expire after 15 minutes; main retains at most
128 reviews and 8 MiB of serialized review data. Tokens are single use;
reopening a review is the recovery for a token that main no longer holds.

The store has no transaction shared with Claude or another filesystem writer.
Path validation, hashing, journal append and relocation are separate operations.
A writer can still change the filesystem after the last preflight observation.
These checks establish tested preconditions, not elimination of every concurrent
filesystem race. General process activity detection and cross-process locking
remain separate concerns.
