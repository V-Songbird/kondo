# Plan: unambiguous logical tree digests

Status: **implemented — awaiting acceptance**

Identical skill manifests plus `a=bc` versus `ab=c` currently produce the same
logical tree digest. The concatenation loses filename/content boundaries, so
duplicate review and copy verification can accept different trees.

## Scope and decisions

- Keep SHA-256 and the public 64-character hexadecimal digest. Hash a versioned
  domain followed by sorted records containing entry type, full relative UTF-8
  path and length-delimited file bytes. Include empty directories and root type.
- Preserve strict tree preflight, owning-store validation before each read,
  safe internal link materialization and partial-scan errors.
- Audit `skillDuplicates`, `snapshotSkillGroup`, `verifyCopy`, `fingerprint`,
  `execute` and `reconcile`. Version new logical pending fingerprints in journal
  v2. Refuse old unframed pending copies with visible uncertainty, retaining all
  bytes and the original journal. No legacy-hash fallback or history rewrite.
- Preserve completed historical operations and physical move/Undo fingerprints.
  The settings write/splice and mixed historical Undo restriction (098) remains.

## Seam and exclusions

No IPC, renderer, dependency or path-authority change. Physical relocation
digests, overlapping roots (115) and DTO secrets (117) are separate work.

## Verification

Reproduce through the public workspace API before changing production code.
Regress filename/content and cross-entry ambiguity, root types, binary and empty
files, nested paths, identical trees, review refusal without effects/journal,
copy corruption retention, copy/Undo round trips, upgrade and restart recovery.
Retain existing internal/external link coverage. Extend Electron fixture smoke
with the collision case and run under an exclusive desktop turn.

Run full Vitest with at most two workers, typecheck, lint, staged documentation
guards, build, Electron smoke and `git diff --check`. Report Windows evidence,
actual skips and unavailable checks; coordinator owns acceptance and roadmap.

## Observed result (Windows, 2026-09-09)

The two ambiguous-concatenation regressions and substituted-copy regression
failed on the original implementation and pass with framing. Production changes
are confined to `scan.ts` and `mutations.ts`; `kinds.ts` already consumes the
shared logical digest and needs no edit. A new pending copy also refuses a
post-interruption `a=bc` to `ab=c` substitution. Completed historical copies,
permitted moves and byte-exact Undo remain covered, including binary and empty
contents. The 098 settings restriction remains exercised by the full suite.

- `npm test -- --maxWorkers=2 --minWorkers=1`: 41 files, 689 passed and 14 skipped.
  Skips require unavailable Windows file-symlink privileges; directory-junction
  coverage ran. This is not native macOS/Linux evidence.
- `npm run typecheck`, `npm run lint`, staged `npm run guards`, `npm run build`
  and `git diff --check` passed. Build required the normal sandbox escalation
  after esbuild was denied access to a parent directory; no code workaround.
- `npm run test:e2e`: 25 passed, no skips, with the exclusive Electron turn.
  The initial sandbox launch exited before tests with GPU startup errors; the
  same smoke passed with normal escalation, unchanged assertions and timeouts.
  The affected test verifies distinct digests, no usable review token, disabled
  removal and unchanged fixture/journal on direct refusal. Genuine equality
  restores keyboard review and Undo. Chalk/Carbon captures at 1360×860 and
  900×600 show the existing differing-copies message without overflow; fixture
  byte checks and renderer focus/error/network assertions passed.

Separate synthetic probes confirmed ambiguous encodings in `physicalDigest`
and the test helper `hashTree`; evidence was returned to the coordinator for
separate tracking. Those helpers were not changed. Critical new assertions also
observe exact paths, bytes and writes instead of relying on `hashTree` alone.
