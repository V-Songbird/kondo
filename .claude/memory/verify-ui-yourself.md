---
name: verify-ui-yourself
description: "Run and drive kondo's UI yourself instead of handing visual checks back to the user"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: db259e54-6826-406d-9b54-639c85a0e482
  modified: 2026-08-29T10:20:39.727Z
---

Do not hand a kondo UI check back to the user as "unverified" when you can
settle it by running the app. On 2026-08-29 I marked the new skill Move
picker unverified and asked the user to look at it; they asked why, since I
could clearly do it myself. I could. Only genuinely subjective questions
belong in an unverified note — whether an affordance is the right one,
whether something feels good — never "does this render", "does the click
work", "does the store change".

**Why:** Foreman's `unverified:` mechanism is for checks a human must make,
and I was reaching for it reflexively for anything UI-shaped. The
[[kondo-fixture-run-recipe]] makes the real check cheap, so handing it back
was stopping short, not caution.

**How to apply:** Build a fixture store, launch the app against it, drive it
and read the screenshot before you write a single `unverified:` line. What
survives that is the note worth writing.
