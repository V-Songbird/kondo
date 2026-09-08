# Plan: Desktop session boundary and removal scope

Status: **done — decision accepted by the owner; no behavior changes**

## Decision

Choose an explicit partial, read-only **Desktop session** boundary. Kondo's
conversation management covers Claude Code transcripts. Desktop contributes
store metadata and filename matches; it has no session browsing or removal UI.
Existing allowlisted Desktop cache cleanup remains a separate operation.
[ADR-0016](../adr/0016-desktop-session-boundary.md) records the alternatives.

This package corrects public claims and specifies follow-up acceptance criteria.
It does not implement a unified inventory, expand mutations, or establish that
removing local files erases a conversation. Acceptance of this decision does not
accept a release or authorize a future storage expansion.

## Evidence and limits

Reviewed against baseline `b028598cd5ba1bd383fd0630027b73bf64689a2e`.
The local publication audit's Desktop and residual-data findings still hold:

| Claim | Current source evidence | Meaning |
|---|---|---|
| Desktop has a listing API | `desktop-store.ts`: `desktopSessions`; `kinds.ts`: `desktopSession`; `workspace.ts`: `desktopSessions`; `shared/contract.ts` and preload wiring | Metadata for `local_<stem>.json` and its matching directory, including sizes, mtime and account; no transcript content read by this adapter. |
| The UI is unified | `rg -n 'desktopSessions' src` has no matches; `entityList` consumers in `src/features/library/library.tsx` request other kinds; `SessionTable` in `src/features/projects/projects.tsx` receives Code summaries | The README's former unified inventory and arbitrary cross-store selection claims were unsupported. Desktop-only sessions are absent from this UI. |
| A Desktop match is a verified duplicate | `desktop-store.ts`: `desktopSessionStems` collects lowercased filename stems across devices/accounts; `sessions.ts`: `toSessionSummaries` sets `mirroredIn` | A matching identifier is evidence of another local record, not equal contents, completeness, or a safe backup. A missing match is not proof no copy exists. |
| Desktop sessions can be removed | `capabilities.ts`: session desktop row denies trash; `kinds.ts`: `sessionTrashPlan` rejects Desktop IDs; `workspace.ts`: `sessionDetail` only accepts Code IDs | A read API is not a managed Desktop workflow. Mixed selections must also refuse. |
| Code removal clears every trace | `kinds.ts`: `sessionTrashPlan`; `tidy.ts`: session paths, `SESSION_ENV`, `RECLAIMABLE`, `CHROMIUM_CACHES` | Removal moves a bounded set of files, with separate cleanup categories and residuals listed below. |

Source paths above are under `electron/main/workspace/` unless fully named.
Existing fixture coverage includes `test/desktop-store.test.ts` (metadata and
partial failures), `test/kinds.test.ts` (capabilities and bridge listing),
`test/session-duplicates.test.ts` (matches, Desktop refusal, selected removal,
Undo and changed-review refusal), `test/tidy.test.ts` (released markers,
orphan snapshots, cache exclusions and Undo), and `test/boundary.test.ts`.
Code inspection and synthetic fixtures establish Kondo behavior, not current
Claude format compatibility or complete coverage of Claude's retained data.
No real Claude store or network service was inspected for this decision.

## Exact removal scope

This table describes **selected Code session removal**, then distinguishes
other existing cleanup actions. Paths are relative to the selected Code user
store unless prefixed with Desktop or Kondo. It is not a deletion allowlist for
new work.

| Item | Selected Code removal today | Residual / separate action |
|---|---|---|
| `projects/<project>/<uuid>.jsonl` | Moves the selected transcript to Kondo trash. | Other transcripts, including similar openings in the same project, remain unless separately selected. Similarity is not full-content equality. |
| `projects/<project>/<uuid>/` sidecar | Moves the entire recognized sibling directory when present, including its saved subagent/support files. | Unassociated files and other locations are not inferred from transcript contents. |
| `projects/<project>/<uuid>.desktop-released.json` | Moves the associated marker when present. | The scanner recognizes the filename; it does not verify the marker's reason or prove a Desktop/cloud deletion. |
| `session-env/<uuid>/` | Remains. | A later fresh Clean up preview can offer a UUID-shaped directory with no transcript in the Code inventory. This is a separate reviewed, journaled operation, not a session-removal cascade. |
| `history.jsonl` | Remains byte-for-byte; no session-specific splice. | Global prompt history can retain prompts and session references. No purge is proposed. |
| `file-history/` | Remains; excluded from the user cache allowlist. | Checkpoint/rewind data may retain edited content; session ownership and safe pruning are unverified. Keep untouched. |
| `backups/` | Remains; excluded from the user cache allowlist. | Retention and per-session ownership are unverified. Keep untouched. |
| Desktop `local-agent-mode-sessions/.../local_<uuid>.json` and directory | Remain, even when a Code row says `also in desktop`. | Shared account artifacts, cowork caches, other Desktop session locations and state also remain. No Desktop session removal is supported. |
| Code caches/support data | Remain in this action. | Separate Clean up can select only the existing `cache`, `paste-cache`, `debug`, `downloads`, `shell-snapshots`, `telemetry` directories. That sweep is not session-aware or proof of erasure. |
| Desktop Chromium caches | Remain in this action. | Separate guarded cleanup offers `Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `Shared Dictionary` at the root and under `Partitions/<name>`. Desktop session data, VM bundles, unknown caches and other Chromium state remain outside that allowlist. |
| Kondo `trash/`, `journal.jsonl`, `scan-cache/` | Trash retains displaced bytes for Undo; journal records the operation. | No automatic trash expiry. Emptying trash removes those retained files and loses their Undo; journal/cache data are separate. No secure-erasure claim. |
| Cloud, exports, OS backups/snapshots and files outside approved roots | Outside this operation and Kondo's control. | Copies may remain; Kondo neither inventories nor erases them. |

Whole-project Clean up categories are broader: they move the reviewed
`projects/<project>/` saved-data tree, including its other contents. Orphan
sidecars/markers are separate candidates. Neither action means clearing the
global history, backups, file history, Desktop copies or cloud data. Neither
removes the actual project directory outside the approved Claude storage roots.

Unknown or ambiguous companions in the selected UUID namespace make
`workspace.ts`'s `snapshotSessions` refuse the review. They are not silently
included or ignored. Kondo's persistent scan cache can retain derived prompt
data and source paths after removal (`scan-cache.ts`); it is not purged by
`sessionTrash` or `emptyTrash`.

Undo is the recovery mechanism for retained, successfully moved bytes under
ADR-0001; it is not an atomic filesystem transaction or an erasure reversal.
Partial failure and concurrent-writer limits still apply. The pending Undo
outcome work (099) and concurrent-splice work (098) remain separate.

## User-facing contract and follow-up work

The README exposes the boundary and residuals now. The current renderer still
uses `deleted in desktop app`, `same work recorded twice`, and `saved supporting
files`; these strings overstate or underspecify the source evidence. Production
copy and interaction changes belong to the existing product-guarantee
reconciliation (110), with 108 accepted and its other recorded dependencies
(107 and 109) still governing dispatch. This is future work, not a claim that the UI is corrected here.

Acceptance criteria for that follow-up:

1. Projects/Conversations states that rows are Code transcripts. A Desktop
   filename match reads as a matching ID with unverified contents; a released
   marker reads as a marker, without asserting that every Desktop copy is gone.
   Do not display a missing match as proof of absence.
2. Before removal, disclose the exact candidate transcript, present sidecar and
   marker, and the retained history, snapshots, file history, backups, Desktop
   copies and Kondo trash. Show the selected project/session identities and a
   readable, bounded candidate list. Suggested copy: "Move these Code transcript
   files and the listed companions to Kondo's trash. Other records and copies
   may remain. This does not erase the conversation. Undo is available while
   the required trash data remains."
3. Preserve main-owned opaque IDs and review tokens, fresh candidate validation,
   changed-content/activity refusal, and serialization with mutation/Undo from
   102 / ADR-0015. If exact file descriptors require a seam addition, update
   `shared/contract.ts`, workspace, IPC/preload and renderer together. Expose
   display-safe descriptors, never arbitrary filesystem authority or secrets.
4. Coordinate total moved-byte claims with 105 (which depends on 102). Until
   companion sizes are included, a transcript size must not be labeled the full
   removal size. Reuse reviewed identities when joining size and scope data.
5. Use existing Signal components, explicit confirmation, reachable controls,
   visible focus, accessible names, Escape/cancel and focus return to the trigger
   or a stable successor. A stale selection requires a new review. Perform the
   bounded Impeccable detector review if UI source changes in that future task.
6. Use synthetic fixture sessions with every table residual, a mirrored Desktop
   record, unknown siblings, and a released marker of unknown contents. Assert
   exact moved paths, byte preservation of all residuals, Desktop/mixed-ID refusal
   without journal writes, and Undo restoration. Check changed companions and
   transcripts between review/apply. UI fixtures verify disclosure, candidate
   names, keyboard cancellation/confirmation and focus return; a green unit suite
   alone does not establish those UI outcomes.

No expanded session mutation is recommended. Reopening unified Desktop/Code
management requires a separate owner-approved decision: fixture schemas and
ownership/retention evidence for every Desktop candidate and shared artifact;
main-process-only planning through the existing locator and typed seam; scoped
device/account identity; exact reviewed candidates with final revalidation;
journaled displacement, partial-failure reporting, collision-safe Undo and
byte-exact fixture recovery. Unknown VM bundles, unknown caches, identity/token
contents and files outside approved roots remain excluded. A filename match
alone cannot authorize deletion. No cloud calls or project-file access are added.

## Verification checklist

Run the four acceptance rows in order; diagnostics do not authorize code fixes.

- [x] `npm test` — 40 files passed; 604 tests passed, 14 skipped because this
  Windows host cannot create file symlinks (EPERM). No code/test changes.
- [x] `npm run typecheck` — passed (exit 0).
- [x] `npm run lint` — passed (exit 0).
- [x] `git diff --check` — passed, no whitespace errors.

`npm run guards` passed with no findings; before staging, its two paired-change
checks reported that no change set was staged. Decision links and the README
scope anchor resolve. An independent source review found no material scope
inaccuracies. No production source, test files, dependencies or real stores were
changed. UI behavior and new mutation recovery are future acceptance criteria,
not checks claimed by this documentation task. The owner accepted the decision
and requested local integration into main and deletion of the task branch.
