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
- [0013 — Keep private working records local](0013-keep-working-records-local.md)
- [0014 — Reload through a window lifecycle signal](0014-reload-through-window-lifecycle.md)

- [0015 — Bind removal to reviewed state](0015-bind-removal-to-reviewed-state.md)
- [0016 — Keep Desktop sessions read-only and name removal scope](0016-desktop-session-boundary.md) — **accepted**
- [0017 — Keep hook declarations read-only until semantics are proven](0017-hook-layer-boundary.md) — **accepted**

- [0018 — Confirm Undo effects and resume](0018-confirm-undo-effects-and-resume.md)
- [0019 — Frame logical tree digests](0019-frame-logical-tree-digests.md)

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
