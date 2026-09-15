# Roadmap

Direction, not promise. Ordered by intent; dates on purpose absent. What
kondo does today is in [README.md](README.md), what changed per release in
[CHANGELOG.md](CHANGELOG.md), and where work stands right now in
[docs/status.md](docs/status.md).

This file is the public direction. Maintainers track work locally in the
ignored `ROADMAP.jsonl` queue through Foreman; it and `.foreman/` are not
included in clones. Numbers in parentheses refer to entries in that queue;
plans and ADRs carry the reusable context
([ADR-0013](docs/adr/0013-keep-working-records-local.md)).

## Current safety restriction

Settings execution is suspended on every platform. Any plan with `write` or
`splice` steps, and any historical Undo entry containing them, refuses whole
before journal or filesystem effects; missing-file creation is included.
Existing history and recovery bytes remain intact, and unrelated moves, trash
and their Undo keep their checks. This covers settings-based skill, plugin and
MCP toggles, plugin clearing and scope changes, configuration-leftover removal
and settings-bearing skill moves. Re-enabling needs a preservation backend with
native concurrency and recovery evidence
([ADR-0010](docs/adr/0010-splice-config-files-never-whole-file-writes.md)).

## The shape kondo is heading for

Open kondo and see your **projects** — each with the skills, plugins, hooks,
agents and MCP servers attached to it, and the global scope beside them.
From there, move or switch off supported kinds in the scopes their capabilities
allow, and let kondo point at what can go: projects whose folder is gone,
scratch directories, declarations for things that no longer exist, the same
skill kept twice. Every change stays undoable.

The machinery for that has shipped — journaled moves and trash with Undo, the
kind registry and capability matrix, native conventions, reviewed cleanup and
a Library-first task navigation — within three accepted limits: settings
changes are refused (above), hook declarations stay read-only
([ADR-0017](docs/adr/0017-hook-layer-boundary.md)), and Desktop sessions stay
read-only with a named removal scope
([ADR-0016](docs/adr/0016-desktop-session-boundary.md)).

## Now — the road to a release someone else can trust

Four decisions frame this work and are not up for re-argument here:

- **v1.0 means a stranger can trust it** — install kondo, point it at their own
  `~/.claude`, and mutate safely. The Later section below stays out of scope.
- **Windows is verified; macOS and Linux ship untested** and must say so.
- **The repository goes public** at release.
- **Releases stay unsigned** under [ADR-0011](docs/adr/0011-unsigned-releases-for-now.md).
  Honest install docs, not certificates.

### In progress

- **The sandboxed-preload startup failure (132).** Windows smoke runs under load
  sometimes fail because Electron's sandbox bundle starts without its startup
  data (`binding.startupData` is null), and one bad launch fails every later
  test. Find whether Electron, the smoke harness or kondo's startup causes it.

### Accuracy and compatibility

- **MCP approval and disable scopes (103)**, including projects that hold only
  `.mcp.json`: a faithful model of settings, per-project disable lists and
  approvals, with toggle fixtures. An unreadable local MCP project path must not
  read as a removable orphan (135); coordinate its order with 103.
- **Every companion file counted in removal size estimates (105).** Until then,
  a transcript's size must not be labelled the full removal size.
- **Every plugin installation and component layout (106):** inventory across
  scopes, and one fixture per supported layout.
- **Unreadable hook scripts reported as unverifiable rather than missing (127).**
- **Non-boolean `enabledPlugins` values never read as a definite plugin state (129).**

### Privacy and safety

- Kondo's data directory never resolving inside a Claude store (115).
- Release tags bound to the reviewed main candidate (119).

### Product claims (110)

In-app wording reconciled with the accepted decisions. Acceptance criteria:

1. Projects → Conversations says its rows are Code transcripts. A Desktop
   filename match reads as a matching ID with unverified contents and a
   released marker as a marker; a missing match is never shown as proof of
   absence.
2. Before removal, disclose the exact candidate transcript, present sidecar and
   marker, and the records that remain (prompt history, snapshots, file
   history, backups, Desktop copies, Kondo's trash), with the selected project
   and session identities in a bounded list.
3. Keep main-owned opaque ids and review tokens, fresh candidate validation and
   serialization with mutation and Undo
   ([ADR-0015](docs/adr/0015-bind-removal-to-reviewed-state.md)). A seam
   addition for exact file descriptors moves contract, workspace, IPC, preload
   and renderer together and exposes display-safe descriptors only.
4. Moved-byte totals are coordinated with 105.
5. Hooks: describe inventoried declarations, say "Kondo does not support
   switching individual hooks", show an unrecognized script as "No script
   recognized", and never describe a retained hook script as one nothing runs.
6. Signal controls, explicit confirmation, visible focus, accessible names,
   Escape and focus return; a stale selection requires a new review.
7. Synthetic fixtures with every residual, a mirrored Desktop record, unknown
   siblings and a released marker: exact moved paths, byte preservation of
   residuals, Desktop and mixed-id refusal without journal writes, Undo
   restoration, and UI checks of disclosure, keyboard cancellation and focus
   return.

### Tooling and evidence

- Intermittent focus loss in the Library smoke (120).
- run-kondo stopping only the process it launched (124).
- The Jig edit-guard false positive and the repository session lane (125).
- The pre-commit hook's Unix mode (126).
- Complete third-party notices, including React and React DOM, with a notice
  check in the release workflow (133).
- The real-store guard scanning every test file type, not only `test/**/*.ts` (134).

### Publication

- Personal context still in the tree removed from the publication snapshot (123).
- A public identity and destination for strategy A, a separate public
  repository with a new root commit
  ([plan 111](docs/plans/111-public-history-decision.md)).
- Finally, 114 revalidates the exact candidate: fresh hosted checks on all
  three platforms, packaged smoke, cleanup and recovery rehearsal, a privacy
  re-audit of the final SHA and the release notes. The release itself is the
  owner's to cut ([docs/release.md](docs/release.md)).

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
