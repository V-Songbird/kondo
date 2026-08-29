# Foundations

How kondo is put together. Decisions live in [adr/](adr/); this document is
the map that connects them.

## Process model

Three Electron layers, strictly separated:

```
electron/main/      the only code that touches disk
  index.ts          app bootstrap + composition root (thin; no domain logic)
  ipc.ts            channel registration — one line per channel, delegates to workspace
  workspace/        locator, store adapters, analysis (Electron-free, fully injectable)
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

`createWorkspace(locator)` wires the adapters and owns the in-memory scan
state. Structure:

- **`locator.ts`** (ADR-0003) — the only path authority. Built from injected
  `{ home, appData, platform, env }`; honors `KONDO_STORE_ROOT` /
  `KONDO_DESKTOP_STORE_ROOT` overrides (tests and fixture runs use these).
- **Adapters** — `user-store.ts`, `sessions.ts`, `projects.ts`,
  `desktop-store.ts`. Every public adapter function returns
  `Scan<T> = { data, errors, unknown }` (ADR-0005): partial data, itemized
  typed errors (`{ code, path, message }` — codes, not prose, so the UI can
  react), and unknown entries for domain.md drift detection.
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

v0.1 hard-codes the read-only adapters. The next structural step (v0.2, with
mutations) is a **kind registry**: each entity kind (skill, plugin, hook,
session, setting) supplies `discover / read / capabilities / enable /
disable`, with identity per ADR-0008 and write-permission decided by a
capability matrix (kind × scope × operation), not a boolean. The
snapshot-cache, error-isolation, and id-allow-list skeleton stays as is —
that skeleton is the part proven by skilldex; the registry is where kondo
goes one level up.
