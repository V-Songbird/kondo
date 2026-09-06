---
name: kondo-ledger-design
description: "Kondo's look: two directions were rejected, and on 2026-09-05 the owner chose 'Flat File' — dark only, mono, no containers. DESIGN.md is the authority"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d0b9fb09-3ef6-41d1-9f6a-4f997d055089
  modified: 2026-09-05T19:39:00.500Z
---

Three directions, two rejections, and what finally landed.

**Rejected: a stock-take ledger** (ruled green paper, ink, red pencil). I
invented it from "three worlds from a developer's desk"; the owner hated it.

**Rejected: "The Calm Companion"** — white 24px cards on a pale pink wash,
pastel dots, Inter Tight, light only, taken from a Calmora wellness-app
reference the owner supplied. Their verdict, in one sentence: it **"says
nothing about kondo"**. Not too pink, not too soft — *generic*.

**Shipped: "Flat File."** Dark only, invented from the subject rather than
from a reference. Everything kondo shows you is plaintext somebody else
wrote, so it is set in the material it reads: IBM Plex Mono on a warm
near-black `#1a1714`, no containers at all, colour applied the way a syntax
highlighter applies it.

Its load-bearing rules, all of which are one edit away from being lost:

- **Mono is the store's text, sans is kondo's voice.** Enforced only by the
  `p { font-family: sans }` base rule and by discipline. The first table cell
  set in Plex Sans breaks the identity and nobody catches it in review.
- **Sigils before hue.** `-` stated off, `~` aged out, `!` broken, `?` kondo
  cannot tell; the affirmative has no mark. Amber carries two different kinds
  of news, so deleting a sigil silently merges them.
- **Opacity is never a signal** — `data-force="off"` and one ink tier.
- **A control is a word in brackets**; disabled loses its brackets.
- **Kind is a grey word on a fill; state is a coloured word with no fill.**

**Why:** "unique, not generic, minimal" from this owner is a demand for
*specificity*, not polish. Both rejected looks were competent; what killed
them is that they could be lifted onto another product unchanged. A palette
has to come from what the app actually handles.

**How to apply:** `DESIGN.md` is the authority and is current. Before
proposing anything visual for this owner, be able to say in one sentence why
it could only be kondo, and offer three directions rather than one — they
choose well from a spread and reject decisively from a single. New colours
are new roles in `src/index.css`. `electron/main/index.ts` hard-codes the
window background and must move with `--base`. See [[kondo-library-ia]] for
the IA this look sits on, and [[kondo-owner-vision]].
