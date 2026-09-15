# Architecture decision records

One file per decision that is in force and was hard, is hard to reverse, or
keeps getting re-asked. Each ADR states the decision as it stands: when it
changes, rewrite it in place; when it no longer holds, delete the file — Git
keeps the history. Numbers are never reused or renumbered, so a gap is a
deleted decision. Keep a reason or a rejected alternative only where it stops a
mistake being repeated, and leave out status, date and entry history.

The filenames of 0001–0008 are cited by `.claude/rules/jig-governance.md`, and
code comments cite ADRs by number, so a rewrite keeps its file.

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
- [0010 — Plan configuration edits as splices; refuse them until concurrent writes are preserved](0010-splice-config-files-never-whole-file-writes.md)
- [0011 — Unsigned releases, for now](0011-unsigned-releases-for-now.md)
- [0012 — Organize navigation around user tasks](0012-organize-navigation-around-user-tasks.md)
- [0013 — Keep private working records local](0013-keep-working-records-local.md)
- [0014 — Reload through a parameterless window lifecycle signal](0014-reload-through-window-lifecycle.md)
- [0015 — Bind removal to the state the user reviewed](0015-bind-removal-to-reviewed-state.md)
- [0016 — Keep Desktop sessions read-only and name removal scope](0016-desktop-session-boundary.md)
- [0017 — Keep hook declarations read-only until semantics are proven](0017-hook-layer-boundary.md)
- [0018 — Confirm Undo effects and resume recorded actions](0018-confirm-undo-effects-and-resume.md)
- [0019 — Frame logical tree digests and identify persisted fingerprints](0019-frame-logical-tree-digests.md)
- [0020 — Frame physical recovery digests and identify move fingerprints](0020-frame-physical-recovery-digests.md)
- [0021 — Summarize settings files instead of promising an effective-settings viewer](0021-summarize-settings-files.md)
- [0022 — Project settings-derived data deny-by-default](0022-project-settings-data-deny-by-default.md)

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
