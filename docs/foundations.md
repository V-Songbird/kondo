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
- **`kinds.ts`** — the kind registry. Every entity kind kondo manages
  (`skill`, `plugin`, `hook`, `settings`, `session`, `project`, `store` —
  the first segment of every id, ADR-0008) is described by one or more
  entries supplying `discover`, `read`, `capabilities`, `enable` and
  `disable`: `skill`, `plugin`, `pluginSkill` (a plugin's own skills, keyed
  on the parent id), `hook`, `settings`, `project`, `session` and
  `desktopSession` (two entries for one kind, because code and desktop
  sessions live in different stores). `store` has a matrix row and no entry:
  nothing lists a store as an entity; the row exists so the tidy sweep's
  journal entry can name what it acted on. No workspace method names an
  adapter: it validates the id shape it accepts, hands the rest to a kind,
  and wraps the result in the scan envelope. The two *store reports* on the
  dashboard stay direct calls — a store is not an entity.
- **`capabilities.ts`** — the capability matrix. Write permission is a
  lookup on **kind × scope × operation** (`enable`, `disable`, `move`),
  never a single flag: a user skill can be disabled, a plugin-shipped one
  cannot, and the same kind is writable in one scope and read-only in
  another. A row records what Claude's own conventions permit (ADR-0006),
  which is not the same as what kondo implements — a row saying `allowed` is
  the precondition for a plan builder, not proof one exists. An unrecognized
  scope refuses every operation rather than throwing (ADR-0005).
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
  `sessions.ts`; duplicate logic does not exist yet (ROADMAP).
- **`mutations.ts`** — the write path (ADR-0001): `mutate(plan)` journals,
  then runs `move` / `copy` / `trash` / `write` steps; `undo` reverses an
  entry; `emptyTrash` is the one unlink. Store roots are `user` and
  `desktop` from the locator, plus any `project:<flat>` root the workspace
  resolves to a verified project's `.claude` through the `extraRoot`
  callback — never the project itself (ADR-0002).
- **Helpers** — `scan.ts` (safe fs wrappers that convert exceptions into
  scan errors), `jsonl.ts` (streaming transcript reads — never `readFile` a
  transcript whole, ADR-0007), `frontmatter.ts` (dependency-free `SKILL.md`
  name/description extraction), `display.ts` (tildify and other
  display-string building — done in main so the renderer never sees or
  splits a raw path; renderer path-handling is where cross-platform bugs
  breed).

Session inventory is scanned once and cached in the workspace (`refresh`
re-scans); overview, project lists, and analysis all read the same inventory
rather than re-walking 9k directories per view (ADR-0007).

## Data flow

```
feature component → use-scan hook → window.kondo.<method>()   (src)
  → ipcRenderer.invoke(channel)                               (preload)
  → ipcMain.handle → workspace method → Scan<T>               (main)
```

One shape everywhere: every view receives `Scan<T>` and renders `data`
alongside a problems affordance for `errors`/`unknown`. No view may swallow
the error half (ADR-0005).

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

Where the write path stands (v0.2):

- **Three mutations are wired.** The skill toggle fills the `skill` entry's
  `enable` / `disable` seats. The skill move (`skillMovePlan`) and the plugin
  toggle (`pluginTogglePlan`) sit *beside* the registry as standalone
  planners, because the seat's shape — `enable(entity)` — cannot carry the
  destination a move needs or the settings layer a plugin toggle writes.
  Every other entry spreads `noPlanYet`. That divergence is the registry's
  open design question: the vision's next kinds (MCP servers, agents,
  commands, rules) each need a toggle and a move, and each as a standalone
  planner means its own workspace method, channel, IPC line and preload
  line. Entry 035 replaces the two seats with one
  `plan(entity, request)` seat and a generic mutate channel before those
  kinds land.
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
