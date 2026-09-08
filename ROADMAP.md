# Roadmap

Direction, not promise. Ordered by intent; dates on purpose absent.
Each item links to a plan in [docs/plans/](docs/plans/) once it is being built.

This file is the public direction. Maintainers track work locally in the ignored
`ROADMAP.jsonl` queue through Foreman; it and `.foreman/` are not included in
clones. Entry numbers in parentheses are references to that local history;
public plans and ADRs carry the reusable context. See the
[publication policy](docs/adr/0013-keep-working-records-local.md).

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
  missing skills — behind a splice step that proves the bytes it changes
  are the bytes it read (031, its own ADR).
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

## Now — the road to a release someone else can trust

The release-readiness work comes from a six-dimension audit on 2026-09-05:
mutation safety, the release pipeline, public-repo readiness, first-run
experience, cross-platform correctness and quality gates. The local, ignored
`ROADMAP.jsonl` records each entry's status; the list below preserves the release
sequence rather than implying that every item is still unimplemented.

On 2026-09-06, code review confirmed 072, 073, 075 and 076 already implemented.
The [Claude Code review](docs/plans/2026-09-06-claude-usability-review.md)
implements 087, 090 and 095 for owner review and records additional compatibility
and safety gaps. This is not release acceptance or completion of rehearsal 071.

Four decisions frame them and are not up for re-argument here:

- **v1.0 means a stranger can trust it** — install kondo, point it at their own
  `~/.claude`, and mutate safely. The Later section below stays out of scope.
- **Windows is verified; macOS and Linux ship untested** and must say so.
- **The repository goes public** at release.
- **Releases stay unsigned** under [ADR-0011](docs/adr/0011-unsigned-releases-for-now.md).
  Honest install docs, not certificates.

### v0.6 — the first tagged release

Safety before packaging. The four initial blockers below have landed; 071's
copy-of-store rehearsal still needs to be performed:

- 072 splice the settings toggles with a digest guard instead of whole-file writes;
  ADR-0010 already forbids what `kinds.ts` does today, and all ten real writes so
  far took that path.
- 073 displace whatever occupies a restore path before an undo renames over it.
- 075 stop an unreadable or unmounted project path from being reported `gone` and
  offered for wholesale trashing.
- 076 stage every move picker behind a confirm, and confirm the one-click trash —
  one keypress on a focused select currently moves files.
- 071 then rehearses every destructive path, with undo, against a copy of a real
  store. 074 hardens the splice write against a crash and a symlink.

Then the pipeline, which has never run: 077 build from the lockfile and lock both
workflows down, 078 make one tag produce one complete draft that can be rehearsed
without a tag, 079 attach SHA-256 checksums and CHANGELOG-derived notes, 080 smoke
the artifacts that actually ship rather than the unpacked directories, 081 say which
platform is verified and fix the per-OS install recipes.

Then what a public repository and a first launch need: 082 untrack the private and
machine-local files, 083 ship the IBM Plex OFL notice with the installers, 084 take
the single-instance lock and pin ADR-0004's window settings in a test, 085 catch
renderer exceptions and outbound requests in the smoke test, 086 delete the `TMP_OK`
gate that lets 22 mutation and undo tests skip silently, 087 define Library's missing
`.line` rule, 088 catch a render-time throw instead of blanking the window, and 089
tell the README where kondo's own data lives and how to rehearse on a copy.

### v1.0 — the public invitation

- 090 give every control a name, a role and a keyboard route.
- 091 route `XDG_CONFIG_HOME` and `os.tmpdir()` through the store locator.
- 092 covers permission-denied adapter behavior with deterministic injected
  `EACCES` fixtures; [docs/testing.md](docs/testing.md) describes the coverage
  and its native OS ACL limitation.
- 093 prove an absent `~/.claude` neither throws nor floods the first read.
- 094 close the two seam promises no test proves.
- 095 drop a malformed journal line the way a bad parse already is.
- 096 prepare the public repo surface a stranger lands on.

The release itself is the owner's to cut ([docs/release.md](docs/release.md)).

### Desktop session boundary and truthful removal scope

The [108 decision package](docs/plans/108-desktop-session-boundary.md) and
[ADR-0016](docs/adr/0016-desktop-session-boundary.md) choose partial, read-only
Desktop session support, **accepted by the owner**. Code session removal
moves a reviewed transcript and recognized companions; global prompt history,
environment snapshots, file history, backups, Desktop copies and Kondo's retained
data can remain. Unified session removal and privacy erasure are not shipped or
promised. The existing Desktop cache allowlist remains separate.

- **Reconcile the in-app claims (110):** with 108 accepted and after the other recorded dependencies
  (107/109) are resolved, label Code-only scope, filename matches and released markers
  accurately. Disclose exact removal candidates and residual data before
  confirmation; preserve keyboard flow, focus return and fresh main-process
  review. The plan names the required fixture and UI evidence.
- **Complete removal-size accounting (105, depends on 102):** include every
  moved companion before calling a number the full removal size. Coordinate
  with 110's candidate disclosure; this decision makes no size fix.
- **Retain the recovery limits:** concurrent writes (098) and failed/partial
  Undo outcomes (099) remain separate release-safety work. A session scope
  decision does not establish those guarantees.

### Hook declaration boundary

The [109 decision package](docs/plans/109-hook-layer-boundary.md) and proposed
[ADR-0017](docs/adr/0017-hook-layer-boundary.md) retain read-only hook declarations
and correct the earlier shipped-move claim, **awaiting owner acceptance**.
Inventory is limited to the settings layers Kondo reads; script diagnostics do
not prove which hooks execute or that a layer move preserves behavior. No move
implementation is commissioned. Product-copy reconciliation (110) and
conservative script cleanup (101) remain separate tracked work.

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
  project's `.claude/` directory — and, once entry 023 amends ADR-0002, the
  Claude-owned `<project>/.mcp.json` beside it. See
  [ADR-0002](docs/adr/0002-project-privacy-boundary.md).
- No cloud component, no sync, no telemetry.
- No complete conversation erasure or unified Desktop/Code session deletion;
  local removal can leave other records and copies (ADR-0016).
- Not a Claude client: kondo never talks to models or APIs.
- Not a skill marketplace; installing third-party skills stays out of scope
  (skilldex already does that well).
