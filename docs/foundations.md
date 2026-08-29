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
- Window hardening: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, a restrictive CSP injected as a response header
  (`connect-src 'none'` when packaged — the no-network promise is enforced,
  not just intended), and navigation handlers that refuse to leave the app.

## The workspace

`createWorkspace(locator)` owns the in-memory scan state and reaches every
entity through the kind registry. Structure:

- **`locator.ts`** (ADR-0003) — the only path authority. Built from injected
  `{ home, appData, platform, env }`; honors `KONDO_STORE_ROOT` /
  `KONDO_DESKTOP_STORE_ROOT` overrides (tests and fixture runs use these).
- **`kinds.ts`** — the kind registry. Every entity kind kondo manages
  (`skill`, `plugin`, `hook`, `settings`, `session`, `project` — the first
  segment of every id, ADR-0008) is one entry supplying `discover`, `read`,
  `capabilities`, `enable` and `disable`. No workspace method names an
  adapter: it validates the id shape it accepts, hands the rest to a kind,
  and wraps the result in the scan envelope. Adding a kind means adding an
  entry here and a row to the matrix, never a branch in `workspace.ts`.
  Code and desktop sessions are two entries sharing the `session` kind,
  because they live in different stores. The two *store reports* on the
  dashboard stay direct calls — a store is not an entity.
- **`capabilities.ts`** — the capability matrix. Write permission is a
  lookup on **kind × scope × operation**, never a single flag: a user skill
  can be disabled, a plugin-shipped one cannot, and the same kind is
  writable in one scope and read-only in another. A row records what
  Claude's own conventions permit (ADR-0006), which is not the same as what
  kondo implements yet — the registry's `enable` / `disable` seats are where
  a mutation is wired in, and none is today. An unrecognized scope refuses
  both operations rather than throwing (ADR-0005).
- **Adapters** — `user-store.ts`, `sessions.ts`, `projects.ts`,
  `desktop-store.ts`. Every public adapter function returns
  `Scan<T> = { data, errors, unknown }` (ADR-0005): partial data, itemized
  typed errors (`{ code, path, message }` — codes, not prose, so the UI can
  react), and unknown entries for domain.md drift detection. Each one stamps
  the entities it builds with their `kind` and their matrix row, so the
  renderer receives capabilities alongside the data and never has to parse
  an id to learn what it may do.
- **`analysis.ts`** — staleness, orphan/duplicate logic: pure functions over
  scanned data, trivially table-testable.
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
mutation journal (`journal.jsonl`), the kondo trash (`trash/`), and any scan
cache will live. Two rules: `<kondo-data>` is never inside a Claude store,
and no Claude-truth is stored there (ADR-0006) — losing it loses undo
history and caches, never the user's actual configuration.

## Growth path

v0.1 hard-coded the read-only adapters into `workspace.ts`. v0.2 replaced
that with the **kind registry** and the **capability matrix** described
above: kinds supply `discover / read / capabilities / enable / disable`,
identity is per ADR-0008, and write permission is a kind × scope ×
operation lookup rather than a boolean. The snapshot-cache, error-isolation
and id-allow-list skeleton stayed exactly as it was — that skeleton is the
part proven by skilldex; the registry is where kondo goes one level up.

What is still open:

- **The mutation seats are empty.** The matrix says what Claude's
  conventions permit; no kind builds a `MutationPlan` yet, and no channel
  invokes one. Each feature fills in its own kind's `enable` / `disable`
  and gets the write path in `mutations.ts` for free (ADR-0001).
- **`mutations.ts` knows two store roots**, `user` and `desktop`. A
  project-scoped write (a project skill, a project settings layer) needs
  the project roots registered there first.
- **No `kinds` channel.** The renderer learns kinds and capabilities from
  the entities it already receives; a listing of the registry itself only
  ships if a view needs one.
