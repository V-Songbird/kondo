# Changelog

All notable changes to kondo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and kondo adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Kondo reads the Claude profile Claude Code uses. An absolute
  `CLAUDE_CONFIG_DIR` selects the configuration directory, with its
  `.claude.json` registry inside it, and a launch that inherits no terminal
  environment can select one with `--claude-config-dir=<path>` on its shortcut
  or launcher. Kondo's own `KONDO_STORE_ROOT`, `KONDO_DESKTOP_STORE_ROOT` and
  `KONDO_DATA_ROOT` overrides still take precedence, so fixture runs and tests
  are unaffected by an inherited variable.
- The title strip names the Claude profile the window reads and what chose it,
  and says when a selection was not followed — displaced by a Kondo override,
  or not an absolute path. The window title names the profile too, so two
  profiles stay apart in the taskbar.

### Changed

- Each Claude profile keeps its own Kondo history, trash, caches and window
  state in `profiles/<key>` inside Kondo's data directory, and holds its own
  single-instance lock, so two profiles can be open at once. The default
  profile keeps the directory it already uses and nothing is copied between
  them. A data directory now records which profile it serves and refuses a
  launch that brings another one, rather than mixing two profiles' Undo
  history.

### Fixed

- Physical move and Undo recovery now distinguishes filesystem entry boundaries,
  streamed file bytes and stored link targets. Interrupted legacy or mismatched
  fingerprints stay visible for review without reading or changing endpoints;
  completed historical changes retain Undo.

- Duplicate skill checks and copy verification distinguish different filenames
  and file boundaries even when their concatenated bytes match. Older interrupted
  copies with unverifiable fingerprints remain visible for review, preserving
  their files and history; completed changes retain Undo.

- Clean up preserves all hook scripts because the settings inventory cannot
  prove they are unused. References through variables, quoted or compound
  commands, other scripts and unchecked sources can no longer make a live
  script removable. The category explains the limitation and refuses selection;
  other permitted cleanup and Undo remain available.

- Settings leftovers preserves all skill preferences and plugin sources that
  cannot be fully checked, including directory-plugin disable preferences.
  Missing marketplace plugins require complete installation records and a
  recognized marketplace. Partial records retain healthy entries and errors;
  degraded inventory refuses an earlier selection. Settings writes and Undo
  remain suspended.

- Failed Undo attempts no longer mark their original change as restored.
  Retry resumes confirmed progress after interruption, preserves files moved out
  of the way, and refuses ambiguous recovery without discarding bytes. History
  and inline feedback distinguish incomplete, unchanged and uncertain results;
  partial forward changes retain their Undo action. Legacy failed Undo without
  progress evidence remains visible for review.

- Settings changes now refuse before changing files or recording completion,
  preventing a race that could overwrite another application's save. This
  temporary restriction applies on all platforms to settings-based skill,
  plugin and MCP toggles, plugin scope moves and clearing, settings-leftover
  removal, and skill moves that also edit settings. Creating a missing
  settings layer is also refused. Historical Undo containing settings edits
  refuses the whole operation and retains its history and recovery bytes.
  Unrelated moves, trash and their Undo remain available.

- Documentation no longer claims hook declarations can move between settings
  files; they remain read-only. Inventory covers the settings layers Kondo
  reads, with limited script diagnostics; it does not establish which hooks
  execute. No behavior changed.

- Cleanup, selected conversation removal and duplicate-skill removal retain
  the reviewed candidates. Changed files, resumed conversations or changed
  duplicate groups require another review before anything moves.

- Store scans, transcript reads and recursive copies refuse links escaping their
  owning store. Broken links and cycles report problems while healthy entries
  remain available; safe in-store aliases stay readable.

- Temporary-project classification expands Windows short directory names in the
  OS temporary root, so registered paths using long names are recognized.

- Linux desktop-store discovery honors absolute `XDG_CONFIG_HOME`, with the
  standard `~/.config` fallback. Temporary-project classification shares the
  locator's lexical and canonical temporary roots across cleanup and project
  views, and checks known project paths by directory segment. Unlocated names
  with ambiguous flattened temporary prefixes are no longer marked temporary
  on that prefix alone.

- Render failures now show the error message, application version and a
  keyboard-accessible Reload Kondo button instead of an empty window.

- A second launch using the same Kondo app data exits and brings the existing
  window forward, preventing competing workspace owners of the journal and
  trash. The splash now has the same explicit isolation and navigation guards
  as the main window.

- Mutation targets that resolve outside their allowed store are refused,
  including escapes through parent links and the single-file user registry.

- Library now shows failures and unrecognized files from every inventory read
  alongside partial data, including history. Label/value rows are aligned, and
  explanations of partially applied changes are visible without hovering.
- Invalid journal records and invalid steps no longer break healthy history or
  undo. Each rejected line remains on disk and gets an itemized error.
- Plugin cleanup preserves all cache versions named by installation records,
  including different versions installed in user, project and local scopes.

- **Descriptions read as `>-`.** A description written as a YAML block scalar
  — `description: >-` and the paragraph indented beneath it, which is how
  nearly every skill on a real machine writes one — was read as the header
  alone, so the Library printed `>-` where the sentence belonged.
  `readFrontmatter` now takes the lines a key owns: folded blocks collapse to
  one line, literal ones keep their breaks, and a plain value continued across
  indented lines is picked up the same way. Every kind read from markdown
  frontmatter benefits, not just skills.

- Documentation now matches current behavior and decisions: settings files are
  summarized rather than resolved (ADR-0021), MCP and plugin inventory limits
  are stated, the `.mcp.json` privacy exception is named, and the roadmap
  records the shipped safety work.

### Added

- Install documentation now lists Kondo's data locations, uninstall retention
  and removal, and all three root overrides for disposable-store rehearsals.

- Packaged applications include the original IBM Plex OFL license and a
  third-party notice identifying IBM Plex and Electron, linked from README.

- Themes lets you choose Chalk (the default), Parchment, Sage, Slate, Carbon,
  or the original vivid Signal design. Kondo remembers the choice locally and
  applies it to the app and native window controls.

- Library explains the item types and links skills, plugins and other supported
  entries to their existing project management controls.
- Named search, selection and move controls; keyboard session details; a skip
  link; and Cancel/Escape focus handling for inline confirmations.

- **A mark**: `k_`, the first letter of the wordmark and the caret that closes
  it, drawn once in [src/assets/kondo-mark.svg](src/assets/kondo-mark.svg) and
  used everywhere — the window and taskbar icon, the left rail, the splash, and
  the head of both READMEs.

- **A splash window** that owns kondo's first read. The main window stays
  hidden until the renderer says its first scan has settled, so what replaces
  the splash is a page with rows in it rather than a skeleton, and `Scanning…`
  no longer appears on launch. The splash holds for 900 ms at minimum — a store
  small enough to read in a blink used to make it a flash — and hands over
  after 8 s regardless, so a read that never settles still shows a window.

- **Library**, now the starting destination and the other lens on the same set: the
  *named object* is the row rather than the project. One page per skill,
  plugin, hook, MCP server, agent, command, rule, output style or settings
  file, listing every scope it lives in with that scope's own state, the
  settings file that decided it, and the digest that says whether two copies
  are actually the same skill.
  - It answers four questions no screen answered before: where does this skill
    live, which hook declarations the scanned settings files hold, which
    settings file switched that off, and am I done. On the owner's store the first three used to cost
    11,517 project pages.
  - `Needs a look` collects the findings and says why each one is a finding —
    a hook naming a script that is not on disk, a declaration whose folder is
    gone, a name repeated with different contents, a plugin switch with no
    plugin. Getting it to zero is the answer to the fourth question. Every row
    is evidence, never a verdict about what to remove.
  - Five bridge channels were already wired and never called — `skillsList`,
    `pluginsList`, `hooksList`, `settingsLayers`, `pluginSkills` — so this
    needed **no main-process work at all**. `SkillOverrideState.layerPath` was
    computed for every skill and referenced nowhere under `src/`; it is now
    printed rather than hovered for.
  - Read-only on purpose. Every mutation still runs from the project page,
    where it is tested; moving the controls here wants a pending destination
    row and a plan-without-applying step, and both are their own change.
  - The catalog is a pure module beside `project-rows.ts` and
    `orphan-rows.ts`, tested without a DOM.

### Changed

- Release targets explicitly select Windows x64 NSIS, Apple silicon arm64 DMG
  and Linux x64 AppImage. Installation guidance distinguishes recorded Windows
  validation from CI smoke requirements and documents scoped macOS quarantine
  handling and distribution-specific FUSE compatibility libraries.

- Library is now the starting screen. Four primary destinations explain their
  purpose; settings leftovers and duplicate skills are inside Clean up.
- Library opens the matching project category and preserves search/selection
  on return. Projects starts with an overview and focuses on one category at
  a time; paths, hashes and IDs use optional disclosures.
- At narrow desktop widths, Library and Projects show a browser or detail
  pane with a Back action. Keyboard focus follows navigation and results.
- Cleanup has explicit choose/review/apply steps and explains that files in
  trash still consume space. History places changes and Undo before permanent
  trash deletion; partial cleanup results retain their immediate Undo action.

- **No OS title bar.** The window is `titleBarStyle: 'hidden'` with a native
  overlay for minimise/maximise/close in kondo's own colours, the page's top
  strip drags the window, and the default `File Edit View Window` menu is gone
  off macOS, where the system menu bar owns the editing accelerators.

- Where you are inside a destination now lives in `App` rather than inside the
  view. Going to History to undo something and coming back used to unmount the
  Projects list and drop you at the top of an unfiltered list — on a real store
  that is 11,517 rows and up to twelve presses of "Show 200 more" to get back.

- The Signal visual system replaces Flat File's dark-only appearance:
  bold sans headings, square controls and horizontal navigation, with six
  selectable palettes ([DESIGN.md](DESIGN.md)). The original logo is retained.
  - Paths and identifiers retain bundled IBM Plex Mono; explanations use
    a native sans family with bundled IBM Plex Sans as fallback. Semantic
    colors are shared by the page, previews and native window controls.
  - Status labels retain their `-`, `~`, `!` and `?` markers, so color alone
    never distinguishes disabled, old, broken and unknown entries.
  - Reversible removal and permanent deletion remain separate controls with
    explicit labels and confirmation flows.
  - Flattened project keys retain their split treatment; legitimate paths
    and filenames are not altered.

### Security

- The release workflow builds installers and a draft only for a tag on
  `main`'s current tip; any other tag fails before packaging, naming the tag
  commit and the candidate commit. A manual rehearsal never creates a draft,
  even on a tag ref. The check runs from the tagged commit, so the publisher
  still confirms the tag's commit before publishing.

- Settings content that can hold credentials no longer reaches the window.
  Settings files list only documented top-level setting names and say when
  others exist. Hooks show their documented event, handler type, whether a
  matcher applies and the script status, without the command, matcher pattern
  or script path. Problems with malformed settings, registry, MCP or history
  files no longer quote their contents, an incomplete plugin installation
  record names its plugin only when the key is a valid plugin id, and
  connection types outside the documented set read as unknown.

## [0.5.0] - 2026-09-05

The first version stamped as such. It collects everything since the
scaffold, in the roadmap's own lines: v0.1 the read-only core, v0.2 safe
mutations, v0.3 the project view, v0.4 moves for supported kinds, v0.5 clean my
`~/.claude`. No packaged build has been published; the version is
`package.json`'s and the footer reads it from there.

### Added

- Engineering scaffold: README, ADRs, domain map, foundations, testing and
  release policies, agent operating manual.
- A projects home that works on a real store: rows named by the last path
  segment with the parent beneath, throwaway runs and projects whose folder
  is gone folded behind one count with a toggle, the rest 200 at a time. On
  the owner's store that is 203 buttons instead of 11,518.
- "Conversations deleted in the desktop app" on Clean up: the desktop app
  leaves a `<uuid>.desktop-released.json` beside a transcript it has deleted
  on its side, and kondo now recognises the marker, moves it with the
  transcript, and offers the released conversations as their own category
  (101 of them, 125 MB, on the owner's store).
- Switch an MCP server off per project: the project page's MCP servers table
  gets Enable/Disable, written as Claude's own `disabledMcpServers` /
  `disabledMcpjsonServers` list in `~/.claude.json` under the same digest
  guard Leftovers uses. The user scope has no such list and says so.
- Switch a global skill off for one project: a project page lists the skills
  it inherits from Global with "Off here" / "Follows global", writing
  `skillOverrides` into that project's own settings layer and never the
  user's.
- "Caches the desktop app rebuilds" on Clean up: Chromium's caches inside the
  Claude desktop app's data directory, at the root and in each partition (28
  of them, 636 MB, on the owner's machine). Blocked, with the reason on
  screen, while the desktop app is running and holds them open.
- The version in the footer comes from `package.json`, now 0.5.0.
- An end-to-end smoke test (`npm run test:e2e`) that launches the built app
  against the fixture store and drives it over Chromium's debugging port; CI
  runs it on all three OSes.
- Packaged installers — NSIS, DMG, AppImage — built by CI from a version tag
  and attached to a draft GitHub Release, unsigned for now (ADR-0011), with
  install notes in README.
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

- A project directory without a transcript is no longer swept as a throwaway
  folder when it holds Claude's `memory/` or its project is on disk: two live
  projects on the owner's store had only their memory under `projects/` and
  were offered as litter. Emptiness alone never makes a folder throwaway
  now; only a name under the temp root, a worktree or a job, or a directory
  with nothing at all and no path kondo can find.
- Claude-written files kondo knew nothing about no longer count as
  unrecognised: `.desktop-released.json` markers and `.benchmarks/` inside a
  project directory, `chrome/` and `plans/` at the store root. 105 unknown
  files became 4 on the owner's store.
- Measuring a directory walks it with one recursive readdir and parallel
  stats instead of one stat at a time: the Clean up preview on the owner's
  store went from 9.3 s to 2.2 s.
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
