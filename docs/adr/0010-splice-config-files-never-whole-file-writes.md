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

Original decision (superseded for execution by amendment 098 below): a
`splice` step. It names a store, a path, the digest of the bytes
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
- **Splice with a digest refusal (originally chosen).** Preserves formatting
  and detects changes before its read, but cannot prevent a writer changing
  the target between that read and replacement. The original claim that this
  could not lose an unplanned byte was incorrect; see amendment 098.

## Original consequences (execution suspended by 098)

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

## Historical amendment: resolved targets and temporary durability (074)

Mutation paths are checked lexically and against the resolved store root.
For a missing destination, resolution walks to the nearest existing ancestor;
a dangling link is a refusal, not permission to create its unchecked target.
The `user-config` store remains exactly the named registry file under its
resolved parent: a link to another home-directory file is not allowed.

A splice reads and digest-checks the resolved file, then replaces that file
through a temporary sibling. In-store file links and parent-directory links
retain their identity through splice and undo. Move and trash operations keep
their directory-entry semantics after containment validation.

Temporary files are opened with `wx`, written through the handle, synced and
closed before rename. On a handled failure, closure and removal are attempted;
the original error wins if cleanup also fails. A failed exclusive open does
not grant ownership of an existing temporary file. Cleanup removes only
Kondo's temporary bytes, never an original store file.

This narrows failure windows; it is not a transaction with other writers.
Node's path-based calls still permit a path or content change between checks
and use. The parent directory is not synced, so the rename's survival across
power loss is not guaranteed. A process crash can leave a temporary sibling,
and a filesystem that refuses cleanup can leave one after a handled failure.
These target checks do not audit links nested inside recursive copy trees or
change the separate scanner read paths.

## Amendment: refuse settings replacement until preservation is proven (098)

The digest check and the replacement are separate operations. A writer can
replace the target after Kondo's final read and before its rename. The rename
then overwrites bytes Kondo never read. The same race affects inverse splices
during Undo. Synchronizing the temporary file protects its contents; it does
not preserve the competing writer's contents. Node's path-based rename does
not condition replacement on the digest or retain the displaced target for
recovery.

**Current decision:** refuse every mutation plan containing a `write` or
`splice` step on every platform. Refuse the whole plan before step preparation,
journaling, temporary-file creation or any store mutation, including a plan
that also contains moves or trash steps. Creating a missing settings file is
not an exception: another process can create it before Kondo publishes its
planned contents. Confirmation to create a layer does not bypass this gate.

Undo applies the same gate to historical entries containing either step,
before journal or filesystem effects. Existing journal records, inverse edits
and recovery bytes remain intact; refusal neither records completion nor
claims a successful reversal. It also cannot partially reverse the move or
trash portions of a mixed historical entry. Unrelated moves, trash operations
and their Undo remain available under their existing checks.

This temporarily disables settings-based skill, plugin and MCP toggles,
plugin scope moves and clearing overrides, configuration-leftover removal,
and skill moves that also change settings. Read-only discovery and pure plan
construction remain useful; a convention-level capability or a returned plan
does not imply execution is currently permitted. Kondo's own appearance
preference is outside this store-mutation gate.

The active safety guarantee is refusal before effects, not atomic settings
replacement. There is no platform-specific preservation backend in this
amendment. A future backend must demonstrate preservation of competing writes
and honest recovery on native failure paths before execution is re-enabled.
Another hash check, an advisory lock that other writers do not share, asking
the user to close Claude, or a forced-write option cannot substitute for that
proof. Historical splice and link-handling details above describe the previous
implementation and planning format, not an available safe execution path.


## Amendment: require complete and compatible absence evidence (100)

A settings key is not leftover merely because Kondo's local catalog lacks it.
Plugin installation reads retain completeness separately from rows; partial or
unsupported data preserves healthy entries and errors without authorizing
absence. Missing-plugin candidates require a complete version-2 inventory and
positive marketplace identity. Directory, inline, synced and unknown sources
are retained, including their explicit disable preferences.

Skill overrides contain no source identity. Kondo cannot enumerate all bundled,
managed, command and additional-directory sources, so it preserves every skill
override. Maintaining a list of known bundled names was rejected: a new Claude
skill would silently turn a valid disable preference into a cleanup candidate.
This sacrifices automatic removal of obsolete overrides to avoid changing intent.

Both preview and action force fresh project-location inventory and read plugin
records again: a recreated project need not change the cache fingerprint. If a requested
candidate is now uncertain, the plan refuses the entire selection; it does not
remove just the other members. Proved dead registry entries and their attached
MCP declarations remain independent of plugin errors. This is a classification
and planning decision; **098 still refuses settings execution and historical
settings Undo before effects and journaling**.
