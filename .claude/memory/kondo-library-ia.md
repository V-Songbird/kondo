---
name: kondo-library-ia
description: "On 2026-09-05 the owner chose the 'Library' information architecture for kondo — the named object is the row, and a project is one lens on it"
metadata: 
  node_type: memory
  type: project
  modified: 2026-09-05T18:47:00.588Z
  originSessionId: e3a2521d-cae9-4895-9f3c-40675c21c869
---

Asked for three UI/UX revamp directions on 2026-09-05, the owner picked
**Library** over "Ten Minutes" (a guided one-decision-at-a-time deck) and
"The line" (a user-set staleness threshold that re-bands the whole store).

Library makes the **named object** the first-class row. One page per skill,
plugin, hook, agent, command, rule, MCP server or output style, listing every
scope it lives in with that scope's own state chip, the settings file that
decided it, its own capability refusal, and its own move control. A project
page survives as one filtered lens on the same set: eleven fixed cards collapse
to five, and every object name becomes a door into the object's page.
Destinations: Library, Projects, Clean up, Leftovers, History.

The move control stops being a native `<select>` that fires a real mutation on
an arrow key (five call sites today) and becomes a **pending row** drawn into
the table with a blush hairline, committed only by pressing `Move it`.

**Why:** it is the only one of the three directions that touches the second
half of the owner's brief — untangling scopes rather than reclaiming bytes —
and the only one that renders `SkillInfo.override`, `PluginInfo.scopes`,
`HookGroup` and `settingsLayers()` at all. Its honest cost, which the owner
accepted: Projects stops being the front door.

**How to apply:** five bridge channels are already wired and never called —
`skillsList`, `pluginsList`, `hooksList`, `settingsLayers`, `pluginSkills`.
The first two slices ship real answers with no main-process work. Before
collapsing the project page, pin the capability matrix's refusal sentences in
a test — the risk is silently losing a refusal while deleting cards, not the
new tables. Full spec and mockups in the artifact "Kondo, Three Ways"
(<https://claude.ai/code/artifact/a8ed52ce-bb52-4609-90d5-70973b133080>).
The look this wears is still being chosen — see [[kondo-ledger-design]].
