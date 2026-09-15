# Keep Desktop sessions read-only and name removal scope

Kondo supports Desktop sessions partially and read-only. It manages selected
Claude Code transcripts; Desktop contributes local store metadata and filename
ID matches. There is no Desktop session browsing or removal workflow. The
allowlisted Desktop Chromium-cache sweep is a separate capability.

The code holds this boundary: `desktopSessions` has a typed bridge but no
renderer consumer, the Desktop session capability row denies mutations, and
`sessionTrashPlan` rejects Desktop IDs. `desktopSessionStems` matches
identifiers without reading contents or keeping account/device provenance,
which is insufficient evidence for automatic duplicate removal or unified
management. The itemized residuals are in
[domain.md](../domain.md#session-removal-scope).

## Considered options

- **Supported unified Desktop/Code management.** Rejected for this product
  boundary: session ownership, shared artifacts, concurrent Desktop writes and
  retention are not sufficiently understood. It needs a separate design,
  main-process planning and fixture recovery proof, not merely wiring an API
  into the renderer or allowing Desktop IDs.
- **Partial, read-only Desktop sessions (chosen).** Matches the implemented
  storage knowledge and mutation capabilities. Keeps useful metadata while
  making the absence of Desktop browsing/removal explicit. Costs a narrower
  product claim and leaves Desktop-only conversations unmanaged.
- **Remove every trace of a conversation.** Rejected: a local transcript is
  only one record. Global history, snapshots, file history, backups, shared
  Desktop data, Kondo retention and external/cloud copies can remain. Kondo's
  no-network and approved-root boundaries cannot establish complete erasure.

## Consequences

- Describe selected Code removal as moving the named transcript, present
  recognized companion directory and released marker to Kondo trash. Describe
  whole saved-project cleanup separately. Do not promise complete removal,
  secure erasure, or equal contents from an ID/first-prompt match.
- A released marker is evidence of a filename the scanner recognizes, not
  proof that the Desktop app or cloud has removed every record. Missing
  Desktop matches cannot establish absence outside the scanned layout.
- Before any removal confirmation, name the exact candidates and the data that
  remains, with Signal controls, keyboard access, cancellation, visible focus
  and focus return. The in-app wording that follows this boundary is open work
  (entry 110 in [ROADMAP.md](../../ROADMAP.md)).
- Keep disk I/O and final review validation in main, behind the typed bridge
  and owning store locator. Follow ADR-0002's approved roots and named
  exceptions, ADR-0008's opaque IDs and ADR-0015's reviewed state.
- Unknown VM bundles, unknown caches, file-history/backups and shared Desktop
  session artifacts stay outside new deletion work until independently
  verified. Existing cache cleanup does not become session-aware erasure.
- Keep journaled displacement and Undo for retained bytes, with partial-failure
  and concurrent-writer limits visible. Emptying trash removes its recovery
  copies; it does not clear the journal, scan cache or external records.

## Reopening Desktop mutations

Needs a new owner-approved decision with: fixture schemas and ownership and
retention evidence for every Desktop candidate and shared artifact;
main-process-only planning through the locator and typed seam; scoped device
and account identity; exact reviewed candidates with final revalidation; and
journaled displacement, partial-failure reporting, collision-safe Undo and
byte-exact fixture recovery. Unknown VM bundles, unknown caches, identity and
token contents and files outside approved roots stay excluded, and a filename
match alone cannot authorize deletion.
