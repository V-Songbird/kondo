# Plan: in-app product claims reconciled with the decisions in force

Status: **in progress**

Three accepted decisions narrowed what kondo does — settings writes refused
([ADR-0010](../adr/0010-splice-config-files-never-whole-file-writes.md)), hook
declarations read-only
([ADR-0017](../adr/0017-hook-layer-boundary.md)) and Desktop sessions read-only
with a named removal scope
([ADR-0016](../adr/0016-desktop-session-boundary.md)) — and the screens still
carry the wording from before them. This plan inventories every in-app claim
that contradicts a decision or a verified behaviour, replaces it, and adds the
disclosure ADR-0016 requires before a conversation is removed.

## Scope

**Half A — wording and refusals (renderer plus the two main-process strings a
screen reads).**

1. Hooks per ADR-0017.
2. Settings controls per ADR-0010 and decision 107.
3. Conversations per ADR-0016.
4. States and limits: the MCP state word, MCP configured-state limits,
   History's Undo limits, History's empty state.
5. In-context explanations: old is not useless, scratch is not inactive,
   moving to trash frees no disk, and the removal size is 105's full estimate.

Plus `docs/glossary.md`'s UI-words table and the `CHANGELOG.md` Unreleased
entries for the user-visible wording.

**Half B — disclosure before removal.** Display-safe candidate descriptors on
`SessionTrashPreview`, the renderer disclosure built from them, fixture tests,
smoke coverage and one visual pass.

## Out of scope

- Any new settings write path, and any per-hook toggle. ADR-0010 and ADR-0017
  refuse both; this plan states the refusal, it does not relax it.
- Desktop session browsing or removal (ADR-0016). A Desktop id stays refused.
- `README.md` and the rest of the tracked documents: entry 128 reconciled them.
  Only `docs/glossary.md`, `docs/domain.md` and `docs/adr/` are touched here,
  and only where a staged code change pairs with them.
- `docs/status.md`. Findings 1, 2 and 3 and open question 3 are inputs; the
  next reconciliation records the outcome.
- MCP controls. Entry 103 settled them; only MCP wording is in scope.
- A general effective-settings viewer (ADR-0021).

## Inventory of in-app claims

### Hooks (ADR-0017)

| File | Current text | What it contradicts | Replacement |
|---|---|---|---|
| [capabilities.ts:73](../../electron/main/workspace/capabilities.ts) | `Claude has no way to switch off one hook; edit the settings file that runs it.` | A claim about Claude, not about kondo. ADR-0017 is kondo's boundary. | `Kondo does not support switching individual hooks; edit the settings file that runs it.` |
| [capabilities.ts:90](../../electron/main/workspace/capabilities.ts) | `Moving a hook between settings files is two edits kondo has not built yet; edit both files by hand for now.` | ADR-0017 refuses the move on its merits, not for want of a plan. | `Kondo does not move a hook between settings files: the same bytes in another layer are not the same hook.` |
| [capabilities.ts:74-88](../../electron/main/workspace/capabilities.ts) | Comment: "not yet rather than never", two `SpliceEdit`s, entry 031. | ADR-0017 chose read-only declarations. | Rewritten to cite ADR-0017 and its reopening bar. |
| [library.tsx:602](../../src/features/library/library.tsx) | `Claude has no way to switch off one hook. Edit the settings file that runs it.` | As above. | `Kondo does not support switching individual hooks. Edit the settings file that runs it.` |
| [projects.tsx:639](../../src/features/projects/projects.tsx) | `Nothing here runs a command on a Claude event.` | Kondo inventories selected settings layers, not every execution source (domain.md). | `No hook is declared in the settings files kondo reads here. Kondo does not read every source Claude Code can load a hook from.` |
| [library.tsx:589](../../src/features/library/library.tsx) | `— no script file named` | The command named something kondo's recognizer did not read as a script. | `No script recognized` |
| [projects.tsx:966](../../src/features/projects/projects.tsx) | `—` | As above; an em dash says nothing. | `No script recognized` |
| [catalog.ts:324](../../src/features/library/catalog.ts) | flag `no script named` | As above; one word per concept. | flag `no script recognized` |
| [tidy.tsx:87](../../src/features/tidy/tidy.tsx) | `Hook scripts nothing runs` | The category retains every script because disuse cannot be established (ADR-0002, ADR-0017). | `Hook scripts kondo keeps` |
| [tidy.tsx:115](../../src/features/tidy/tidy.tsx) | `Scripts in your hooks folder that no settings file actually runs.` | As above. | `Kondo keeps every hook script. It cannot establish that one is unused, so it offers none here.` |
| [tidy.ts:563](../../electron/main/workspace/tidy.ts) | `hook script nothing runs` / `hook scripts nothing runs` | The journal summary repeats the same claim. | `kept hook script` / `kept hook scripts` |

### Settings (ADR-0010, decision 107 in ADR-0021)

| File | Current text | What it contradicts | Replacement |
|---|---|---|---|
| [projects.tsx:1271](../../src/features/projects/projects.tsx) | `Disable` / `Enable` enabled, refused after the click by [mutations.ts:390](../../electron/main/workspace/mutations.ts) | ADR-0010 refuses the write. A refusal is stated before the click. | Control disabled, refusal printed beside it. |
| [plugin-control.tsx:107](../../src/features/projects/plugin-control.tsx) | tooltip `Writes <path>` | Nothing is written. | Positions disabled; the settings-suspended sentence printed; the tooltip drops the promise. |
| [plugin-control.tsx:121](../../src/features/projects/plugin-control.tsx) | move picker enabled when the plugin is on here | A plugin scope move is two settings edits (ADR-0010). | Disabled with the same printed sentence. |
| [orphans.tsx:192](../../src/features/orphans/orphans.tsx) | `Remove selected settings` enabled | ADR-0010 refuses it; the screen says so in prose but offers the button. | Disabled, labelled `Removal unavailable`. |
| [library.tsx:674](../../src/features/library/library.tsx) | `The highest layer that states a value wins: local over project over user.` | Decision 107: managed policy and command-line settings are not read (ADR-0021). | Adds that kondo compares only the files it reads and that a source it does not read can still decide. |
| [projects.tsx:565](../../src/features/projects/projects.tsx) | `Turn one on or off, or move it to another project.` | Turning off is refused. | States the move, and that switching is unavailable while settings changes are. |

One sentence carries every settings refusal, in
`src/lib/claims.ts`, so the four screens cannot drift apart.

### Conversations (ADR-0016)

| File | Current text | What it contradicts | Replacement |
|---|---|---|---|
| [projects.tsx:806](../../src/features/projects/projects.tsx) | `Conversations` with no source named | Kondo manages selected Claude Code transcripts only. | Intro sentence: rows are Claude Code transcripts; Desktop conversations are not listed or removed. |
| [projects.tsx:1483](../../src/features/projects/projects.tsx) | `also in desktop` / `the same work recorded twice` | `desktopSessionStems` matches identifiers without reading contents. | `matching ID in desktop app`, with the contents-unverified sentence in the title. |
| [projects.tsx:1476](../../src/features/projects/projects.tsx) | `deleted in desktop app` | A released marker is a marker, not proof the app removed every record. | `desktop released marker`, title unchanged in substance. |
| [tidy.tsx:80](../../src/features/tidy/tidy.tsx) | `Conversations deleted in the desktop app` | As above. | `Conversations with a desktop released marker` |
| [tidy.tsx:101](../../src/features/tidy/tidy.tsx) | `The desktop app deleted these on its side` | As above. | `The desktop app left a released marker beside these transcripts. The marker is a filename kondo recognizes, not proof the app removed its own records.` |
| [tidy.ts:553](../../electron/main/workspace/tidy.ts) | `conversation deleted in the desktop app` | As above. | `conversation with a desktop released marker` |
| [projects.tsx:1516](../../src/features/projects/projects.tsx) | `Move {count} conversation and their saved supporting files` | `their` for a singular count. | Replaced by half B's disclosure, whose question names no companions in the pronoun. |

Nothing on the screen reads a missing Desktop match as absence: a null
`mirroredIn` renders nothing at all, and the Conversations intro says Desktop
conversations are outside kondo's listing. Verified by the absence of a
render branch for the null case.

### States and limits

| File | Current text | What it contradicts | Replacement |
|---|---|---|---|
| [catalog.ts:361](../../src/features/library/catalog.ts) | object flag `unknown` | The per-row chip calls the same state `cannot tell` ([catalog.ts:157](../../src/features/library/catalog.ts)). | `cannot tell` in both. |
| [projects.tsx:734](../../src/features/projects/projects.tsx) | says it does not test a running connection | Silent about managed policy, which kondo does not read (ADR-0021). | Adds the managed-policy limit, matching the Library's sentence. |
| [journal.tsx:225](../../src/features/journal/journal.tsx) | `After you move, disable or remove something` | Disabling is refused (status finding 3). | `After kondo moves something or cleans something up, its history and Undo appear here.` |
| [journal.tsx:209](../../src/features/journal/journal.tsx) | `Review what kondo changed and restore a change with Undo.` | Undo of a historical settings change is refused (ADR-0010); an emptied trash is not restorable. | Both limits stated in the hero. |

### In-context explanations

| File | Current text | What it contradicts | Replacement |
|---|---|---|---|
| [tidy.tsx:97](../../src/features/tidy/tidy.tsx) | `Untouched for over N days.` | Age is not disuse. | Adds `Old does not mean useless.` |
| [tidy.tsx:93](../../src/features/tidy/tidy.tsx) | `temporary folders, worktrees or jobs with no memory and no recent activity` | A throwaway name is not inactivity. | Adds `A throwaway name alone never makes a folder removable.` |
| [tidy.tsx:233](../../src/features/tidy/tidy.tsx) | already states that moving frees no disk | — | Kept. |

The removal size on both confirmations comes from entry 105's estimate: Clean
up sums the disjoint reviewed category figures (ADR-0015), and a conversation
review shows `RemovalSizeEstimate` beside a per-row transcript size that is
labelled `transcript`. No transcript size is presented as a removal total.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Every refusal is Kondo-scoped: "kondo does not…", never "Claude has no way to…". | ADR-0017's boundary is kondo's, and a claim about Claude is one kondo cannot verify. Hook rows change; MCP rows that describe Claude's own per-project switch (ADR-0006, entry 103) are the documented convention and stay. |
| 2 | A hook move is refused on its merits, not for want of a plan. | ADR-0017 chose read-only declarations; "not built yet" reads as a promise the decision withdrew. |
| 3 | The `unarmed-hook-scripts` category keeps its identifier and gets a label saying kondo keeps the scripts. | domain.md holds the identifier as a compatibility surface with zero candidates; only the label was a claim. |
| 4 | A control ADR-0010 refuses is disabled, with the refusal printed. | The invariant: no control presents a settings change as executable. Disabled plus a printed reason is the pattern the app already uses for a refused capability. |
| 5 | The settings-suspension sentence is one exported constant in `src/lib/claims.ts`. | Four screens state it; four spellings is how the vocabulary drifts. It is renderer copy, not store truth, so it does not cross the seam. |
| 6 | A desktop filename match is called a matching ID, and a released marker a marker. | ADR-0016: `desktopSessionStems` matches identifiers without reading contents, and a marker is a filename the scanner recognizes. |
| 7 | Library says `Scope` and `Location` where the glossary said "Where it applies", and `All projects` replaces `Global` on screen. | Open question 3. One word per concept: `All projects` already names the shared configuration in Projects and in the plugin install-scope words, so Library moves to it and the glossary's row stands. The internal term stays `Global` in ids and types. |
| 8 | Body copy says `Output styles`, not `response styles`. | The section title, the glossary and `EntityKind` all say output style. |
| 9 | The removal disclosure's descriptors are display paths built in main, on the existing `sessionTrashPreview` channel. | ADR-0008 keeps paths out of the renderer's reach inbound; a tildified display path travelling outward is what the seam guard already permits, and no new channel means no new preload or IPC surface. |
| 10 | The list of records that remain is renderer copy, not a seam payload, except the Desktop line, which is conditional on `SessionSummary.mirroredIn`. | It is a product claim about kondo's boundary (ADR-0016), true of every removal; only the Desktop copy is a fact about this store. |
| 11 | The disclosure lists at most 20 candidates and then a count. | ADR-0015 bounds a review; an unbounded list is a rendering hazard on a selection of hundreds. |

## Seam changes

`shared/contract.ts` gains one interface and two fields on
`SessionTrashPreview`. No new channel, so `electron/main/ipc.ts` and
`electron/preload/index.ts` are unchanged.

```ts
/**
 * One reviewed session's exact candidates, as display text. These are the
 * very paths the review token binds (ADR-0015) — the transcript, the sidecar
 * directory when it has one, and the desktop released marker when it has one.
 * Display paths travel outward only; nothing reads one back (ADR-0008).
 */
export interface SessionRemovalCandidate {
  /** The session's `session:code:<dirName>/<uuid>` id. */
  id: string
  transcript: string
  sidecar: string | null
  releasedMarker: string | null
}
```

`SessionTrashPreview` gains `candidates: SessionRemovalCandidate[]` and
`projects: { id: string; label: string }[]`, the bounded identity list. The
paired decision record is an amendment to
[ADR-0015](../adr/0015-bind-removal-to-reviewed-state.md): a new section
stating that the reviewed steps are disclosed before confirmation, as display
text, and that disclosure changes nothing about what authorizes the removal.
`docs/domain.md` gains the session-removal disclosure beside its existing
session-removal scope section, because
`electron/main/workspace/workspace.ts` is staged with it.

## Tests

`test/kinds.test.ts`

- `capabilitiesFor('hook', 'user').disable.reason` contains
  `Kondo does not support switching individual hooks`.
- `capabilitiesFor('hook', 'user').move.reason` differs from both toggle
  reasons and does not match `/not built yet/`.
- No hook capability reason starts with `Claude `.

`test/hook-cleanup.test.ts`

- The `unarmed-hook-scripts` blocked reason is unchanged and the category is
  still offered with zero candidates.

`test/tidy.test.ts`

- The journal summary for a `desktop-released-sessions` sweep says
  `desktop released marker` and not `deleted in the desktop app`.
- The journal summary never contains `nothing runs`.

`test/session-duplicates.test.ts` (the removal fixtures)

- A preview over a session with transcript, sidecar and released marker
  returns three candidate descriptors, each a display path under `~`.
- `candidates` names exactly the paths the sweep then moves: after the move,
  every named path is absent from the store and present under the trash.
- A residual's bytes are byte-identical after the move and after Undo.
- A session mirrored in the desktop store previews with `mirroredIn` set and
  leaves the desktop record untouched after the move.
- An unknown sibling sharing the uuid stem refuses the whole selection with
  `stale-plan` and appends no journal entry.
- A `session:desktop:` id refuses with `not-permitted` and appends no journal
  entry.
- A selection mixing a Code id and a Desktop id refuses whole, with no journal
  entry.
- Undo restores every moved path, including the sidecar and the marker.
- `projects` holds one entry per distinct project in the selection, with the
  project's display label.

`test/library-catalog.test.ts`

- The MCP object flag for an unknown member reads `cannot tell`, the same word
  the per-row chip uses.

`test/e2e/smoke.mjs`

- The conversation review discloses the transcript, the sidecar and the marker
  before the confirmation button exists.
- Escape from the review cancels it and returns focus to the button that
  opened it.
- The tidy checkbox for the retained hook-script category is found by its new
  accessible name.

## Done when

Every claim in the inventory above reads what the code does; a conversation
removal names each file it will move and the records it will not touch before
the confirmation exists; the glossary's UI-words table matches the screens;
and `git grep` finds the retired claims nowhere under `src/`, `electron/`,
`shared/` or `test/`.
