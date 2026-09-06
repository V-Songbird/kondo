# Plan: trustworthy inventory and easier Claude Code management

Status: **in progress**

Review Kondo against its current roadmap and Claude Code conventions, keeping
the Flat File visual system. Make missing information visible and give people
a clear route from finding a skill or plugin to managing it.

## Scope

- Roadmap 087: readable label/value rows and inline explanations of partial changes.
- Roadmap 090: named controls, keyboard session details, safe confirmation focus,
  announced outcomes and a skip link.
- Library: report all scan failures alongside partial data, explain the kinds in
  plain language, and open an item's existing Projects management screen.
- Roadmap 095: isolate malformed journal records and steps so healthy history
  stays readable and usable.
- Verify plugin cleanup against installations in multiple scopes; preserve every
  declared installation when deciding which cache versions are leftover.

## Out of scope

Releasing, merging, real-store mutations, a visual rebrand, implementing new
Claude features, and the full release backlog. Broader compatibility gaps and
the remaining atomic-write work (074) get evidence and a next step here.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep Projects as the initial destination and existing navigation labels. | The owner likes the current interface; improve comprehension within it. |
| 2 | Library links to existing project controls. | A second mutation UI would duplicate confirmations and scope semantics. |
| 3 | A failed scan never becomes an empty or healthy verdict. | Partial inventory is useful only when its limits are visible. |
| 4 | Use invented fixtures for every mutation and UI run. | Keep actual Claude data outside development operations. |

## Seam changes

None planned. Navigation carries the existing opaque project ids. Inventory and
mutation changes stay within the existing workspace contracts.

## Tests

- Existing unit suite, typecheck and lint must pass.
- Append malformed valid JSON and malformed step shapes beside valid journal
  records; list and undo must preserve healthy records and report bad lines.
- Multiple installation records must keep all active cache versions out of cleanup.
- Built Electron smoke: keyboard entry into session details; named controls;
  staged moves change nothing until confirmation; Library management navigation;
  errors and unknown entries remain visible beside partial data.
- Inspect screenshots at normal and minimum window widths using synthetic data.

## Done when

People can find an item, understand where it is configured, reach its existing
management controls, and see any incomplete reads or changes. Verification and
remaining release blockers are recorded below before this work is reported.
