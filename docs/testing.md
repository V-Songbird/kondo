# Testing

## Strategy

Kondo's core risk is misreading or damaging a user's real Claude state, so the
test strategy centers on **fixture stores**: synthetic `.claude` trees built
in temp directories by the builders in `test/helpers.ts`.

1. **Unit — store adapters.** Every adapter is exercised against fixture
   trees: a healthy store, an empty store, a store with malformed JSON, a
   store from a newer Claude version with unknown files. Adapters must return
   partial data + itemized errors, never throw. (A permission-denied fixture
   is still missing — chmod-style unreadability has no reliable
   cross-platform recipe yet; add it when one exists.)
2. **Unit — analysis.** Staleness, worked time, duplicates, orphans are pure
   functions over scanned data. Table-driven tests with edge cases (clock
   skew, single-message sessions, timestamp gaps).
3. **Integration — the seam.** IPC handlers invoked directly against a fixture
   store; asserts channel contracts (shape in, shape out, errors as values).
4. **Safety invariants.** The tests that must never be deleted, and where
   each lives today:
   - The scanner never touches a path outside the stores and `.claude`
     directories — `test/boundary.test.ts` records every `fs` call across a
     full API sweep and fails on any escape.
   - APIs refuse renderer-supplied free-form paths and unknown ids —
     `test/workspace.test.ts`.
   - The renderer has no filesystem or Electron access, the contract stays
     platform-free, and only the locator and composition root resolve
     machine locations — `test/safety.test.ts` (structural).
   - Every mutation journals before it touches the store, its undo restores
     the fixture byte-for-byte, nothing is unlinked, and no write lands
     outside a known store root or `<kondo-data>` —
     `test/mutation.test.ts` (ADR-0001). A mutation PR that does not extend
     these is incomplete — the skill toggle extends them in
     `test/skill-toggle.test.ts` (journal before the move, both scopes, and
     the matrix refusal), and the plugin toggle in
     `test/plugin-toggle.test.ts` (the splice leaves every other byte of the
     settings file alone, layer precedence, and the confirmation gate on
     creating a layer that is not there).
5. **End-to-end** (later): the built app driven against a fixture store via a
   `KONDO_STORE_ROOT` override.

## Rules

- **Tests never touch real stores.** No test may resolve `~/.claude`, the
  real desktop store, or any path outside the repo and temp dirs. The locator
  accepts injected roots precisely for this.
- Fixtures are **anonymized** — invented project names, no real transcripts.
  Never copy your own `~/.claude` content into the repo.
- A bug fix lands with the test that would have caught it.
- CI runs the suite on Windows, macOS, and Linux (path handling is where this
  project will break — see ADR-0003).

## Commands

```bash
npm test             # vitest, single run
npm run test:watch   # vitest watch mode
npm run typecheck    # tsc -b, strict, both tsconfigs
npm run lint         # oxlint
npm run guards       # the jig checks (stdlib node only)
```

## The guards

Four invariants are also enforced outside the suite, by checks under
`.jig/checks/`, blocking at edit time and in CI:

| Guard | Refuses |
|---|---|
| `renderer-reaches-past-the-bridge` | `node:` / `electron` imports and `require()` under `src/` |
| `outbound-network-call` | `fetch`, `WebSocket`, `XMLHttpRequest`, `node:http(s)` anywhere shipped |
| `raw-path-across-the-seam` | a path-shaped parameter in `electron/preload/` or `ipc.ts` (ADR-0008) |
| `test-touches-a-real-store` | `homedir()`, home-ish env vars, or a hard-coded store path in `test/` |

Each carries a violation/near-miss fixture pair inline and proves itself with
`node .jig/checks/run.mjs --selftest`. The driver is standard-library node,
so it runs with nothing installed. `/jig:review` shows what they have caught.
