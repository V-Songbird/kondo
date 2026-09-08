# Plan: bind removal to reviewed candidates

Status: **implemented — awaiting acceptance**

Task 102 follows audit A5/A9/A11. At baseline debcc319, the workspace rescanned
cleanup categories on apply, used cached session inventory for removal, and
removed a duplicate skill without checking the previously displayed group.

## Scope

Main owns opaque, bounded, single-use review tokens for cleanup previews,
selected session removals, and duplicate-skill groups. Applying a token resolves
the same identities and validates content, activity, membership and equivalence
before the journal or store is written. Renderer confirmation retains its token
and shows an accessible refusal that returns to a fresh review.

## Decisions

| Decision | Reason |
|---|---|
| Main retains candidates and preconditions; IPC carries opaque tokens | Renderer input cannot manufacture deletion candidates |
| Changed selected sets refuse whole before journaling | A review never silently expands or becomes a partial deletion |
| Re-read inventory and candidate policy at apply | Parent-directory cache fingerprints do not detect resumed transcripts |
| Preserve journal-first displacement and Undo | Actual operations retain the existing recovery mechanism |
| Document residual pathname races | Preflight does not provide filesystem transactions against other processes |

## Seam changes

Tidy previews and duplicate groups carry review tokens. Session selection gets
a dedicated preview call. Sweep, session trash and duplicate skill trash require
the corresponding token. Wire contract, main IPC, preload and renderer together.
Errors distinguish stale reviews from ordinary scan failures.

## Out of scope

Other audit findings, configuration-orphan cleanup policy, general session
activity detection, redesigns and cross-process filesystem locking.

## Verification checklist

- [x] Focused tidy/session-duplicate/skill-duplicate regressions: additions,
  changed or resumed sessions, changed groups, unknown tokens, unchanged apply/Undo.
- [x] Full fixture-only `npm test`: 604 passed, 14 Windows file-symlink skips (40 suites).
- [x] `npm run typecheck`.
- [x] `npm run lint`.
- [x] `npm run build`.
- [x] `npm run test:e2e`; light/dark, normal/compact refusal review with keyboard
  focus and long labels; one bounded Impeccable detector pass.
- [x] `git diff --check` and inspect token ownership, refusal-before-write,
  journal/Undo preservation. Run repository guards required by CONTRIBUTING.md.

## Done when

Cleanup acts only on unchanged reviewed candidates. Any stale review explains
why nothing moved and offers renewed review, with no destructive choice made
automatically. Verification and remaining limits are recorded for acceptance.

## Execution evidence

- Working branch: `codex/102-reviewed-cleanup`; clean ownership baseline
  `debcc319d0a085c11cadbe2a7310d95299ae5824`.
- Impeccable context preserved Signal. One `detect --json` pass over the changed
  tidy, duplicate, review-refusal and projects components returned `[]`.
- Workspace/IPC/boundary/journal integration pass: 47 passed, 13 Windows
  symlink skips. Desktop smoke separately passed all 22 cases.

- Exact focused command `npm test -- test/tidy.test.ts test/session-duplicates.test.ts test/skill-duplicates.test.ts`: 127 passed. Initial run had three fixture/assertion failures; fix attempt 1 passed.

- Desktop smoke: `npm run test:e2e` passed 22/22 after correcting one test-only focus assertion (cleanup returns focus to an h3). Captured and visually inspected all 12 stale cache/session/duplicate screens in Chalk and Carbon at 1360×860 and 900×600. Refusal text, long location labels and focused Return to review controls remained readable; smoke checks also verified accessibility, Escape, cleared selection and renewed review/Undo.
- Lint passed again after the smoke assertion correction. Verification logs and screenshots are retained locally under `.foreman/evidence/102/`.
- Discovery: approved shared read-only-open observer improvement recorded as planned roadmap entry 116; broader historical foundations claims are already covered by entry 110.
- Residual limit: external filesystem writers can change state after final preflight; the workspace mutation queue only serializes Kondo operations.

- Final source review confirmed main-only tokens, exact selected-tree and group snapshots, revalidation after step planning and before journal append, and serialized mutation/Undo. `git diff --check`, staged whitespace check and `npm run guards` passed; guards reported no findings.
