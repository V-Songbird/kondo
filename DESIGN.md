---
name: kondo
description: Signal — bold headings, square controls and six purposeful appearances
layout: horizontal navigation with a responsive browser and detail workspace
defaultTheme: chalk
themeSource: shared/themes.ts
---

# Design system: Signal

Kondo uses Signal's strong typography, square geometry and clear boundaries.
The owner selected this direction after comparing five visual systems and five
restrained variations of Signal. Chalk is the default. Parchment, Sage, Slate,
Carbon and Signal Original are selectable appearances of the same interface.
This supersedes the previous dark-only Flat File treatment.

## Brand

The original [kondo mark](src/assets/kondo-mark.svg) remains unchanged. Show the
complete image without cropping, filters, recoloring or a substituted glyph.
The wordmark uses the bundled IBM Plex Mono face. Its static underscore keeps
the original cyan brand color; it does not follow the theme accent. Neither the
name nor the mark changes when a theme is selected.

The mark, wordmark and tagline form one dark brand lockup at the left of the
navigation header. The native title strip uses the selected theme's `chrome`
and `chrome-ink` colors and remains a dedicated drag region above the controls.

## Themes and tokens

[shared/themes.ts](shared/themes.ts) is the only palette catalog. It supplies
renderer CSS variables, the Themes previews and native window colors. CSS has
no duplicate copy of Chalk or any other palette. The splash is the one
exception: `splash.html` and the splash window's background keep their own
fixed colors. The renderer installs Chalk,
then the saved appearance, before mounting the application behind its splash.

| Theme | Appearance | Character |
| --- | --- | --- |
| Chalk | Light, default | Soft white, charcoal, restrained teal |
| Parchment | Light | Warm paper and brown ink, dark heading band |
| Sage | Light | Pale green surfaces and woodland accents |
| Slate | Light | Cool grays with a muted blue heading band |
| Carbon | Dark | Charcoal surfaces and soft mint accents |
| Signal Original | Light | Cobalt heading band, warm paper, citrus selection |

All six themes share the same layout, font sizes, control shapes, capability
rules and keyboard behavior. Theme changes do not move content or change the
meaning of a status. The default is identified in text; the current selection
is identified by both text and a native control state.

The central catalog defines these semantic roles:

- `base`, `raised`, `raised-more`: workspace ground, reading surfaces and selection.
- `rule`, `rule-strong`: content dividers and control or section boundaries.
- `ink`, `ink-2`, `ink-3`: primary data, explanation and secondary metadata.
- `accent`, `accent-ink`: primary controls, focus, and selected content.
- `ok`, `off`, `bad`, `unknown`: status text, always accompanied by readable meaning.
- `chrome`, `chrome-ink`, `chrome-muted`: native title strip and brand lockup.
- `hero`, `hero-ink`, `hero-muted`: prominent page or item headings.
- `hero-action`, `hero-action-ink`: primary controls inside a heading band.
- `nav`, `nav-ink`, `nav-muted`: the selected destination and its purpose label.
- `shadow`: a small, hard-edged offset on the primary action when hovered.

Body ink and statuses must reach 4.5:1 on their actual reading surfaces. Heading,
navigation, chrome and action colors are checked as pairs. A surface color
alone is not proof of readability: selected rows, disabled controls and nested
heading content also need verification. Theme preview tokens are scoped to the
preview so inspecting Carbon does not change the surrounding current theme.

## Typography

Signal uses a native sans family for the interface: Arial, Segoe UI, then the
bundled IBM Plex Sans fallback. Strong page headings use Arial Narrow when
available and the same native sans fallback. Project names and skill names keep
their original spelling and case.

- Page heading: 36px, weight 800, compact line height and modest negative tracking.
- Item heading: 31px, with long names wrapping inside their pane.
- Section heading: 14px, weight 800; supporting headings: 14px, weight 700.
- Body and controls: normally 13px, with 20–21px body line height.
- Labels and small controls: 12px. Status and technical microtext may use 11.5px.
- Paths, IDs, hashes and aligned numeric data: bundled IBM Plex Mono.

Essential explanations remain visible in the normal body size. Do not reduce
an error or refusal to secondary metadata or a tooltip to make it fit.

## Geometry and layout

The window opens at 1360×860 and supports a minimum of 900×600. A 36px drag
strip precedes the horizontal navigation header. Brand, Library, Projects,
Clean up, History and the separate Themes control remain in a predictable
order. Purpose labels explain the four work destinations. The local-computer
colophon appears where the header has room; it is omitted below 1180px.

The main workspace uses 26px by 28px outer padding, reducing to 22px by 20px
at the compact breakpoint. A strong page-heading band establishes the current
purpose. Reading sections have a square boundary, a solid surface and visible
header rules. Paths and technical details wrap inside their own region.

Library and Projects retain the established browser/detail workflow. At
1180px and above both panes fit beside one another. At 1179px and below only
the browser or selected detail is displayed, with an explicit return control.
App focus handling uses the same breakpoint. Changing a theme never resets
the search, selection or pane state.

Controls, fields, chips and sections are square. Avoid gradients, blurred
shadows, glass surfaces, decorative illustrations or rounded pills. A small
hard shadow is optional emphasis for a primary action; it carries no state.

## Controls and states

A button is a clearly bounded native control with a readable action label.
The former decorative ASCII brackets have been removed. Main controls are at
least 33px high, section tabs 32px, and dense row controls at least 28px. Controls may wrap their
labels when necessary instead of widening the entire document.

- Primary action: accent background with its paired foreground.
- Quiet action: square outlined control, without competing emphasis.
- Reversible removal: `off` text and boundary, labeled Move to trash or Remove.
- Permanent deletion: `bad` text and a stronger boundary, offered only after
  its separate confirmation. Keep the trash receives the initial focus.
- Disabled: readable secondary ink, a dashed boundary and an adjacent explanation.

Selections retain a visible border or underline in addition to color. Native
buttons and selectors keep their names and roles. Focus uses a two-pixel
outline; heading bands use a contrasting local focus color. Escape cancels
inline confirmations and returns focus to the initiating action. After an
operation, focus moves to its result. No destructive choice is preselected.

Statuses retain the existing sigils: `-` means stated off, `~` means already
happened, `!` means failed or broken, and `?` means uncertain. These marks must
not disappear during restyling. Status chips use both text and a square outline;
off states also use a dashed outline. Color alone never carries their meaning.
An honest null remains an em dash; a measured zero remains `0`.

## Task flow and feedback

A render failure replaces the application content with a focused heading,
the existing `band-pencil` error alert, the build version and a native Reload
Kondo button. Keep the drag strip and current theme. Error text wraps inside
the reading measure and is displayed literally, including markup-like text.

Library finds skills, plugins, connections and other configured tools. Projects
answers where they work. Clean up contains Files and caches, Settings leftovers
and Duplicate skills. History provides the record and Undo. Themes changes
only Kondo's appearance and preserves the user's working context.

Cleanup keeps the choose → review → apply → undo sequence. Nothing is selected
for the user. Moving files to trash still consumes disk space; only explicitly
emptying trash frees it. Settings removal has its own scope review, and duplicate
skills retain visible location information because equal contents do not imply
equal availability across projects.

A changed removal review shows a focused alert with the affected selection, a
plain reason and Return to review. Clear the previous destructive selection.
Session confirmation displays the current reviewed size and activity; duplicate
skill confirmation retains the location. Kept scratch/worktree folders are
counted separately and never appear selected for removal.

Technical paths and hashes use native details disclosures when they are not
needed for the immediate decision. Partial scans, warnings and
capability refusals remain visible. Partial applications retain Undo beside the
result. Loading keeps its reserved text slot and static bars; no fabricated
progress, shimmering placeholder or animation is needed. Reduced-motion users
receive the same interface without the short control-color transition.

## Review requirements

Inspect the actual application with fixtures in a light and dark theme at both
window sizes. Check long names, disabled actions, selected statuses, open
technical details, confirmations, navigation and keyboard focus. Theme preview
cards alone do not establish that the application's nested surfaces work.

Palette changes belong in the central catalog. Geometry and global components
belong in [src/index.css](src/index.css). The Themes screen owns its preview
layout, while appearance persistence belongs behind the typed bridge in Kondo's
own data directory. No theme preference writes to Claude settings or projects.
