# Roadmap

Direction, not promise. Ordered by intent; dates on purpose absent.
Each item links to a plan in [docs/plans/](docs/plans/) once it is being built.

Tracked task by task in `ROADMAP.jsonl`, which `/foreman:roadmap` reads. This
file is the shape of the thing; that one is the work queue.

## Shipped — v0.1, the read-only core

Landed in `a5c9505` ([plan](docs/plans/v1-read-only-core.md)).

- Store discovery on Windows, macOS, Linux.
- Sessions inventory: per-project counts, sizes, last activity, staleness,
  orphaned transcripts, per-session detail on demand.
- Skills catalog across user scope, `skills.disabled`, plugin-shipped, and
  per-project skills.
- Plugins inventory from `installed_plugins.json` + `enabledPlugins` settings.
- Hooks inventory resolved from every settings layer.
- Settings viewer: user / project / local layers side by side.

## Now — v0.2, safe mutations

- The mutation journal and kondo trash, undo for everything
  ([plan](docs/plans/001-mutation-journal-and-trash.md)).
- The kind registry and capability matrix (docs/foundations.md, growth path).
- Enable/disable skills via the native `skills.disabled` convention.
- Enable/disable plugins globally or per project via `enabledPlugins`.
- Move a skill between scopes and between projects (copy → verify → trash
  source).
- Tidy: bulk-archive stale sessions, sweep empty transcripts and dead caches,
  with a dry-run preview before anything moves.
- Undo and trash surfaced in the UI, with trash size visible (SECURITY.md).
- Register the jig session guards so they fire live, not only in CI.

## Later

- Desktop-app store depth: artifacts, cowork caches, per-account session
  browsing.
- Time analytics: worked time per session (active spans, not wall clock),
  timelines per project and per week.
- Duplicate intelligence: same-id sessions across stores, near-duplicate
  detection (same first prompt, forked transcripts), duplicate skills across
  scopes with diff view. Empty-transcript detection ships here too.
- Packaged releases via electron-builder + GitHub Releases; code signing and
  macOS notarization ([docs/release.md](docs/release.md)).
- End-to-end tests driving the built app.
- A permission-denied adapter fixture, the one case docs/testing.md names and
  no test covers — it has no reliable cross-platform recipe yet.

## Non-goals

These are boundaries, not backlog:

- Kondo never reads project files. The only project content it opens is the
  project's `.claude/` directory. See [ADR-0002](docs/adr/0002-project-privacy-boundary.md).
- No cloud component, no sync, no telemetry.
- Not a Claude client: kondo never talks to models or APIs.
- Not a skill marketplace; installing third-party skills stays out of scope
  (skilldex already does that well).
