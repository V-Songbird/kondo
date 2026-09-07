# Electron with a context-isolated, typed bridge

Kondo is a desktop dashboard over sensitive local data. The shell is
Electron with the renderer fully locked down; the pattern is adopted from
skilldex, which proved it at smaller scope, with the gaps we found in that
codebase fixed from the start.

The seam: `contextIsolation: true`, `sandbox: true`, `nodeIntegration:
false`; a preload script exposes `window.kondo`, a flat set of typed async
functions, each one `ipcRenderer.invoke` line. All disk I/O lives in the
main process. The renderer gets data, display strings, and ids — never
paths, never `fs`.

## Considered options

- **Tauri.** Smaller binaries, Rust core. Rejected: two-language codebase,
  and the reference architecture being generalized (skilldex) is
  Electron/TypeScript — parity keeps every lesson transferable.
- **Local web server + browser.** Rejected: a listening port turns "local
  only" into a firewall question, and there is no sandbox story for the
  data-owning process.
- **Electron, locked down (chosen).**

## What we deliberately do differently than skilldex

Its report card drove these; each was a real defect there:

1. **One contract module.** `shared/contract.ts` holds seam types + channel
   names; main, preload, and renderer import the same file. Skilldex
   hand-mirrored types in `src/` and let them drift with no detector.
2. **Strict TypeScript on both sides.** Its renderer tsconfig lacked
   `strict`; ours is strict everywhere — seam drift surfaces as null errors
   at compile time.
3. **Typed errors.** Failures cross the seam as `{ code, path, message }`,
   not prose strings the UI would have to regex.
4. **CSP + navigation guards.** A `connect-src 'none'` policy injected as a
   response header on packaged builds (dev needs the HMR websocket, so the
   policy differs by mode), `setWindowOpenHandler` deny, `will-navigate`
   blocked. Skilldex had none;
   for kondo the renderer displays attacker-influenced text (transcripts),
   so the belt-and-suspenders is not optional.
5. **Ids across the seam** from day one (ADR-0008), including for reads.

## Amendment: the unit of growth is the operation, not the kind

A channel per kind per operation does not scale with the kinds kondo
manages. Two kinds with two operations were four methods, four handler lines
and four bridge lines; the kinds the roadmap adds — `mcp`, `agent`,
`command`, `rule`, `output-style` — with the same two operations plus `move`
would have been around fifteen more, each one a place for the three sides to
drift apart.

So the seam grows by **operation**. Two generic channels carry every kind:

- `entityList(kind, parentId?)` — every entity of one kind, narrowed to a
  parent where a listing takes one.
- `entityMutate(entityId, request)` — one request against one entity, where
  `request` is `{ op, targetId?, confirm? }` and `op` is a
  `CapabilityOperation`.

The main process picks the registry entry from the id's kind prefix
(ADR-0008); the renderer still hands back the id it was given and parses
nothing. Adding a kind is a row in the registry and a row in the capability
matrix — no method, no handler line, no bridge line. Adding an *operation* is
where the contract genuinely grows, and it costs one value in
`CapabilityOperation` plus a branch in the kinds that implement it.

This narrows the seam rather than widening it. Everything still crosses a
context-isolated bridge, everything is still validated in the main process,
and the capability matrix is still the only thing that grants a write — a
generic channel cannot reach anything a per-kind channel could not, because
permission was never a property of the channel.

Channels shipped before this amendment stay, as thin aliases over the two
above, so views already written against them keep working. New work takes the
generic pair.

## Amendment: window lifecycle rides beside the contract, not inside it

The splash hands over when the renderer's first read has settled, which the
main process cannot observe on its own — `ready-to-show` fires at the first
painted frame, well before any data exists. So the renderer says so, over
`rendererReadyChannel` in `shared/contract.ts`.

That channel is deliberately **not** a `KondoApi` method. `channels` is
`satisfies Record<keyof KondoApi, string>`, and adding a member would have
forced `createWorkspace` to implement a window-lifecycle call that touches no
store — domain surface bought for a splash. `KondoApi` stays the set of
operations against a Claude store; anything about the window itself sits
beside it, exposed on its own bridge key and listened for on the window's own
`webContents.ipc` so one window cannot be shown by another's signal.

It is one-way and unanswered: `ipcRenderer.send`, not `invoke`. Nothing
crosses back, nothing is validated, and the renderer cannot reach any file
through it. The security model is unchanged, because permission was never a
property of the channel.

## Amendment: persist app appearance through the same typed bridge

Themes adds `appearanceGet()` and `appearanceSet(theme)` to `KondoApi`. This
extends the earlier Claude-store-only scope to include Kondo's own persisted
preferences: appearance has disk I/O and a typed result, unlike the one-way
renderer-ready lifecycle signal above. The workspace composes a separate
appearance helper; it does not route this through the entity registry or
Claude's mutation journal.

Only an identifier from the shared six-theme catalog is accepted, validated
again in main. No file path, arbitrary CSS or serialized renderer state may
cross. Preferences live at a fixed path under Kondo's app data root. Reads
and writes return `Scan<AppearancePreferences>`; a save failure returns the
previous usable choice and a `write-failed` error. Main updates native window
colors only after a successful save, and renderer startup restores the same
choice before mounting. This keeps persistence, native colors and the page on
one catalog without introducing renderer filesystem access or a second local
storage mechanism.

## Amendment: one workspace owner per app data directory

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
isolation and sandboxing, deny window opens and prevent navigation. The shared
session installs the existing mode-specific CSP before either window loads.
`test/safety.test.ts` runs the real entry module with mocked Electron and
workspace boundaries to pin these controls and the refused-lock startup path.

## Consequences

- Electron's disk/memory footprint; accepted for a tool whose job is
  visualizing gigabytes of local state.
- Every new *operation* costs a contract entry + handler + bridge line; that
  friction is the security model working. A new *kind* costs a registry row
  and a matrix row, and nothing at the seam — see the amendment above.
- The preload bridge stays dumb: no logic, no state, one line per method.
