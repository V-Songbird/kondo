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

- **Unreadable hook scripts reported as unverifiable rather than missing (127).**
- **A `CLAUDE_CONFIG_DIR` set in a Claude settings `env` block followed (138).**
- **A legacy `.config.json` registry in a configuration home read (139).**
- **Transcripts stored under `CLAUDE_CODE_PROJECT_DIR_NAME` located (140).**
- **MCP allowlists and URL or command deny rules evaluated (143).**
- **`.mcp.json` reads measured on a large registry before the release
  candidate (144).**
- **The version-1 and `installed_plugins_v2.json` plugin files read as Claude
  Code does (151).**
- **The managed plugin scope in the capability matrix (152).**
- **The plugin components kondo does not list inventoried (153).**
- **A non-object `enabledPlugins` root and non-string legacy array members
  reported (154).**

### Privacy and safety

- Kondo's data directory never resolving inside a Claude store (115).
- A profile data root keyed by its resolved path, and a refusal that names the
  store set (141).
- Raw filesystem exception text kept out of `Scan.errors` (155).

### Tooling and evidence

- Intermittent focus loss in the Library smoke (120).
- run-kondo stopping only the process it launched (124).
- The Jig edit-guard false positive and the repository session lane (125).
- The pre-commit hook's Unix mode (126).
- The real-store guard scanning every test file type, not only `test/**/*.ts` (134).
- Repository checks that never collect `.claude/worktrees` (137).
- The bundle inventory diffed against the notice table in CI (142).
- The run-kondo fixture location and screenshot traps recorded in the skill (148).
- Drifting `file:line` anchors in [docs/status.md](docs/status.md) caught by a
  jig check (149).
- The seam-contract check reworded for amended ADRs (150).
- The JetBrains MCP rule scoped to the checkout WebStorm has open (156).

### Publication

- A public identity and destination for strategy A, a separate public
  repository with a new root commit
  ([plan 111](docs/plans/111-public-history-decision.md)).
- Finally, once 120 is settled, 114 revalidates the exact candidate: fresh
  hosted checks on all three platforms, packaged smoke, cleanup and recovery
  rehearsal, a privacy re-audit of the final SHA and the release notes. The
  release itself is the owner's to cut ([docs/release.md](docs/release.md)).

## Later

- Desktop-app store depth beyond the caches: whether `vm_bundles/` (9.3 GB)
  and superseded `claude-code/<version>/` directories are rebuilt, and a
  category for each only after evidence and a separate decision. Per-account
  session browsing and artifact management also require a new decision under
  ADR-0016; they are not part of the supported session workflow.
- Time analytics: worked time per session (active spans, not wall clock),
  timelines per project and per week.
- An in-app picker for the Claude profile kondo reads (145).
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
