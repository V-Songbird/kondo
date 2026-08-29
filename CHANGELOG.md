# Changelog

All notable changes to kondo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and kondo adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Engineering scaffold: README, ADRs, domain map, foundations, testing and
  release policies, agent operating manual.
- Read-only core: cross-platform store discovery and scanning of sessions,
  skills, plugins, hooks, and settings across the Claude Code user store,
  per-project `.claude` directories, and the Claude desktop app store.
- Electron shell with a context-isolated, typed preload bridge; the renderer
  has no filesystem access.
- Four jig guards enforcing renderer purity, the no-network promise, ids
  across the seam, and tests never touching a real store — blocking in CI via
  `npm run guards`.
- The write path (ADR-0001): an append-only mutation journal at
  `<kondo-data>/journal.jsonl` written durably before any store byte moves, a
  kondo-owned trash at `<kondo-data>/trash/<journal-id>/` that keeps every
  displaced byte, and `undo` restoring a whole multi-step operation. Readable
  across the seam as `journalList`, `journalUndo` and `trashSize`; no
  mutation channel ships yet.
- The kind registry and the capability matrix: every entity kind (skill,
  plugin, hook, settings, session, project) is one registry entry supplying
  `discover`, `read`, `capabilities`, `enable` and `disable`, and write
  permission is a kind × scope × operation lookup instead of a flag. Every
  entity now crosses the seam carrying its `kind` and what may be done to
  it, so the UI can say *why* something is read-only. No mutation is wired
  into the registry yet.
- Enable and disable a skill from the skills view — kondo's first mutation. The
  skill directory moves between `skills` and `skills.disabled` in its own scope
  (ADR-0006), through the journal, so every toggle is undoable. Project skills
  toggle inside their own project's `.claude`; plugin-shipped skills are refused
  by the capability matrix with the reason shown on the button. The list is
  re-read from the store after every toggle rather than patched.
