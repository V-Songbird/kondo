# Plan: Signal themes

Status: **in progress**

Add a Themes destination so users can choose the five restrained Signal
directions and the original vivid Signal design explored in the design review.
Chalk is the default. Keep Kondo's original mark and use Signal's bold headings
and square, clearly bounded controls throughout the existing management workflows.

## Scope

- Renderer: a Themes destination with named, keyboard-accessible previews for
  Chalk, Parchment, Sage, Slate, Carbon and Signal Original. Apply changes
  immediately, identify the current and default themes in text, and explain
  save failures.
- Visual system: shared theme metadata and semantic colors, readable status
  colors in all six palettes, and the Signal shell and component treatment.
- Main: validated appearance preferences in Kondo's own data directory, with
  Chalk fallback for absent or invalid preferences. Restore the selected theme
  before showing the main window and keep native window colors consistent.
- Preserve Library/Projects navigation state when visiting Themes.

## Out of scope

Custom theme editing, theme downloads, automatic time/system switching, and
changes to Claude Code settings, project files, plugins or skills.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Chalk is the initial theme on fresh and existing installs without an appearance preference. | Explicit user selection. |
| 2 | All six themes share Signal's typography and geometry. | The user selected Signal, its five quieter alternatives, and retaining the original vivid version. |
| 3 | Persist appearance in Kondo's own footprint through the typed bridge. | Renderer disk access remains forbidden; this is not Claude configuration or an undoable store mutation. |
| 4 | Theme choices are named native controls with a visible current indicator. | Color alone must not carry selection, and keyboard operation must be straightforward. |
| 5 | Preference failures return an error and a usable theme. | A corrupt or unwritable appearance file must not block management workflows. |

## Seam changes

Add typed appearance read/write methods to the contract, workspace, IPC and
preload. Only a recognized theme identifier crosses the seam; no paths or CSS
are accepted. Central theme definitions also supply native window colors.

## Tests

- Fixture-only preference tests: absent, saved, invalid and malformed values;
  rejected runtime inputs; persistence across workspace instances; write errors.
- Boundary sweep includes appearance methods and confirms no Claude writes.
- Electron checks: Chalk first launch, six options, keyboard selection,
  immediate appearance change, retained navigation state, reload/relaunch
  persistence and readable layouts at 1360x860 and 900x600.
- Run npm test, npm run typecheck, npm run lint, build, guards and Electron smoke.
- Visually inspect light and dark palettes with synthetic fixture data.

## Done when

Users can open Themes, recognize and select one of six Signal appearances,
return to their work, and reopen Kondo with their choice retained. Chalk is the
default, all existing workflows remain usable, and no Claude data is changed
by an appearance selection.

## Implementation notes

- The original vivid cobalt/citrus Signal is the sixth option, named Signal
  Original. All appearances use the same layout and the original logo.
- A single shared catalog supplies the renderer, visual previews and native
  window colors. Reads and writes are serialized per preference file, even
  across workspace instances. Atomic replacement preserves the previous file
  if saving fails; missing or invalid preferences have a usable Chalk fallback.
- Save failures are visible and retryable. Keyboard retries return focus to
  the checked radio before the temporary retry button unmounts.
- Visual review caught two small issues: secondary Sage/Slate text needed
  stronger contrast, and Signal Original needed a wider shell control to keep
  the header height stable. Both were corrected before completion.

## Validation — 2026-09-06, Windows

- `npm test`: 407 tests in 35 files passed, including appearance persistence,
  malformed and invalid requests, read/write errors, IPC notifications, the
  store boundary and all six palettes' text contrast.
- `npm run typecheck`, `npm run lint`, `npm run build`, staged
  `npm run guards` and `git diff --check` passed.
- `npm run test:e2e`: 17 checks passed against the built Electron app with
  synthetic stores. Coverage includes native keyboard selection, a stable
  1360px shell across all six choices, context retention, reload and process
  restart, retry focus across repeated save failures and recovery, and exact
  preservation of Claude fixture contents and journal bytes.
- Inspected fixture screenshots of Chalk, Carbon and Signal Original, with
  Themes and Library checked at the 900x600 minimum. This evidence covers
  Windows; it does not establish macOS/Linux or screen-reader behavior.
