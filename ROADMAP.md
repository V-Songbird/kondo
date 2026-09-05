# Roadmap

Direction, not promise. Ordered by intent; dates on purpose absent.
Each item links to a plan in [docs/plans/](docs/plans/) once it is being built.

Tracked task by task in `ROADMAP.jsonl`, which `/foreman:roadmap` reads. This
file is the shape of the thing; that one is the work queue. Entry numbers in
parentheses are its ids.

## The shape kondo is heading for

Open kondo and see your **projects** — each with the skills, plugins, hooks,
agents and MCP servers attached to it, and the global scope beside them.
From there, move a thing between projects or up to global, switch it off
for one project or for all, and let kondo point at what can go: projects
whose folder is gone, scratch directories, declarations for things that no
longer exist, the same skill kept twice. Every change stays undoable.

v0.1 and v0.2 built the machinery for that — reversible writes, the kind
registry, native conventions — with the screens organised by kind rather
than by project. v0.3 turned the screens around, v0.4 made everything movable, and v0.5
put the clean-up categories behind reversible steps.

## Shipped — v0.1, the read-only core

Landed in `a5c9505` ([plan](docs/plans/v1-read-only-core.md)).

- Store discovery on Windows, macOS, Linux.
- Sessions inventory: per-project counts, sizes, last activity, staleness,
  orphaned transcripts, per-session detail on demand.
- Skills catalog across user scope, `skills.disabled`, and per-project
  skills; a plugin's own skills listed under the plugin.
- Plugins inventory from `installed_plugins.json` + `enabledPlugins` settings.
- Hooks inventory resolved from every settings layer.
- Settings viewer: user / project / local layers side by side.

## Shipped — v0.2, safe mutations

- The mutation journal and kondo trash, undo for everything
  ([plan](docs/plans/001-mutation-journal-and-trash.md)) (001).
- The kind registry and capability matrix (002).
- Enable/disable skills via the native `skills.disabled` convention (003).
- Enable/disable plugins globally or per project via `enabledPlugins` (004).
- Move a skill between scopes and between projects (copy → verify → trash
  source) (005).
- Tidy: bulk-archive stale sessions, sweep empty transcripts, orphan
  sidecars and dead caches, with a dry-run preview
  ([plan](docs/plans/006-tidy-sweep.md)) (006).
- Undo and trash surfaced in the UI, with trash size visible
  ([plan](docs/plans/007-undo-and-trash-ui.md)) (007).
- The jig session guards, and the fixes and decisions that followed
  (008–017, 022).

## Shipped — v0.3, the project view

In dependency order. The first is the foundation everything else keys on.

- **Project identity from Claude's registry** — `~/.claude.json` names the
  real path behind every `~/.claude/projects` directory
  ([ADR-0009](docs/adr/0009-projects-come-from-claudes-registry.md)). Landed
  (022). Follow-up: the project set becomes the union of the registry and
  the directory list, with `hasStore` / path-exists carried on the seam (025).
- **Read-only kinds for MCP servers** — user scope from `~/.claude.json`,
  local scope from its `projects` map, project scope from `<project>/.mcp.json`
  (which needs an ADR-0002 amendment naming that one file) (023).
- **Read-only kinds for agents, commands, rules and output styles** at user
  and project scope, with fixture builders for each (024).
- **Project attribution on the seam** — `projectId` on skills, hooks, plugin
  layer states and settings layers, and a plugin's effective state computed
  per project instead of across all projects at once (025).
- **The Projects home** — one row per project (global pinned first) with
  what is attached to it; a project page with its skills, plugins, hooks,
  agents, MCP servers and sessions and the actions inline; the sidebar
  collapses to Projects · Clean up · History; undo offered where the change
  was made (026).

## Shipped — v0.4, move everything

- Plugin move between projects as one two-layer settings edit (027).
- One `plan(entity, request)` seat in the registry and a generic mutate
  channel, so the kinds above get toggle and move without a channel each
  (035, ADR-0004 amendment).
- Promote agents, commands, rules and output styles between scopes on the
  skill-move recipe (028).
- Read `skillOverrides`, resolve a skill's effective state per layer, and
  decide which disable convention each scope writes (029, ADR-0006
  amendment).
- Hooks attributed to their project, with missing-script and unarmed-script
  signals; hook move between layers (036).
- Agents, commands and rules get the move picker on the project page, and
  output styles say why they have none (044).
- The skill toggle writes `skillOverrides` — Claude's own per-skill switch —
  instead of parking directories in `skills.disabled/` (045, ADR-0006).

## Shipped — v0.5, clean my `~/.claude`

Each is a tidy category or a listing with a reversible trash step behind it.

- Dead projects (registry path gone) and scratch projects (temp directories,
  worktrees, `.claude-jobs`) as whole-directory categories (030).
- Configuration orphans in `~/.claude.json` and the settings layers: project
  entries and MCP declarations for directories that no longer exist,
  `enabledPlugins` keys for uninstalled plugins, `skillOverrides` for
  missing skills — behind a splice step that proves the bytes it changes
  are the bytes it read (031, its own ADR).
- Duplicate skills across scopes, with a digest and a trash operation (032).
- Plugin residue (superseded cache versions, orphan manifests and data) and
  orphan `session-env` directories (033).
- Duplicate sessions: mirrored across stores, and near-duplicate opening
  prompts behind the ADR-0007 tier-2 cache (034).
- UI words: the glossary's user-facing labels applied, empty states, refusal
  reasons inline rather than in tooltips (037).
- The Leftovers view over the configuration orphans (040), and "Skills kept
  twice" on Clean up over the duplicate groups (047).
- The fixes the views turned up: the inventory notices an external registry
  write and Rescan re-reads the detail pane (051, 056), one separator for
  every display path (049), no never-used badge without a record (048), the
  staleness threshold on the seam (050), and the run-kondo fixture and driver
  that made each of them visible (043, 046, 052, 057).

## Now

Every entry the roadmap holds is done. What comes next is chosen from
Later, or from what using the app against a real store turns up.

## Later

- Desktop-app store depth: artifacts, cowork caches, per-account session
  browsing.
- Time analytics: worked time per session (active spans, not wall clock),
  timelines per project and per week.
- Packaged releases via electron-builder + GitHub Releases; code signing and
  macOS notarization ([docs/release.md](docs/release.md)).
- End-to-end tests driving the built app.
- A permission-denied adapter fixture, the one case docs/testing.md names and
  no test covers — it has no reliable cross-platform recipe yet.

## Non-goals

These are boundaries, not backlog:

- Kondo never reads project files. The only project content it opens is the
  project's `.claude/` directory — and, once entry 023 amends ADR-0002, the
  Claude-owned `<project>/.mcp.json` beside it. See
  [ADR-0002](docs/adr/0002-project-privacy-boundary.md).
- No cloud component, no sync, no telemetry.
- Not a Claude client: kondo never talks to models or APIs.
- Not a skill marketplace; installing third-party skills stays out of scope
  (skilldex already does that well).
