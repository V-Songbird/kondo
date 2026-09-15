# Foundations

How kondo is put together. Decisions live in [adr/](adr/); this document is
the map that connects them.

## Process model

Three Electron layers, strictly separated:

```
electron/main/      the only code that touches disk
  index.ts          app bootstrap + composition root (thin; no domain logic)
  ipc.ts            channel registration — one line per channel, delegates to workspace
  workspace/        locator, kind registry, store adapters, analysis (Electron-free, injectable)
electron/preload/   the context-isolated bridge: window.kondo, typed by shared/contract
src/                renderer: React UI; no Node, no fs, no paths
shared/contract.ts  THE seam contract: types + channel names, imported by all three
```

Rules the structure enforces:

- The **composition root** is `whenReady` in `electron/main/index.ts`: it
  resolves `homedir`, `APPDATA`, platform, and env once and injects them into
  `createWorkspace`. Nothing under `workspace/` imports `electron`, which is
  what lets the whole domain run under vitest with fixture roots and no
  Electron in sight.
- Startup acquires Electron's single-instance lock before readiness or
  workspace creation. A refused launch quits without initializing the workspace.
  `KONDO_DATA_ROOT`, when set, also selects Electron's canonical `userData`
  directory before locking, so different profile flags cannot share a journal
  through that override. Another launch restores and focuses the original main
  window; requests during startup wait for its splash handover. Reopening a
  window reuses the existing workspace and IPC handlers.
- The **contract is written once**. `shared/contract.ts` holds every seam
  type, the `KondoApi` interface, and the channel-name map. Preload and main
  both import it; drift between "what main handles" and "what the renderer
  types" is a compile error, not a runtime surprise. (Skilldex hand-mirrored
  its contract in two places; that was its top source of latent bugs. We keep
  the seam, fix the duplication.)
- **Ids cross the seam, never paths** (ADR-0008). Every scan result carries
  opaque ids; mutating or drilling into an entity means sending an id back,
  which main resolves against its own last scan. A renderer bug — or a
  compromised renderer — cannot name an arbitrary file.
  Session-project responses omit the internal `ProjectRecord.guessedPath`;
  main retains it for verified project-store resolution. The public
  `SessionProject` carries location and store availability instead (094).
- Main and splash window hardening: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, a restrictive CSP injected as a response header
  (`connect-src 'none'` when packaged — the no-network promise is enforced,
  not just intended), and navigation handlers that refuse to leave the app.

App is wrapped by `src/ui/error-boundary.tsx`. A descendant render failure
shows an error alert, build version and reload action, and signals readiness
so an early failure can retire the splash. The parameterless `kondoReload`
lifecycle bridge lets the owning main frame reload its existing contents
without relaxing navigation denial or accepting a path/URL (ADR-0014).
Asynchronous action failures retain their feature-level handling.

## The workspace

`createWorkspace(locator)` owns the in-memory scan state and reaches every
entity through the kind registry. Structure:

- **`locator.ts`** (ADR-0003) — the only path authority. Built from injected
  `{ home, appData, userData, platform, env }`; honors `KONDO_STORE_ROOT`,
  `KONDO_DESKTOP_STORE_ROOT` and `KONDO_DATA_ROOT` overrides (tests and
  fixture runs use these). Names `~/.claude.json` beside the user store
  (`userConfigFile`, ADR-0009).
  Linux desktop config honors absolute `XDG_CONFIG_HOME` with a `~/.config`
  fallback. The locator also discovers `os.tmpdir()` once and resolves its
  realpath spelling, both injectable for fixtures. A realpath failure retains
  the lexical root. `tmpRoot` and `tmpRootRealpath` are classification inputs
  only: they do not become stores or broaden any read/write allowlist.
- **`kinds.ts`** — the kind registry. Every entity kind kondo manages
  (`skill`, `plugin`, `hook`, `settings`, `session`, `project`, `mcp`,
  `agent`, `command`, `rule`, `output-style`, `store` — the first segment of
  every id, ADR-0008) is described by one or more entries supplying
  `discover`, `read` and one `plan(entity, request)` seat that answers every
  operation with a mutation plan or a refusal (entry 035, ADR-0004
  amendment): `skill`, `plugin`, `pluginSkill` (a plugin's own skills, keyed
  on the parent id), `hook`, `settings`, `project`, `session`,
  `desktopSession` (two entries for one kind, because code and desktop
  sessions live in different stores), `mcp`, and one placed-kind entry each
  for agents, commands, rules and output styles. The exported `listings`
  table dispatches by id prefix (`listingForId`, `listingFor`), so a new kind
  needs a registry row, a listing row and a matrix row — never a new channel.
  `store` has a matrix row and no entry: nothing lists a store as an entity;
  the row exists so the tidy sweep's journal entry can name what it acted on.
  No workspace method names an adapter: it validates the id shape it accepts,
  hands the rest to a kind, and wraps the result in the scan envelope. The two
  *store reports* stay direct calls — a store is not an entity.
- **`capabilities.ts`** — the capability matrix. Write permission is a
  lookup on **kind × scope × operation** (`enable`, `disable`, `move`,
  `trash`),
  never a single flag: a user skill can be disabled, a plugin-shipped one
  cannot, and the same kind is writable in one scope and read-only in
  another. Rows combine Claude's native conventions (ADR-0006) with Kondo's
  implementation limits. A row saying `allowed` is a precondition for a plan
  builder, not proof one exists or can currently execute. The mutation layer
  independently refuses every settings write/splice plan under 098.
  An unrecognized scope refuses every operation rather than throwing (ADR-0005).
  Hook rows deny enable, disable, move and trash in user/project/local layers;
  `kinds.hook.plan` returns that refusal without building mutation steps.
  The hook display projection flattens groups and carries no command text, so
  it cannot be used to reconstruct a settings edit. The read-only hook boundary
  and the conditions for reconsideration are recorded in
  [decision 109](plans/109-hook-layer-boundary.md) and
  [ADR-0017](adr/0017-hook-layer-boundary.md). Script-file cleanup is separate.
- **Adapters** — `user-store.ts`, `sessions.ts`, `projects.ts`,
  `desktop-store.ts`, `tidy.ts`. Every public adapter function returns
  `Scan<T> = { data, errors, unknown }` (ADR-0005): partial data, itemized
  typed errors (`{ code, path, message }` — codes, not prose, so the UI can
  react), and unknown entries for domain.md drift detection. Each one stamps
  the entities it builds with their `kind` and their matrix row, so the
  renderer receives capabilities alongside the data and never has to parse
  an id to learn what it may do.
- **`analysis.ts`** — staleness (`STALE_AFTER_DAYS`, `isStale`), a pure
  function over scanned data. Orphan-sidecar detection lives in
  `sessions.ts`. Duplicate detection lives in `kinds.ts`: `skillDuplicates`
  digests only skills whose names repeat, and a copy it cannot read makes its
  group not identical (032, 118); `sessionNearDuplicates` compares one
  project's opening prompts through the scan cache (034, ADR-0007).
- **`mutations.ts`** — the write path (ADR-0001): `mutate(plan)` currently
  refuses any plan containing `write` or `splice` on every platform, before
  step preparation, journaling or filesystem effects (098, ADR-0010). This
  includes missing-file creation and mixed plans. Permitted plans are
  journaled before their `move` / `copy` / `trash` steps run. `undo` likewise
  refuses historical entries containing `write` or `splice` before effects,
  preserving existing history, inverse edits and recovery bytes; other entries
  use versioned action intents, pending digests, confirmed cursors and explicit
  completion (099, ADR-0018). Retry skips confirmed actions and reconciles only
  the pending action. The existing channels return explicit outcomes alongside
  errors; failed legacy Undo without progress evidence requires review.
  `emptyTrash` is the one unlink.
  Store roots are `user` and `desktop` from the locator, plus any
  `project:<flat>` root the workspace
  resolves to a verified project's `.claude` through the `extraRoot`
  callback — never the project itself (ADR-0002).
  `relocation.ts` preserves physical link entries through trash and undo;
  archived links are metadata and are validated against the future restored
  tree before that tree becomes a live store again. Logical copies and digests
  remain in `scan.ts`, where every content read stays in its owning root.
- **Helpers** — `scan.ts` (explicit owning-root checks, resolved paths, bounded
  tree walks and safe fs wrappers that convert exceptions into scan errors; a
  JSON syntax error becomes one fixed sentence because V8 quotes the parsed
  source, and `redacted` swaps exception text for a caller's sentence, ADR-0022),
  `jsonl.ts` (streaming transcript reads — never `readFile` a
  transcript whole, ADR-0007), `scan-cache.ts` (the disposable tier-2 cache
  under `<kondo-data>`, keyed by path, size and mtime, ADR-0007),
  `reviewed-removals.ts` (bounded, expiring, single-use removal-review tokens,
  ADR-0015), `frontmatter.ts` (dependency-free `SKILL.md`
  name/description extraction), `display.ts` (tildify and other
  display-string building — done in main so the renderer never sees or
  splits a raw path; renderer path-handling is where cross-platform bugs
  breed).

Session inventory is scanned once and cached in the workspace. Every read
first stats Claude's registry and the `projects/` directory
(`inventoryFingerprint`: two stats, no walk) and rebuilds when either changed
(056), when `refresh` asks, or after a mutation dropped the cache. Trash plans,
removal reviews and their applies, and settings-leftover reads pin one forced
rebuild to the call (`freshContext`). Overview, project lists and analysis all
read the same inventory rather than re-walking thousands of directories per
view (ADR-0007).

Settings discovery reads the user settings file and project/local files under
verified projects' `.claude` directories. `SettingsLayerInfo` is a metadata
projection with layer identity, project attribution, display location,
existence, size, the documented top-level setting names the file states and
whether it states others; it has no general settings-value or resolution model.
Skill and plugin resolution uses dedicated main-process logic. These projections
do not resolve arbitrary settings, managed policy, command-line overrides,
session state or settings defaults. Settings-derived data crosses the seam
deny-by-default: documented names, validated states and Kondo's own error
sentences, chosen in main before a DTO is built. Hook commands, matcher
patterns, script paths, undocumented names and parser text stay in main (117,
[ADR-0022](adr/0022-project-settings-data-deny-by-default.md)). The guarantee
covers these projections, not every string the app displays. Any expansion
requires a reviewed contract, an explicit field allowlist and fixture evidence
([ADR-0021](adr/0021-summarize-settings-files.md)).

## Data flow

```
feature component → use-scan hook → window.kondo.<method>()   (src)
  → ipcRenderer.invoke(channel)                               (preload)
  → ipcMain.handle → workspace method → Scan<T>               (main)
```

One shape everywhere: every view receives `Scan<T>` and renders `data`
alongside a problems affordance for `errors`/`unknown`. No view may swallow
the error half (ADR-0005).

## Reviewed removals

The workspace owns opaque removal-review tokens (ADR-0015). `tidyPreview`
retains category candidates, `sessionTrashPreview` retains the chosen sessions
and returns their current summaries, and `skillDuplicates` retains the group
behind each removable identical-copy verdict. The renderer freezes its reviewed
selection with the token and returns both on apply. Main re-resolves and validates
that state before the mutation journal is appended. Stale, missing or consumed
reviews refuse with `stale-plan` and require renewed selection; no call quietly
expands the reviewed set or deletes an unaffected subset of a changed selection.

The extra validation belongs to removal review rather than cached inventory
listings. Inventory cache fingerprints alone cannot establish transcript
freshness or duplicate equivalence. Review tokens are transient main-process
state and are not filesystem paths or serialized mutation plans. Mutation, Undo
and empty-trash execution share a workspace queue so separate valid reviews
cannot race through preflight together. External writers do not join this queue.

## Kondo's own footprint

Kondo keeps its private state in `<kondo-data>` — Electron's `userData`
directory for the app (e.g. `%APPDATA%/Kondo` on Windows). That is where the
mutation journal (`journal.jsonl`), the kondo trash (`trash/`), appearance
preferences (`appearance.json`), and the scan
cache (`scan-cache/<namespace>.json`, keyed by `(path, size, mtime)` per
ADR-0007) live. Two rules: `<kondo-data>` is never inside a Claude store,
and no Claude-truth is stored there (ADR-0006) — losing it loses undo
history, caches and Kondo's appearance choice, never the user's actual Claude
configuration.

`workspace/appearance.ts` owns validated appearance reads and atomic writes.
Only one of the identifiers in `shared/themes.ts` crosses `appearanceGet` /
`appearanceSet`; arbitrary paths and CSS are never accepted. These preferences
are not Claude-store mutations and do not create journal entries. The main
process reads the choice before creating the main window and updates native
window colors after successful saves. Renderer startup applies the same shared
palette before mounting React. Missing preferences use Chalk; invalid or
unreadable preferences provide a usable fallback with an error shown in Themes.

## Growth path

v0.1 hard-coded the read-only adapters into `workspace.ts`. v0.2 replaced
that with the **kind registry** and the **capability matrix** described
above: kinds supply `discover / read / capabilities / enable / disable`,
identity is per ADR-0008, and write permission is a kind × scope ×
operation lookup rather than a boolean. The snapshot-cache, error-isolation
and id-allow-list skeleton stayed exactly as it was — that skeleton is the
part proven by skilldex; the registry is where kondo goes one level up.

Historical write-path structure (v0.2; settings execution is now suspended under 098):

- **Three mutations are wired.** The skill toggle fills the `skill` entry's
  `enable` / `disable` seats. The skill move (`skillMovePlan`) and the plugin
  toggle (`pluginTogglePlan`) sit *beside* the registry as standalone
  planners, because the seat's shape — `enable(entity)` — cannot carry the
  destination a move needs or the settings layer a plugin toggle plans to edit.
  Every other entry spreads `noPlanYet`. That divergence is the registry's
  open design question: the vision's next kinds (MCP servers, agents,
  commands, rules) each need a toggle and a move, and each as a standalone
  planner means its own workspace method, channel, IPC line and preload
  line. Entry 035 then replaced the two seats with one
  `plan(entity, request)` seat and a generic mutate channel before those
  kinds landed; the registry described above is that result.
- **Project roots are resolved lazily.** `mutations.ts` fixes `user` and
  `desktop`; `project:<flat>` resolves through `extraRoot` against the
  verified-project list of the current inventory, which ADR-0009 now
  populates from Claude's registry rather than an un-flattening guess.
- **No `kinds` channel.** The renderer learns kinds and capabilities from
  the entities it already receives; a listing of the registry itself only
  ships if a view needs one.

## Renderer navigation

`App` owns four management destinations, initially Library, plus Themes, and their navigation state:
Library query/type/selected item, Projects query/selected project/category and
browser/detail mode, and the selected Clean up subsection. Library joins the
existing scan results by opaque IDs and opens the matching project category.
Returning re-reads the data while preserving the selected item and filters.

Projects mounts one category at a time; changing project or closing its detail
remounts the page so pending mutations cannot follow the user into another
context. Cleanup mounts one of files, settings leftovers or duplicate skills;
each owns its explicit selection and confirmation. History lists changes
before the separate permanent trash operation. The responsive layout changes
which pane is visible, with focus restoration when returning to the browser.

Management views are projections of the existing typed bridge. Themes only
uses the separate Kondo appearance preference API; visiting it retains the
Library and Projects context. The [UX workflow plan](plans/2026-09-06-ux-workflow.md)
and [Signal themes plan](plans/2026-09-06-signal-themes.md) record the interaction
decisions and fixture validation.
