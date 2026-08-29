# Plan: v0.1 read-only core

Status: **in progress**

The first runnable kondo: scan every store, show the truth, mutate nothing.
Ships the architecture every later feature rides on — locator, adapters,
seam, feature-folder UI.

## Scope

**Workspace (main process)**

- `StoreLocator` with per-OS defaults and injected/env overrides (ADR-0003).
- Adapters (ADR-0005 result shape `{ data, errors, unknown }`):
  - `user-store`: settings.json summary, skills + skills.disabled, plugins
    (installed_plugins.json joined with enabledPlugins), hooks from settings,
    top-level entry sizes for the housekeeping view.
  - `sessions`: tier-1 inventory of `projects/` (per-project session counts,
    sizes, mtimes, staleness, orphan flags) per ADR-0007; tier-2 detail for
    one session (first/last line, message count, streamed).
  - `project-store`: given known project dirs, read `.claude` settings
    layers, skills, hooks (ADR-0002 boundary).
  - `desktop-store`: session inventory of `local-agent-mode-sessions`,
    bulk sizes for the rest; identity/token files listed by name+size only.
- Analysis: staleness and duplicate-by-session-id joins as pure functions.

**Seam**

- Typed channels: `stores.overview`, `sessions.list`, `sessions.detail`,
  `skills.list`, `plugins.list`, `hooks.list`, `settings.layers`.
  Request/response types shared between main and renderer from one module.
  No renderer-supplied paths; ids only.

**Renderer**

- Shell with sidebar: Dashboard, Sessions, Skills, Plugins, Hooks, Settings.
- Dashboard: store cards (location, size, counts, problem count).
- Sessions: per-project table → sessions with staleness/size; detail pane on
  demand (tier 2). Skills/Plugins/Hooks/Settings: tables from their channels,
  scope-labeled. Every view renders the adapter's `errors` list.

## Out of scope (v0.2+)

All mutations (journal, trash, toggles, moves), watcher-based refresh,
worked-time analytics, near-duplicate detection, packaged installers.

## Tests

Fixture user store (healthy + broken variants), fixture desktop store;
adapter units, analysis tables, seam integration per docs/testing.md; the
ADR-0002/0003 safety invariants.

## Done when

`npm run dev` on a real machine shows true numbers for all six views with no
thrown scan; suite green on the three OSes.
