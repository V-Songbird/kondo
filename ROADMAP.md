# Roadmap

Direction, not promise. Ordered by intent; dates on purpose absent.
Each item links to a plan in [docs/plans/](docs/plans/) once it is being built.

This file is the public direction. Maintainers track work locally in the ignored
`ROADMAP.jsonl` queue through Foreman; it and `.foreman/` are not included in
clones. Entry numbers in parentheses are references to that local history;
public plans and ADRs carry the reusable context. See the
[publication policy](docs/adr/0013-keep-working-records-local.md).

## Current safety restriction (098)

Settings execution is temporarily suspended on every platform. Any plan with
`write` or `splice` steps, and any historical Undo entry containing them,
refuses whole before journal or filesystem effects. Missing-file creation is
included. Existing history and recovery bytes remain intact. Unrelated moves,
trash and their Undo retain their existing checks.

This affects settings-based skill, plugin and MCP toggles, plugin clearing and
scope changes, configuration-leftover removal and settings-bearing skill moves.
The shipped sections below record earlier capabilities and intent; they do not
override this restriction. Re-enabling settings changes requires a preservation
backend with native concurrency and recovery evidence. See
[the current plan](docs/plans/098-concurrent-settings-writes.md) and
[ADR-0010](docs/adr/0010-splice-config-files-never-whole-file-writes.md).

## The shape kondo is heading for

Open kondo and see your **projects** — each with the skills, plugins, hooks,
agents and MCP servers attached to it, and the global scope beside them.
From there, move or switch off supported kinds in the scopes their capabilities
allow, and let kondo point at what can go: projects
whose folder is gone, scratch directories, declarations for things that no
longer exist, the same skill kept twice. Every change stays undoable.

v0.1 and v0.2 built the machinery for that — reversible writes, the kind
registry, native conventions — with the screens organised by kind rather
than by project. v0.3 turned the screens around, v0.4 expanded moves for
supported kinds, and v0.5 put the clean-up categories behind reversible steps.
Hook declarations remain read-only; their layer moves have not shipped.

## Shipped — v0.1, the read-only core

Landed in `a5c9505` ([plan](docs/plans/v1-read-only-core.md)).

- Store discovery on Windows, macOS, Linux.
- Code sessions inventory: per-project counts, sizes, last activity, staleness,
  orphaned transcripts, per-session detail on demand.
- Skills catalog across user scope, `skills.disabled`, and per-project
  skills; a plugin's own skills listed under the plugin.
- Plugins inventory from `installed_plugins.json` + `enabledPlugins` settings.
- Hooks inventory from the user settings file and verified projects' project
  and local settings files.
- Settings-file summaries for user, project and local scopes. Supported skill
  and plugin precedence is shown in their management sections; a general
  effective-settings viewer has not shipped
  ([ADR-0021](docs/adr/0021-summarize-settings-files.md)).

## Shipped — v0.2, safe mutations

- The mutation journal and kondo trash, undo for everything
  ([plan](docs/plans/001-mutation-journal-and-trash.md)) (001).
- The kind registry and capability matrix (002).
- Enable/disable skills by parking them in `skills.disabled/` (003), later
  found to be Kondo's own convention rather than Claude's and replaced by
  `skillOverrides` (045).
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
  (the one file ADR-0002's amendment names) (023).
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

## Shipped — v0.4, moves for supported kinds

- Plugin move between projects as one two-layer settings edit (027).
- One `plan(entity, request)` seat in the registry and a generic mutate
  channel, so the kinds above get toggle and move without a channel each
  (035, ADR-0004 amendment).
- Promote agents, commands, rules and output styles between scopes on the
  skill-move recipe (028).
- Read `skillOverrides`, resolve a skill's effective state per layer, and
  decide which disable convention each scope writes (029, ADR-0006
  amendment).
- Hooks attributed to their project, with limited script-health signals and a
  separate user-store script cleanup category (036). Hook declarations remain
  read-only: no layer move, enable/disable or declaration removal has shipped
  ([decision 109](docs/plans/109-hook-layer-boundary.md)).
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
  missing skills — originally edited with digest-checked splices (031,
  ADR-0010). The digest did not prevent writes racing with replacement;
  removal is now refused under 098 while inventory remains available.
- Duplicate skills across scopes, with a digest and a trash operation (032).
- Plugin residue (superseded cache versions, orphan manifests and data) and
  orphan `session-env` directories (033).
- Session comparison signals: matching IDs in Desktop filenames, and similar
  Code opening prompts behind the ADR-0007 tier-2 cache (034). These do not
  establish equal contents or a unified Desktop/Code management workflow.
- UI words: the glossary's user-facing labels applied, empty states, refusal
  reasons inline rather than in tooltips (037).
- The Leftovers view over the configuration orphans (040), and "Skills kept
  twice" on Clean up over the duplicate groups (047).
- The fixes the views turned up: the inventory notices an external registry
  write and Rescan re-reads the detail pane (051, 056), one separator for
  every display path (049), no never-used badge without a record (048), the
  staleness threshold on the seam (050), and the run-kondo fixture and driver
  that made each of them visible (043, 046, 052, 057).

## Shipped — the real-store audit, 2026-09-05

Running kondo read-only against a store of 11,517 projects and 10.9 GB of
desktop data turned up what the fixture never could. Each finding became an
entry and shipped the same day:

- A projects home that works at that scale: rows named by their last path
  segment, throwaway runs and gone projects folded behind a count, the rest
  paged (060).
- Transcript-less directories holding Claude's `memory/` are no longer swept
  as throwaway (058); the desktop app's `.desktop-released.json` markers are
  recognised and the conversations it deleted are their own Clean up
  category (059).
- Two switches the shape promised and the code refused: an MCP server off
  per project through Claude's own disable lists (061), and a global skill
  off for one project from that project's page (062).
- The desktop store named entry by entry in domain.md, and its Chromium
  caches as a Clean up category that refuses while the app runs (063).
- Version 0.5.0 stamped into the footer and README (064), an end-to-end smoke
  driving the built app in CI (065), and packaged installers from a tag,
  unsigned for now under ADR-0011 (066).

## Shipped — Library and the Flat File look, 2026-09-05

- **Library**, a fifth destination and the other lens on the same set: the
  named object is the row, a project is one filter over it, and `Needs a
  look` collects the findings and says why each one is a finding (067). It
  answers where a skill lives and which hook declarations the scanned settings
  hold without opening 11,517 project pages, and needed no main-process work — five bridge
  channels were already wired and never called.
- The **Flat File** look applied: dark only, mono, sigils instead of
  containers, a `k_` mark drawn once for the icon, the rail and the splash,
  and IBM Plex bundled so nothing is fetched (068).
- The splash **owns the first read** rather than the first painted frame, so
  the window opens with rows in it and `Scanning…` never appears on launch
  (069). ADR-0004 gains the amendment for the lifecycle channel that carries
  the handover.
- A `description` written as a YAML block scalar is read as the paragraph
  rather than as its `>-` header (070) — the shape nearly every skill on a
  real machine uses, and every kind read from markdown frontmatter benefits.

## Shipped — the task-first workflow and Signal themes, 2026-09-06

- Library became the starting screen, with four task destinations — Library,
  Projects, Clean up and History — and a separate Themes control. Settings
  leftovers and duplicate skills moved inside Clean up
  ([ADR-0012](docs/adr/0012-organize-navigation-around-user-tasks.md),
  [plan](docs/plans/2026-09-06-ux-workflow.md)).
- The Signal visual system replaced Flat File, with six themes and Chalk as
  the default ([plan](docs/plans/2026-09-06-signal-themes.md),
  [DESIGN.md](DESIGN.md)).

## Shipped — release readiness, 2026-09-05 to 2026-09-07

A six-dimension audit on 2026-09-05 — mutation safety, the release pipeline,
public-repo readiness, first-run experience, cross-platform correctness and
quality gates — produced entries 071–096. All have shipped:

- Safety: settings toggles planned as digest-checked splices (072), occupied
  restore paths displaced before Undo (073), splice temporaries synced and
  confined to resolved stores (074), unreadable project paths no longer
  reported as gone (075), every move picker and duplicate trash staged behind
  a confirmation (076), and a rehearsal of every destructive path, with Undo,
  against an isolated copy of a real store (071).
- Pipeline: lockfile builds and locked-down workflows (077), one complete
  draft per tag with a tagless rehearsal (078), checksums and CHANGELOG notes
  (079), smoke of the shipped artifacts (080), and per-platform evidence and
  install recipes (081). Hosted CI and a release rehearsal passed on all three
  platforms on 2026-09-07 ([plan 113](docs/plans/113-hosted-ci-rehearsal.md)).
- Public surface and first run: private working records kept local (082), the
  bundled IBM Plex notice (083), the single-instance lock with pinned window
  security (084), renderer exceptions and requests caught by the smoke (085),
  no silently skipped mutation tests (086), Library's missing `.line` rule
  (087), render-failure recovery (088), documented data locations and copy
  rehearsal (089), named controls and keyboard routes (090), locator-owned XDG
  and temporary roots (091), permission-denied adapter coverage (092), a quiet
  first read on an absent store (093), session paths kept in main (094),
  malformed journal lines dropped whole (095) and the public repository
  surface (096).

## Shipped — publication-audit hardening, 2026-09-07 to 2026-09-15

A publication audit on 2026-09-07 reproduced defects in classification,
confirmation, concurrency, Undo and privacy. Shipped and accepted:

- Store reads, transcript streams and recursive copies confined to their
  resolved store ([plan 097](docs/plans/097-resolved-store-boundaries.md)).
- Settings writes, missing-layer creation and historical settings Undo refused
  on every platform until a preservation backend exists
  ([plan 098](docs/plans/098-concurrent-settings-writes.md); see the
  restriction above).
- Undo that records intent, progress and completion, and resumes without
  repeating confirmed actions ([plan 099](docs/plans/099-undo-recovery.md),
  [ADR-0018](docs/adr/0018-confirm-undo-effects-and-resume.md)).
- Configuration leftovers offered only when inventory proves absence, with
  every skill override kept
  ([plan 100](docs/plans/100-conservative-config-inventory.md)).
- Hook scripts never offered for cleanup, because execution coverage is
  incomplete ([plan 101](docs/plans/101-conservative-hook-cleanup.md)).
- Removal bound to the exact reviewed candidates and revalidated before any
  change ([plan 102](docs/plans/102-reviewed-cleanup.md),
  [ADR-0015](docs/adr/0015-bind-removal-to-reviewed-state.md)).
- Unambiguous logical and physical tree digests for duplicate verdicts, copy
  verification and recovery ([plan 118](docs/plans/118-framed-tree-digests.md),
  [plan 121](docs/plans/121-physical-recovery-digests.md)), with the fixture
  write observer and snapshot helper corrected alongside (116, 122).
- Settings-derived data kept in the main process: settings summaries name only
  documented settings, hook rows show documented events and handler types
  without commands, matcher patterns or script paths, MCP transports are
  validated, and malformed files are reported without quoting them
  ([plan 117](docs/plans/117-renderer-privacy.md),
  [ADR-0022](docs/adr/0022-project-settings-data-deny-by-default.md)).
- Decisions: Desktop sessions stay read-only with a named removal scope
  ([ADR-0016](docs/adr/0016-desktop-session-boundary.md)); hook declarations
  stay read-only ([ADR-0017](docs/adr/0017-hook-layer-boundary.md)); settings
  files are summarized rather than resolved
  ([ADR-0021](docs/adr/0021-summarize-settings-files.md)); a public-history
  package, with strategy A (a new public root) chosen on 2026-09-15
  ([plan 111](docs/plans/111-public-history-decision.md)); and a private
  security contact with a latest-stable-only maintenance policy
  ([plan 112](docs/plans/112-security-reporting-maintenance.md)).

## Now — the road to a release someone else can trust

Four decisions frame this work and are not up for re-argument here:

- **v1.0 means a stranger can trust it** — install kondo, point it at their own
  `~/.claude`, and mutate safely. The Later section below stays out of scope.
- **Windows is verified; macOS and Linux ship untested** and must say so.
- **The repository goes public** at release.
- **Releases stay unsigned** under [ADR-0011](docs/adr/0011-unsigned-releases-for-now.md).
  Honest install docs, not certificates.

Open work:

- Accuracy and compatibility: MCP approval and disable scopes, including
  projects that hold only `.mcp.json` (103); alternate Claude profiles through
  `CLAUDE_CONFIG_DIR` (104); every companion file counted in size estimates
  (105); every plugin installation and component layout (106); unreadable
  hook scripts reported as unverifiable rather than missing (127); and
  non-boolean `enabledPlugins` values never read as a definite plugin state
  (129).
- Privacy and safety: plugin installation keys that are not plugin ids kept
  out of scan diagnostics, the follow-up to 117 (131); Kondo's data directory
  never resolving inside a Claude store (115); and release tags bound to the
  reviewed main candidate (119).
- Product claims: in-app wording reconciled with the accepted decisions (110).
- Tooling and evidence: intermittent focus loss in the Library smoke (120), the
  Electron sandboxed-preload startup failure that fails Windows smoke runs
  under load (132), run-kondo stopping only the process it launched (124), the
  Jig edit-guard false positive and the repository session lane (125), the
  pre-commit hook's Unix mode (126), and personal context still in the tree
  (123).
- The owner chose strategy A, a separate public repository with a new root
  commit, on 2026-09-15; the public identity and destination are still to
  choose ([plan 111](docs/plans/111-public-history-decision.md)).
- Finally, 114 revalidates the exact candidate: fresh hosted checks on all
  three platforms, packaged smoke, cleanup and recovery rehearsal, a privacy
  re-audit of the final SHA and the release notes. The release itself is the
  owner's to cut ([docs/release.md](docs/release.md)).

### Desktop session boundary and truthful removal scope

The [108 decision package](docs/plans/108-desktop-session-boundary.md) and
[ADR-0016](docs/adr/0016-desktop-session-boundary.md) choose partial, read-only
Desktop session support, **accepted by the owner**. Code session removal
moves a reviewed transcript and recognized companions; global prompt history,
environment snapshots, file history, backups, Desktop copies and Kondo's retained
data can remain. Unified session removal and privacy erasure are not shipped or
promised. The existing Desktop cache allowlist remains separate.

- **Reconcile the in-app claims (110):** label Code-only scope, filename
  matches and released markers accurately. Disclose exact removal candidates
  and residual data before confirmation; preserve keyboard flow, focus return
  and fresh main-process review. The plan names the required fixture and UI
  evidence.
- **Complete removal-size accounting (105):** include every moved companion
  before calling a number the full removal size, coordinated with 110's
  candidate disclosure.
- **Recovery limits:** 098 refuses unsafe settings writes and 099 records
  honest Undo outcomes; the session scope decision itself establishes neither.

### Hook declaration boundary

The [109 decision package](docs/plans/109-hook-layer-boundary.md) and accepted
[ADR-0017](docs/adr/0017-hook-layer-boundary.md) retain read-only hook declarations
and correct the earlier shipped-move claim, **accepted by the owner**.
Inventory is limited to the settings layers Kondo reads; script diagnostics do
not prove which hooks execute or that a layer move preserves behavior. No move
implementation is commissioned. Conservative script cleanup has shipped (101);
product-copy reconciliation remains open (110).

## Later

- Desktop-app store depth beyond the caches: whether `vm_bundles/` (9.3 GB)
  and superseded `claude-code/<version>/` directories are rebuilt, and a
  category for each only after evidence and a separate decision. Per-account
  session browsing and artifact management also require a new decision under
  ADR-0016; they are not part of the supported session workflow.
- Time analytics: worked time per session (active spans, not wall clock),
  timelines per project and per week.
- Code signing and macOS notarization, when ADR-0011's conditions hold.

## Non-goals

These are boundaries, not backlog:

- Kondo never reads project files. The only project content it opens is the
  project's `.claude/` directory and the Claude-owned `<project>/.mcp.json`
  beside it. See [ADR-0002](docs/adr/0002-project-privacy-boundary.md).
- No cloud component, no sync, no telemetry.
- No complete conversation erasure or unified Desktop/Code session deletion;
  local removal can leave other records and copies (ADR-0016).
- Not a Claude client: kondo never talks to models or APIs.
- Not a skill marketplace; installing third-party skills stays out of scope
  (skilldex already does that well).
