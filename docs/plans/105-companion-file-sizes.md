# Plan: every companion file counted in removal size estimates

Status: **in progress**

Clean up and the session-removal confirmation both quote a size, and neither
one is the size of what moves. A session candidate carries its transcript, its
sidecar directory and its `.desktop-released.json` marker into the same trash
step set, but the preview reports only the transcript's bytes; the audit's A10
case measured a transcript with 5,000 bytes of companions and watched the trash
end exactly 5,000 bytes larger than the number the screen had shown. This slice
makes every figure come from the trash steps the review token binds, and splits
the one number into the three a reader actually needs: what moves, how big
kondo's trash becomes, and what a permanent empty would then free.

## Scope

**workspace.** A new `reviewedBytes` in `reviewed-removals.ts` sums the
regular-file bytes under the `trash` steps of a planned removal, the way the
trash counts its own occupancy. `tidy.ts` measures each category through the
same per-category plan `tidyPreview` already snapshots, carrying one set of
counted paths across categories so no path is measured twice. `workspace.ts`
supplies the store roots and the current trash size, and marks a preview
incomplete when a reviewed path could not be read or no review token was
issued. `kinds.ts` is untouched: `sessionTrashPlan` already names every
companion path, which is what makes this measurable at all.

**seam.** `RemovalSizeEstimate` carries the three figures and the incomplete
marker. `TidyPreview` gains one for the whole preview and a per-category
moving-bytes figure whose meaning changes; `SessionTrashPreview` gains one for
its exact selection.

**renderer.** Clean up shows the three figures for the current selection and
labels an incomplete preview. The session-removal confirmation shows the same
three for the sessions picked, so the companion bytes are on screen before the
move.

## Out of scope

- Fresh candidate validation, serialization with mutation and Undo, and the
  review-token lifetime: unchanged ([ADR-0015](../adr/0015-bind-removal-to-reviewed-state.md)).
- What moves. Settings writes keep refusing whole under 098; this slice changes
  what a move is measured as, never what a move is.
- A live trash figure that follows a sweep without a fresh read. The store is
  the state ([ADR-0006](../adr/0006-native-conventions-over-invented-state.md));
  the preview reloads.
- Wording for the product claims of 110. This slice keeps its own copy short
  and factual, and 110 reconciles the vocabulary across screens.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Every figure is measured over the deduplicated `trash` steps of the plan the review token binds — `tidyPlan(candidates, [category])` per category, `sessionTrashPlan(ids)` for a selection — and never from a second walk of the store. | A number derived from anything other than the bound step set can disagree with what actually moves, which is the whole of A10. |
| 2 | Bytes are summed with `inspectPhysicalTree`, counting regular files and giving directories and links zero, exactly as `readTrash` counts the trash. | The estimate predicts a trash figure, so both have to come from one rule or the trash cannot grow by exactly the estimate. |
| 3 | `Candidate.bytes` and the `directorySize` calls that filled it are deleted; the reviewed measurement replaces them. Read failures reach the collector through `inspectPhysicalTree`'s `onError`, as they did through `directorySize`. | One walk of the candidate set instead of two, and the byte source becomes the step set rather than a parallel scan that could drift from it. |
| 4 | Category figures are disjoint by construction: measurement carries a running set of counted `store` + path keys, and a path already counted — or nested under one — contributes nothing to a later category. | The renderer adds the selected categories together, so their sum has to be the union of their paths. |
| 5 | The seam carries `movingBytes`, `trashBytesBefore`, `trashBytesAfter` and `freedOnEmptyBytes` as four named fields rather than one number and a note. `freedOnEmptyBytes` equals `trashBytesAfter` because kondo's trash holds nothing but displaced bytes, and both are carried so the renderer never has to know that. | Moving frees no disk space; only a permanent empty does. A single "size" invites the reader to assume it is the space they get back. |
| 6 | A preview is `incomplete` when a reviewed path could not be read, when the trash itself could not be measured, or when no review token was issued. | A figure nobody can stand behind has to say so on screen rather than read as exact. |
| 7 | **Supersedes plan 006 decision 7**, folded into [domain.md](../domain.md) as "The tidy preview does not count sidecar bytes beside a session it offers, because measuring them would walk `projects/`; an orphan sidecar is measured." That sentence is replaced by what the preview now does. | The cost it avoided is already paid: `tidyPreview` hashes every byte of every candidate path through `snapshotRemovalTree` to build the review signatures, so a sidecar beside an offered session is fully read at preview time either way. Measuring it is strictly cheaper than the read that already happens. |
| 8 | `TidyCategoryPreview.bytes` keeps its name and changes meaning, with its contract comment rewritten. | Entry 106 edits the same file; a rename would collide for no gain, and the field already means "what this category's size is". |

## Seam changes

`shared/contract.ts` gains one interface and two fields, and rewrites one
comment:

- `RemovalSizeEstimate` — `movingBytes`, `trashBytesBefore`, `trashBytesAfter`,
  `freedOnEmptyBytes`, `incomplete`.
- `TidyPreview.estimate: RemovalSizeEstimate` — the whole preview's figures.
- `SessionTrashPreview.estimate: RemovalSizeEstimate` — the selection's.
- `TidyCategoryPreview.bytes` — same field, now the reviewed moving bytes with
  companions counted; its comment drops the uncounted-sidecar caveat.

No method signature changes, so IPC channels and the preload bridge are
untouched. Recorded in
[ADR-0015](../adr/0015-bind-removal-to-reviewed-state.md), which already owns
what a review binds.

## Tests

`test/tidy.test.ts`:

- A10 inverted: a stale transcript with a 5,000-byte sidecar and marker beside
  it previews `transcript + 5,000` under `stale-sessions`, and a confirmed
  sweep grows the fixture trash by exactly `preview.estimate.movingBytes`.
- A combined sweep of every category grows the trash by exactly the sum of the
  category figures, with a session that is both empty and stale in the fixture,
  so a double count would show.
- Each category's figure equals the bytes its own displaced fixture paths held.
- `estimate.trashBytesAfter` equals `trashBytesBefore + movingBytes`, and
  `freedOnEmptyBytes` equals what `trashEmpty` reports after the sweep.
- A preview whose candidate read fails reports `incomplete`, and so does one
  that could not be issued a review token.

`test/session-duplicates.test.ts`:

- A selection whose transcript carries a sidecar and a released marker previews
  `movingBytes` equal to all three, not the transcript alone, and the trash
  grows by exactly that.
- The preview names the same three figures the sweep's trash reports.

## Done when

Clean up and the conversation-removal confirmation each say how many bytes will
move, how large kondo's trash becomes, and how much a permanent empty would
free — with a session's sidecar directory and released marker counted in all
three — and a preview that could not be read completely says so instead of
showing a figure that looks exact.
