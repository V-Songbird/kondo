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
- Six jig guards. Four enforce renderer purity, the no-network promise, ids
  across the seam, and tests never touching a real store — blocking in CI via
  `npm run guards`. Two more keep docs from rotting: a change under
  `electron/main/workspace/` must ship a `docs/domain.md` edit, and a change to
  `shared/contract.ts` must ship an ADR touch. Those two read the git index, so
  they block at commit time and report themselves skipped in CI.
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
- Enable and disable a plugin per settings layer from the plugins view. The
  toggle edits the `enabledPlugins` key of the chosen layer in place
  (ADR-0006) by splicing the raw bytes, so every other key and the file's own
  formatting survive byte-for-byte, and it goes through the journal like any
  other mutation. Each plugin row groups the layers by the project that owns
  them, showing what each says and which one wins (local > project > user). A layer whose file does not exist yet is
  refused with the new `needs-confirmation` scan code and created only after
  the user says so.
- Moving a skill between scopes — user to project, project to user, and
  project to project — as one journaled, reversible operation. The order is
  the guarantee: the destination copy is written and proven against the
  source by a recursive digest *before* the source is displaced into kondo's
  trash, so a copy that does not verify leaves the original untouched and
  nothing at the destination. A destination scope already holding that skill
  name is refused rather than merged (either of its directories counts), and
  a plugin-shipped skill is refused by the capability matrix, which gained a
  third operation, `move`, alongside `enable` and `disable`. Undoing the move
  puts the skill back and takes the copy away in one step. The Skills tab
  gets a "Move to" picker per row that re-reads the store afterwards.

### Changed

- Skills that ship inside a plugin are no longer listed in the skills
  catalogue. They are not the user's to bench or relocate — doing either
  leaves the plugin pointing at a directory that has moved — so they now
  belong to the plugins view rather than sitting in the skills list as
  permanently greyed-out rows. `scanSkills` no longer walks plugin trees and
  no longer reads the plugin manifest at all. The `plugin` skill scope and
  its capability-matrix row stay, so whoever surfaces these skills in the
  plugins view still inherits the refusal.
- The confinement check on a plugin's `installPath` moved from `scanSkills`,
  which happened to be its only consumer, into `scanPlugins`, where the
  untrusted path is resolved. A path escaping the user store is now nulled at
  the source, so no later reader can follow it by forgetting to check, and
  the refusal is reported wherever plugins are read rather than only where
  skills were.

### Fixed

- A trash directory could not be created for a project store on Windows: the
  store name `project:<dirName>` was used verbatim as a path segment, and no
  Windows segment may hold a colon. Displaced bytes for a project-scope write
  now land under a dash-spelled segment. Only the skill toggle's `move` steps
  existed before, so nothing had displaced bytes into the trash from a project
  store until now.
