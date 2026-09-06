# Architecture decision records

One file per decision that was hard, is hard to reverse, or keeps getting
re-asked. Numbered, never renumbered; a superseded ADR stays and gains a
"Superseded by" line. Findable beats polished.

## Index

- [0001 — Mutations are reversible](0001-mutations-are-reversible.md)
- [0002 — The project privacy boundary](0002-project-privacy-boundary.md)
- [0003 — One store locator owns every path](0003-store-locator.md)
- [0004 — Electron with a context-isolated, typed bridge](0004-electron-context-isolated-bridge.md)
- [0005 — Adapters degrade, never die](0005-adapters-degrade-never-die.md)
- [0006 — Native conventions over invented state](0006-native-conventions-over-invented-state.md)
- [0007 — Stat-first, lazy scanning](0007-stat-first-lazy-scanning.md)
- [0008 — Composite identity, ids across the seam](0008-composite-identity-ids-across-the-seam.md)
- [0009 — Projects come from Claude's registry](0009-projects-come-from-claudes-registry.md)
- [0010 — Splice configuration files; never write one whole](0010-splice-config-files-never-whole-file-writes.md)
- [0011 — Unsigned releases for now](0011-unsigned-releases-for-now.md)
- [0012 — Organize navigation around user tasks](0012-organize-navigation-around-user-tasks.md)

## Template

```markdown
# <imperative title>

<The decision and the forces behind it, in one or two paragraphs.>

## Considered options

- **Option.** Why rejected.
- **Option (chosen).** Why.

## Consequences

<What this buys, what it costs, what it forbids.>
```
