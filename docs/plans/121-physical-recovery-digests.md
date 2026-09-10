# Plan: framed physical recovery digests

Status: **done**

Physical relocation previously hashed JSON entry metadata immediately followed
by arbitrary file bytes. Different trees can therefore share one encoded byte
stream. Move and Undo recovery must identify a framed physical format before it
uses a persisted fingerprint as evidence.

## Scope

- Frame sorted physical directories, files and links with a versioned domain,
  typed records, UTF-8 path and link-target lengths, and declared file lengths.
- Keep file content streaming, verify the opened file matches the inventory and
  that exactly the declared bytes were read, and retain the existing boundary
  and change-during-read checks.
- Persist new move fingerprints as `physical-v2:<hex>`. Keep legacy journal
  rows readable, but refuse bare pending evidence and fingerprints whose type
  does not match their copy or move action before endpoint reads or writes.
- Preserve completed legacy history, logical `tree-v2` copy recovery, link
  identity, EXDEV copy verification and the settings execution restriction.

## Out of scope

No IPC, renderer, store-locator, dependency or journal migration change. This
does not make pathname checks atomic against another writer or establish
power-loss ordering.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Use a `kondo:physical-v2:` domain and 64-bit big-endian byte lengths. | Typed, length-delimited records cannot be repartitioned into another tree. |
| 2 | Frame file length once, then stream and count content bytes. | Digest identity stays independent of short-read chunk boundaries without buffering whole files. |
| 3 | Accept known fingerprint syntax when parsing, then require the action's matching prefix during recovery. | Historical rows remain visible while ambiguous or mismatched evidence never authorizes endpoint changes. |
| 4 | Do not reinterpret or rewrite completed legacy checkpoints. | Explicit completion remains the historical authority and the journal stays append-only. |

## Seam changes

None. Fingerprint prefixes remain internal journal data.

## Tests

Reproduce the physical metadata/content collision directly. Cover equal framed
trees, binary and empty entries, link target identity, short streamed reads and
inventory-length changes. Exercise EXDEV corruption refusal and restart recovery
for pending forward moves and pending Undo with direct byte, no-write and
no-journal assertions. Confirm typed copy/move mismatch refusal and completed
legacy readability.

## Done when

Distinct physical trees produce distinct digests, new move and Undo checkpoints
name the physical format, and unverifiable pending evidence leaves every endpoint
and journal byte unchanged while completed legacy operations remain undoable.

## Observed implementation

The synthetic collision produced an identical digest before framing and is now
distinct. Physical digests remain equal across 7-byte short reads and include
binary, empty, directory and link entries. A growing file is refused after the
first byte beyond its inventoried length. New forward and Undo moves persist the
physical prefix. Bare legacy and action/prefix mismatch regressions observe no
endpoint content reads, mutation calls or journal changes, including source-only,
destination-only and pending Undo states. A completed legacy move with an earlier
bare checkpoint remains undoable. Checkpoint transitions reject typed mismatches
before advancing or clearing them, so forged completion and same-cursor failure
rows cannot establish completion, `undoneBy` or replay authority. The focused
relocation and mutation suites pass with one explicit Windows file-link privilege
skip.

Native verification after the independent review correction: 726 fixture tests passed with 14 existing Windows file-symlink privilege omissions; typecheck, lint, guards, build and 26 Electron smoke tests passed. The independent review found no remaining actionable issue. Combined verification with task 122 passed 730 fixture tests with the same 14 omissions. The owner accepted the reviewed candidate `1f29f3f` and authorized local integration into `main` on 2026-09-10.
