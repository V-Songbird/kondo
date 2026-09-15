# Electron with a context-isolated, typed bridge

Kondo is a desktop dashboard over sensitive local data. The shell is Electron
with the renderer fully locked down.

The seam: `contextIsolation: true`, `sandbox: true`, `nodeIntegration:
false`; a preload script exposes `window.kondo`, a flat set of typed async
functions, each one `ipcRenderer.invoke` line. All disk I/O lives in the
main process. The renderer gets data, display strings, and ids — never
paths, never `fs`.

## Considered options

- **Tauri.** Smaller binaries, Rust core. Rejected: a two-language codebase,
  and the reference architecture kondo generalizes (skilldex) is
  Electron/TypeScript, so its lessons transfer directly.
- **Local web server + browser.** Rejected: a listening port turns "local
  only" into a firewall question, and there is no sandbox story for the
  data-owning process.
- **Electron, locked down (chosen).**

## Controls

1. **One contract module.** `shared/contract.ts` holds seam types and channel
   names; main, preload and renderer import the same file. Skilldex
   hand-mirrored its types and let them drift with no detector.
2. **Strict TypeScript on both sides**, so seam drift surfaces at compile
   time.
3. **Typed errors.** Failures cross the seam as `{ code, path, message }`,
   not prose strings the UI would have to regex.
4. **CSP and navigation guards.** The session injects a Content-Security-Policy
   response header before either window loads: `connect-src 'none'` when
   packaged; in development only the Vite HMR websocket (`'self' ws:`) and the
   inline preamble are added. `setWindowOpenHandler` denies and `will-navigate`
   is blocked. The renderer displays attacker-influenced text (transcripts), so
   these are not optional.
5. **Ids across the seam** (ADR-0008), including for reads.

## The seam grows by operation, not by kind

Two generic channels carry every kind:

- `entityList(kind, parentId?)` — every entity of one kind, narrowed to a
  parent where a listing takes one.
- `entityMutate(entityId, request)` — one request against one entity, where
  `request` is a `MutateRequest` (`{ op, targetId?, sourceId?, reviewToken?,
  confirm? }`) and `op` is a `CapabilityOperation`.

The main process picks the registry entry from the id's kind prefix
(ADR-0008); the renderer hands back the id it was given and parses nothing.
Adding a kind is a row in the registry and a row in the capability matrix — no
method, handler line or bridge line. Adding an *operation* is where the
contract grows: one value in `CapabilityOperation`, the op check in
`entityMutate`, and a branch in each kind that implements it. A channel per
kind per operation would have multiplied the places the three sides can drift
apart.

This narrows the seam rather than widening it. Everything still crosses the
bridge and is validated in main. The capability matrix must allow an
operation before a plan is built, but that is necessary rather than
sufficient: the mutation layer still refuses settings writes (ADR-0010).
Permission was never a property of the channel.

Older per-kind channels remain as thin aliases over the generic pair. Two
paths do not use it: `pluginClear` plans and mutates directly, and
selected-session removal has its own `sessionTrashPreview` and `sessionTrash`
channels because removal binds to the reviewed state (ADR-0015);
`entityMutate` refuses session trash.

## Window lifecycle rides beside the contract

The splash hands over when the renderer's first read has settled, which main
cannot observe — `ready-to-show` fires at the first painted frame. So the
renderer says so over `rendererReadyChannel`, and asks for its own reload over
`rendererReloadChannel` ([ADR-0014](0014-reload-through-window-lifecycle.md)).
Neither is a `KondoApi` method: `channels` is `satisfies Record<keyof KondoApi,
string>`, and a member would force `createWorkspace` to implement a window
call that touches no store. Both are exposed on their own bridge keys
(`kondoReady`, `kondoReload`), sent one-way with `ipcRenderer.send`, and
listened for on the owning window's `webContents.ipc`, so one window cannot be
driven by another's signal and nothing crosses back.

## Kondo's appearance preference

`KondoApi` covers operations against a Claude store plus Kondo's own
appearance preference: `appearanceGet()` and `appearanceSet(theme)`. The
workspace composes a separate appearance helper, outside the entity registry
and Claude's mutation journal. Only an identifier from the shared theme
catalog is accepted, validated again in main; no file path, arbitrary CSS or
serialized renderer state crosses. Preferences live at a fixed path under
Kondo's data root. Reads and writes return `Scan<AppearancePreferences>`; a
save failure returns the previous usable choice and a `write-failed` error.
Main updates native window colours only after a successful save, and renderer
startup restores the choice before mounting.

## One workspace owner per app data directory

The main entry acquires `app.requestSingleInstanceLock()` before readiness,
workspace construction, IPC registration or window creation. A refused process
quits and cannot enter startup. A second launch restores and focuses the
existing window; a request arriving before its first read settles waits for
the splash handover. Reopening on activation reuses the workspace and handlers.

When `KONDO_DATA_ROOT` overrides the journal/trash root, startup creates and
canonicalizes that directory and selects it as Electron's `userData` before
locking. Otherwise separate Chromium profile flags could bypass exclusion
while sharing that override. This is a local application lock, not coordination
between different OS users or machines. The override also relocates Electron's
profile data; ordinary launches retain Electron's existing path selection.

Both main and splash explicitly disable Node integration, enable context
isolation and sandboxing, deny window opens and prevent navigation.
`test/safety.test.ts` runs the real entry module with mocked Electron and
workspace boundaries to pin these controls and the refused-lock startup path.

## Consequences

- Electron's disk/memory footprint; accepted for a tool whose job is
  visualizing gigabytes of local state.
- Every new *operation* costs contract, handler and bridge work; that friction
  is the security model working. A new *kind* costs a registry row and a
  matrix row, and nothing at the seam.
- The preload bridge stays dumb: no logic, no state, one line per method.
