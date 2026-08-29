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

## Consequences

- Electron's disk/memory footprint; accepted for a tool whose job is
  visualizing gigabytes of local state.
- Every new capability costs a contract entry + handler + bridge line; that
  friction is the security model working.
- The preload bridge stays dumb: no logic, no state, one line per method.
