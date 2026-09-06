---
name: kondo
description: A dark desktop tool set in the plaintext it reads — one mono family on a warm near-black, no containers, and colour used the way a syntax highlighter uses it
colors:
  base: "#1A1714"
  raised: "#24201A"
  raised-more: "#282219"
  rule: "#332E26"
  rule-strong: "#464035"
  ink: "#DCD6C9"
  ink-2: "#B7AE9E"
  ink-3: "#918879"
  accent: "#74C4CC"
  accent-ink: "#1A1714"
  ok: "#A3C47F"
  off: "#D0A755"
  bad: "#E28170"
  unknown: "#9AA6B8"
typography:
  display:
    fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: "26px"
    letterSpacing: "0"
  section:
    fontFamily: "'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "0.08em"
  data:
    fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "20px"
    fontVariation: "tabular-nums"
  body:
    fontFamily: "'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
    maxWidth: "62ch"
  path:
    fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: "20px"
  micro:
    fontFamily: "'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  everything: "3px"
  checkbox: "2px"
  rules: "0"
spacing:
  unit: "20px"
  gutter: "2ch"
  row: "28px"
  scale: "4 / 8 / 12 / 20 / 28 / 40"
components:
  button:
    format: "[ word ]"
    fontFamily: "{typography.data.fontFamily}"
    fontSize: "12.5px"
    textColor: "{colors.ink}"
    bracketColor: "{colors.ink-3}"
    background: "none"
    border: "none"
  button-destructive:
    textColor: "{colors.off}"
    bracketColor: "{colors.ink-3}"
  button-irreversible:
    textColor: "{colors.bad}"
    bracketColor: "{colors.bad}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.everything}"
    padding: "5px 14px"
  chip-kind:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.everything}"
    padding: "1px 8px"
    sigil: "none"
  chip-state:
    background: "none"
    padding: "1px 8px 1px 0"
    sigil: "- ~ !"
  chip-unknown:
    background: "none"
    textColor: "{colors.unknown}"
    border: "1px solid {colors.unknown}"
    sigil: "?"
  field:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.everything}"
    padding: "4px 8px"
    focusBorder: "1px solid {colors.accent}"
  row:
    height: "28px"
    padding: "4px 12px 4px 2ch"
    borderBottom: "1px solid {colors.rule}"
    currentBackground: "{colors.raised-more}"
    currentMark: "> in {colors.accent}"
  section:
    background: "none"
    border: "none"
    headRule: "1px solid {colors.rule-strong}"
    gap: "28px"
  sidebar:
    width: "208px"
    background: "none"
    borderRight: "1px solid {colors.rule-strong}"
---

# Design System: kondo

## Overview

**Creative North Star: "Flat File"**

Everything kondo shows you is plaintext somebody else wrote. Your store is
11,686 JSONL transcripts, a 2 MB JSON registry, and 9,171 directories whose
names are real paths pressed flat into hyphens. Kondo is the only app whose
entire subject matter arrives as text, so it stops putting that text in cards
and sets itself in the material it reads: one monospaced family on a warm
near-black, no containers at all, and colour applied the way a syntax
highlighter applies it — to say what a token is and how it is doing, and
nothing else.

The previous identity was a pale pastel one taken from a wellness-app
reference. It was competent and it said nothing about this app; that is why it
is gone. Every colour below traces to something kondo actually handles.

It is a **dark-only** surface. There is no light theme and no toggle. The
earlier rule forbidding a dark rendition is void.

**Key Characteristics:**

- One warm near-black ground, three surfaces, and no card anywhere.
- IBM Plex Mono is the store's text; IBM Plex Sans is kondo's own voice.
- Five status hues in a narrow luminance band, each led by a character.
- Every control is a word in real ASCII brackets: `[ Undo ]`.
- A 2ch gutter down the left of every table, carrying `>` `+` `~`.
- No shadow, no glow, no gradient, no scrim, no icon set, no pill.

## Colors

A warm dark ground, three inks, five status hues and one cool accent. Nothing
is white and nothing is pure black.

### Surfaces
- **Base** (`--base` #1A1714): the page, the sidebar, the window. Warm with a
  6/255 channel spread — about 2.4% chroma, enough to read as paper in a dark
  room, far too weak to tint the text on it. It is deliberately not `#0A0A0A`
  and not a cool `#2E3440`.
- **Raised** (`--raised` #24201A, 1.09:1): the kind chip's fill, the filter
  field, the loading slot's bars, the expanded session detail.
- **Raised more** (`--raised-more` #282219, 1.12:1): the current or hovered
  row. The highest surface there is; nothing stacks above it.
- **Rule** (`--rule` #332E26, 1.31:1) and **Rule strong** (`--rule-strong`
  #464035, 1.71:1): row hairlines, and the rule under a section header or a
  column header.

### Ink
- **Ink** (`--ink` #DCD6C9, 12.15:1): row names, the one h1, the numeric half
  of a size, the surviving words in a flattened key. Warm bone, never
  `#FFFFFF`. This is the brightest thing anywhere in the app.
- **Ink 2** (`--ink-2` #B7AE9E, 8.02:1 on base and above 7:1 on all three
  surfaces): kondo's own voice and the store's addresses — every refusal
  sentence, every empty state, every explanation, plus section and column
  headers and every path, id, uuid and digest.
- **Ink 3** (`--ink-3` #918879, 5.03:1 on base, 4.50:1 on a selected row):
  brackets at rest, the em dash of an honest null, unit suffixes, the hyphen
  runs inside a flattened key, relative times, the colophon. Never a sentence
  a user must read.

### The accent
- **Accent** (`--accent` #74C4CC, 8.70:1): where you are, and what is staged
  but not yet real. It marks the current destination and the current row with
  a `>`, draws the caret and the focus ring, sets the `_` in the wordmark and
  the one in the mark, fills the page's one action button, and colours a
  pending row and its `+`.
  It is the only cool hue in an otherwise entirely warm system, and it is
  **banned from the chip vocabulary** so it can never be read as a state.

### The mark
`k_` — the wordmark's first letter and the caret that closes it, on the base
ground, in [src/assets/kondo-mark.svg](src/assets/kondo-mark.svg). One file
carries every use: the window and taskbar icon, the left rail, the splash and
both READMEs. There is no second lockup and no wordmark image; where the name
is set as type it is set in the mono face, never in a picture of it.

### Status
- **Ok** (`--ok` #A3C47F, 8.92:1): in force. No sigil — the resting state
  needs no mark, because the marks exist to name departures from it.
- **Off** (`--off` #D0A755, 7.82:1): not in force. Sigil `-` for stated-off,
  `~` for aged-out or already-happened. Also the word inside every reversible
  destruction control.
- **Bad** (`--bad` #E28170, 6.38:1): broken. Sigil `!`. Also the only coloured
  brackets in the app, which is how the single irreversible act is marked.
- **Unknown** (`--unknown` #9AA6B8, 7.14:1): kondo cannot tell, or nobody has
  said. Sigil `?`, a 1px hairline, and no fill.

### Named Rules

**The Sigil Rule.** Every non-affirmative state leads with a character — `-`
`~` `!` `?` — before it has a hue. Green, amber and red collapse under
deuteranopia, and `off` beside `not found` is exactly the pair that must never
be confused. Amber alone carries two different kinds of news, so deleting a
sigil silently merges "someone stated no" with "it aged out". The comment
saying so lives at the `.stamp` definition in `src/index.css`, not only here.

**The Fill Rule.** A fill is a statement. The kind chip is the only filled
chip, which is why it can never be misread as a status; and `?` gets no fill,
because kondo has nothing to state.

**The Accent Rule.** The accent means two things — where you are, and what is
staged. It never appears on a chip, a state, a kind or a figure. A window with
nothing staged shows three accent glyphs and no fill at all.

**The No Gradient Rule.** Every surface is one flat colour. No gradient, no
glow, no shadow, no scrim, no glass. A tint is a `color-mix`, not a fade.

## Typography

**Store Font:** IBM Plex Mono (bundled, `src/assets/fonts`, OFL 1.1)
**Voice Font:** IBM Plex Sans (bundled, same licence)

**Character:** two faces sharing one skeleton, split by a rule anyone can
state in a line — **mono is the store's text, sans is kondo's voice.** Mono
carries every table cell, chip, button label, path, id, uuid, digest and the
one h1. Sans carries refusals, empty states, explanations, section headers,
column headers and relative times, and nothing else.

Plex Mono's advance is 0.600em against Cascadia Mono's 0.602em, and paths are
set at 11.5px rather than 12px, so nothing that fits today truncates later.
Light text on a dark ground optically gains weight, so mono data stays at 400
and never steps to 500 for emphasis — an ink step does that job.

### Hierarchy
- **Display / h1** (mono 500, 20px/26px, 0 tracking): the one h1 on a page, a
  project or object name. It is a path fragment, so it belongs in the
  material's face.
- **Object id** (mono 400, 11.5px, `--ink-3`): the composite id beneath an h1.
- **Section header** (sans 500, 11.5px, +0.08em, `--ink-2`): the only place
  tracking goes positive, and the mechanism that lets a header read as a
  header with no box and no coloured dot.
- **Column header** (sans 500, 11.5px, +0.06em, `--ink-2`), sentence case,
  with a `--rule-strong` underline.
- **Data cell** (mono 400, 12.5px/20px, `--ink`), tabular by construction.
- **Body prose** (sans 400, 13px/20px, `--ink-2`, max 62ch).
- **Chip** (mono 400, 11.5px/18px) and **button label** (mono 400, 12.5px,
  brackets included in the string).
- **Micro** (sans 400, 11px, `--ink-3`): relative times, the colophon.

### Named Rules

**The Two Faces Rule.** Mono is the store's text; sans is kondo's voice. The
first table cell set in Plex Sans breaks the identity in a way nobody catches
in review, so it wants a single cell component or a lint rule, not discipline.

**The Sentence Case Rule.** Nothing is set in capitals — not column headers,
not chips, not buttons. Kept from the old system because it was always right.

**The Null Rule.** An honest null is an em dash in `--ink-3`; a real zero is
`0` in full `--ink`. Down a monospaced column the difference is unmissable,
which is the whole reason to have a mono column.

**The Tracking Rule.** Letter-spacing is 0 everywhere except the two
tracked-out label roles. The old negative tracking has no job in a mono face.

## Layout

The window is a 24px gutter holding a 208px sidebar column and the page beside
it. The sidebar has no panel: it is text against one vertical `--rule-strong`
line. At the enforced 900px minimum this leaves about 295px for the project
detail pane, against 264px under the old identity.

Every page is a stack of sections separated by 28px of nothing. A section is a
header line, a `--rule-strong` beneath it, and rows on `--rule` hairlines.
There is no card, no panel, no border box and no fill. **Alignment does what
borders used to do:** every table on a page starts at the same x, so the eye
tracks one edge down the whole page.

A **2ch gutter** runs down the far left of every table and every message band.
It holds the sigil that says what a row is: `>` for the current row or the
layer in effect, `+` for something staged, `~` for something displaced, and
nothing at all for an ordinary row.

Every row in every table sits on the same 20px baseline unit; a table row is
28px. The spacing scale is 4 / 8 / 12 / 20 / 28 / 40, with 20 as the line
unit. The window opens at 1360×860 and never goes below 900×600; there is no
mobile treatment.

## Elevation & Depth

There is none. `box-shadow` does not appear in the stylesheet, and neither do
`filter`, `opacity` as a signal, or any gradient. Depth is ink lightness and
three surfaces within 1.12:1 of each other. The saving is spent on density,
and on the fact that nothing on screen has a soft edge for the eye to hunt
focus on.

### Named Rules

**The No Opacity Rule.** Dimming is never an alpha. 0.35 opacity on this
ground would put a 12.15:1 label at roughly 2.3:1. A disabled control loses
its brackets and drops to `--ink-3` at 5.03:1 — a shape change that stays
legible. A row not in force drops its name cell one ink tier and carries no
gutter mark, while the row in force carries `>`.

## Shapes

Flat. One radius, 3px, on everything that is filled: the kind chip, the field,
the band's active state, the primary button, the loading bars. 2px on the
native checkbox. 0 on every rule and every table. Nothing is a pill; 999px
does not appear in the stylesheet. The disclosure is `+` / `−` rather than a
rotating chevron, and the select's chevron is one `▾` character — there is
still no icon set.

## Components

### Buttons
- **Shape:** a word in real ASCII brackets, `[ Undo ]`. No border, no fill, no
  shadow. The brackets are `--ink-3`; the word carries the meaning.
- **Quiet** (`.btn`, `.btn-quiet`): the word in `--ink`. Every row control.
- **Reversible destruction** (`.btn-pencil`): the word in `--off`, brackets
  still `--ink-3`. Move to trash, Remove, Empty the trash — amber rather than
  red, because none of these destroys anything.
- **Irreversible** (`.btn-fill`): `[ Empty it permanently ]` — a red word in
  **red brackets**, unfilled. The only control in the app whose brackets are
  coloured, and that is the whole distinction. `[ Keep the trash ]` keeps
  `autoFocus`, so the focus ring is on the safe half.
- **Primary** (`.btn-go`): a solid `--accent` fill with `--accent-ink`, 3px,
  5px 14px, and no brackets — a fill is a bracket. One per page: a second one
  in view means one of them is not the action.
- **Disabled:** loses its brackets and drops to `--ink-3`. Never an opacity,
  and never without its printed `<Refusal>` sentence beneath it.

### Chips
Three shapes and only three:
- **A state** — a hued word with a leading sigil and no fill.
- **kondo cannot tell** — a slate word with `?` and a 1px hairline, no fill.
- **A plain fact** — a grey word with no sigil on a `--raised` fill. Kind
  chips are all of this shape.

### Sections
A header, a `--rule-strong`, rows on `--rule` hairlines, 28px to the next one.
The `tone` prop and the `data-tone` attribute survive in the JSX and now do
nothing: **kind is a word, not a hue**. That single change resolves the
collision where lime meant both "Storage" and "on".

### Tables

Standalone label/value facts use `.line`: baseline-aligned flex, a 12px gap,
28px minimum height and the same `--rule` hairline as table rows. Long values
wrap inside their column. A keyboard-only skip link appears on focus using
the existing ground and ink colours. Inline confirmations focus Cancel,
accept Escape, and return focus to the initiating control on cancellation.
`.ledger` is the one table: 28px rows, 4px 12px cells, a 2ch first column for
the gutter mark, `--rule` between rows, `--rule-strong` under the header. Hover
and current are the same `--raised-more`; the current row is additionally the
one carrying `>`. `tfoot` totals gain `--ink` instead of a weight step.

### Bands
`.band` is a sentence in kondo's voice with a character in the 2ch gutter:
`+` in accent for a posted change, `-` in amber for a note, `!` in red for a
refusal, `?` in slate for something kondo could not resolve. The band's mark
is a character in a column, never a coloured left rail.

### The slot
`.slot` is one component with three occupants, because a row not yet read, a
row not yet real and a row that moved away are the same fact. Loading is three
grey bars with no mark, no shimmer and no pulse; a pending move is
`data-mark="+"` in accent; a displaced row is `data-mark="~"` in amber.

### Motion
A 90ms ease on `color` and `background-color` for interactive text, in exactly
five component rules, and nothing else. No transform, no fade, no shimmer, no
rotation, no blink — the `_` in the wordmark is a static character.
`prefers-reduced-motion` removes the 90ms and leaves the identity completely
unchanged, which is the test that it was never load-bearing. The "Refreshing…"
indicator cannot shift layout: every section header reserves a fixed 12ch slot
for it, empty when idle — a guarantee only a mono grid can make.

## The signature

**The flattened project key shows its own damage.** Split the key on `/(-+)/`
and render the surviving alphanumeric runs in `--ink` and the hyphen runs in
`--ink-3`. `D--Projects-Personal-SoftwareDevelopment-kondo` reads as five
standing words with the wreckage receding between them, so at a glance down a
column you see literally where `[^A-Za-z0-9]` destroyed a path — lossy and
irreversible by construction, drawn rather than explained.

It lives as one function in `src/lib/format.ts` and it works only because the
face is monospaced. Apply it **only** where the seam hands you a flattened
key, never to a real path or filename: a hyphen in a real path is a legitimate
character and dimming it would draw a lie. Gate it at the call site, not
inside a generic path renderer.

## Do's and Don'ts

### Do:
- **Do** set the store's own text in mono and kondo's own sentences in sans.
- **Do** lead every non-affirmative state with its character, then its hue.
- **Do** separate a region with a header, a rule and 28px of nothing.
- **Do** put every count and size in a `.num` cell, with its unit in `--ink-3`.
- **Do** print a refusal in `--ink-2` beneath the control that refused.
- **Do** start every table on the same x, so alignment carries the structure.

### Don't:
- **Don't** draw a card, a panel, a border box or a shadow. There are none.
- **Don't** use opacity to say anything. Drop an ink tier or change a shape.
- **Don't** give a kind a hue — a hue means a state, and only a state.
- **Don't** let the accent onto a chip, a figure or anything that is not
  "where you are" or "what is staged".
- **Don't** set anything in capitals, or add a second radius, or a pill.
- **Don't** dim a hyphen in a real path; that treatment is for flattened keys
  only, and using it elsewhere draws a lie.
- **Don't** add a light theme. The dark ground is the identity.
- **Don't** hard-code a colour in a component; a new colour is a new role in
  `src/index.css`.
