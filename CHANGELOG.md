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
  across the seam as `journalList`, `journalUndo` and `trashSize`.
- The kind registry and the capability matrix: every entity kind (skill,
  plugin, hook, settings, session, project) is one registry entry supplying
  `discover`, `read`, `capabilities`, `enable` and `disable`, and write
  permission is a kind × scope × operation lookup instead of a flag. Every
  entity now crosses the seam carrying its `kind` and what may be done to
  it, so the UI can say *why* something is read-only.
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
- A Journal tab, where undo stops being an invisible guarantee. Every
  mutation kondo has performed is listed newest first, saying what it did,
  with an Undo beside each one that can still take it — through the same
  `undo(journalId)` every other feature already relies on, never a second
  restore path. An entry that has already been reversed carries the undo that
  did it. Above the list sits kondo's trash: its size on disk, how many
  restore points hold it, and where it lives (SECURITY.md asks for the size
  to be visible).
- Emptying the trash, as its own operation on its own channel
  (`trashEmpty`), taking no argument and reached by nothing else in the app.
  It is the only destructive act kondo has, so it reads like one: a
  confirmation that names the bytes and the restore points about to go, with
  *Keep the trash* first and holding focus, and the red button second. It is
  not journaled — an entry promising an undo that cannot happen is the one
  lie the journal must not tell — and the journal file itself survives, so
  the history stays readable after the bytes behind it are gone. Undo and
  empty both re-read the journal and the trash size rather than patching what
  is on screen.
- A mutation that fails part way is marked as such in the journal by a
  following line (the file stays append-only) and listed as *failed*; undo of
  it puts back only what actually ran.
- A plugin row opens to list the skills it ships, read from the plugin's own
  install tree when the row is opened and not before.
- Projects are named through Claude's own registry: `~/.claude.json` keeps
  the real path of every directory Claude Code has run in, and flattening it
  with Claude's rule (`[^A-Za-z0-9]` → `-`) is an exact match for the
  `~/.claude/projects` directory name (ADR-0009). Before this, kondo guessed
  the path by reading every `-` as a separator, which could never name a
  project with a hyphen in its path — on one machine 7 of 9,171 directories
  resolved; now 1,443 do, and the rest are directories Claude has forgotten.
  Every per-project feature (project skills, settings layers, plugin chips,
  skill move destinations) sees those projects for the first time.
- Agents, commands and rules move between scopes from the project page: each
  row has the same "Move to" picker a skill has, landing on the generic
  `entityMutate` seat, with the matrix's toggle refusal said once beneath the
  table. Output styles show why there is nowhere to move one instead of an
  empty picker.
- "Skills kept twice" on Clean up: every skill name held in more than one
  scope, grouped with a verdict — identical copies, same name with different
  contents, or a copy that could not be read — and a per-copy trash control
  offered only for an identical group. Each copy is one journal entry with
  the undo beside it.
- A skill row's disable now speaks Claude's own convention: `skillOverrides`
  set to `off` in the scope's settings layer (the file that already names
  the skill, else `settings.local.json`, the one `/skills` writes), asking
  first when that file does not exist. Enable withdraws that member from
  every layer in the skill's chain in one undoable step. A skill already
  parked in `skills.disabled/` is offered the way back into `skills/`.
- The run-kondo fixture registers its projects in a `~/.claude.json` of its
  own, with a registry-only project, two dead ones and a duplicate skill per
  verdict, so every union-shaped view can be seen against it.

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

- The cached project inventory notices a registry rewritten by something
  else: every read stats `~/.claude.json` and `projects/` and rebuilds when
  either moved, so a dead project entry Claude added after kondo started
  reaches Leftovers without a restart. Rescan also re-reads the detail pane,
  so the Storage card and the project list never disagree about the set.
- Every display path uses forward slashes on every OS, including paths
  outside the home directory, so a fixture store or a project path no longer
  reads `X:\Temp\...\plugins/cache/...`.
- The "never used" badge no longer fires on every skill when `~/.claude.json`
  holds no `skillUsage` record at all: no record is now `null` on the seam,
  and only an actual zero count badges a row.
- The sessions pill names the staleness threshold from the seam instead of a
  `30` written into the JSX.
- The cached session inventory is now dropped after a tidy sweep or an undo
  whether or not it finished: a sweep that failed part way had already moved
  transcripts the cache still listed, so the next preview showed them and
  the next sweep refused whole.
- The sidebar footer states the undo promise, and the skill-move collision
  message names the destination that already holds the name.
- A trash directory could not be created for a project store on Windows: the
  store name `project:<dirName>` was used verbatim as a path segment, and no
  Windows segment may hold a colon. Displaced bytes for a project-scope write
  now land under a dash-spelled segment. Only the skill toggle's `move` steps
  existed before, so nothing had displaced bytes into the trash from a project
  store until now.
