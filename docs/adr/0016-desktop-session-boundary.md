# Keep Desktop sessions read-only and name removal scope

Status: **accepted by the owner — decision 108**

Choose partial, read-only Desktop session support. Kondo manages selected Claude
Code transcripts; Desktop contributes local store metadata and filename ID
matches. It does not provide a Desktop session browsing/removal workflow. Keep
the existing allowlisted Desktop Chromium-cache sweep as a separate capability.

The current code supports this boundary: `desktopSessions` has a typed bridge
but no renderer consumer; the Desktop session capability row denies mutations;
`sessionTrashPlan` rejects Desktop IDs. `desktopSessionStems` matches identifiers
without reading contents or retaining account/device provenance in the match.
That is insufficient evidence for automatic duplicate removal or unified
management. The [108 plan](../plans/108-desktop-session-boundary.md) records the
current paths, itemized residuals and fixture evidence.

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
- State retained data before any future removal confirmation and name the
  exact candidates. Preserve Signal controls, keyboard access, cancellation,
  visible focus and focus return. In-app copy work is assigned as follow-up to
  product reconciliation 110; no production UI changes ship in this decision.
- Keep disk I/O and final review validation in main, behind the typed bridge
  and owning store locator. Follow ADR-0002's approved roots and named
  exceptions, ADR-0008's opaque IDs and ADR-0015's reviewed state. No new
  filesystem access or network call is authorized by this decision.
- Unknown VM bundles, unknown caches, file-history/backups and shared Desktop
  session artifacts stay outside new deletion work until independently
  verified. Existing cache cleanup does not become session-aware erasure.
- Keep journaled displacement and Undo for retained bytes, with partial-failure
  and concurrent-writer limits visible. Emptying trash removes its recovery
  copies; it does not clear the journal, scan cache or external records.
- Reopening Desktop mutations requires a new owner-approved decision and the
  schema, candidate revalidation, journal/Undo and fixture criteria in the plan.
  Decision acceptance alone does not authorize that expansion.
