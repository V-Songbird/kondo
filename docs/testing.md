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
2. **Unit — analysis.** Staleness (`isStale`) and the project-path join
   (`projects.ts`) are pure functions over scanned data, table-tested.
   Prompt-signature grouping (`sessionNearDuplicates`) and the scan cache
   join them in `test/session-duplicates.test.ts`; worked time will when it
   ships.
3. **Integration — the seam.** Workspace methods — the functions the IPC
   handlers delegate to one line each — invoked directly against a fixture
   store; asserts channel contracts (shape in, shape out, errors as values).
   `test/appearance-ipc.test.ts` also drives `registerIpc` with a mocked
   Electron handler registry, verifying that native appearance updates follow
   successful saves and are not sent after failed saves.
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
   - Both windows enforce isolation, sandboxing and navigation denial, and the
     session injects the exact packaged/development CSPs — `test/safety.test.ts`
     executes the actual main entry against mocked Electron. It also verifies
     lock refusal never starts a workspace, lock ordering/data-root selection,
     queued startup focus, minimized-window restoration and window reopening
     with one workspace/IPC registration. These are mocked lifecycle checks,
     not evidence of native window-manager behavior on every platform.
   - Every mutation journals before it touches the store, its undo restores
     the fixture byte-for-byte, nothing is unlinked, and no write lands
     outside a known store root or `<kondo-data>` —
     `test/mutation.test.ts` (ADR-0001). A mutation PR that does not extend
     these is incomplete — the skill toggle extends them in
     `test/skill-toggle.test.ts` (journal before the move, both scopes, the
     matrix refusal, and the digest-guarded splice its undo inverts), the
     plugin toggle in
     `test/plugin-toggle.test.ts` (the splice leaves every other byte of the
     settings file alone, layer precedence, the confirmation gate on
     creating a layer that is not there, and an undo refused onto bytes
     something else has since written), and the cross-scope move in
     `test/skill-move.test.ts` (all three directions, the name-collision and
     plugin-owned refusals, undo removing the copy as well as restoring the
     source, and — the one that matters most — a copy that does not verify
     leaving the source untouched). Trashing a chosen set of sessions extends
     them in `test/session-duplicates.test.ts` (one entry for the whole
     selection, sidecars carried with their transcripts, undo restoring the
     fixture byte-for-byte, and a refusal that moves nothing when one id in
     the set no longer resolves).
     A settings toggle against a file already on disk is a `splice` carrying
     the digest it was planned at (ADR-0010), so its test asserts the journal
     holds edits and no snapshot; `test/skill-overrides.test.ts` pins the same
     for a global skill switched off inside one project.
5. **End-to-end**: `npm run test:e2e` (`test/e2e/smoke.mjs`, node's own test
   runner) builds the run-kondo fixture in a fresh temp directory, launches
   the built app against it through the three `KONDO_*_ROOT` overrides with
   `--remote-debugging-port`, and drives it over Chromium's debugging
   protocol: Library starts selected among four work destinations, with Themes
   reached separately from the shell; the projects list
   is the fixture's union, All projects lists the fixture's skills and plugins,
   the three Clean up sections answer, and one skill move goes through the bridge and comes back with its
   undo — the journal on disk checked both times. It runs on all three OSes in
   CI (`smoke` job, xvfb on Linux) after `npm run build`, and it shares its
   protocol client (`.claude/skills/run-kondo/cdp.mjs`) with the `run-kondo`
   skill's `drive.mjs`, the manual UI check, so the two cannot drift apart.
   It is not part of `npm test`: it needs a built app and a display.
   The release workflow also gates **each artifact upload** on this smoke:
   Windows silently installs the generated NSIS package into a unique runner
   temp directory and drives its installed `Kondo.exe`; Linux drives the
   generated `.AppImage` under xvfb with `--appimage-extract-and-run`; macOS
   drives `release/mac*/Kondo.app/Contents/MacOS/Kondo`. Missing or ambiguous
   artifact/executable matches fail the leg. `KONDO_E2E_BINARY` selects the
   executable; `test/e2e/process.mjs` recognizes Linux `.AppImage` paths and
   prepends the runtime flag, preserving the Electron arguments. All launches
   and restarts retain the three fixture root overrides and use an isolated
   Electron profile. AppImage extraction also stays inside the fixture; the
   harness requests browser shutdown and waits for the runtime to finish its
   cleanup before restarting. A shutdown timeout kills that fixture's process
   group and fails smoke. Launcher regressions run in `npm test` through
   `test/e2e-process.test.mjs`.
   macOS coverage is **app-bundle smoke**, not DMG mounting/installation or
   Gatekeeper approval. Installer prompts, signing warnings and broader desktop
   behavior still need platform-specific checks.

Two things to know about the suite as it stands:

- Several mutation suites still gate verified-project cases on
  `it.runIf(TMP_OK)` (a tmpdir with no hyphen) because they name the project
  through the fallback guess. `registerProjects` in `test/helpers.ts` writes
  the fixture's `~/.claude.json` (ADR-0009) and removes the need; the
  boundary and workspace suites use it, the rest should follow. CI does not
  assert that gated tests ran.
- The renderer has no isolated DOM unit suite; the built Electron smoke covers
  Library-to-project navigation and return with preserved filters/selection,
  real Tab/Enter/Space routes, native disclosures, named controls, focus on
  results, cancellation with unchanged journal/settings bytes, and partial
  Library reads when a fixture MCP file is malformed. Layout checks at 900x600
  assert pane width and absence of horizontal document/content overflow, in
  addition to screenshots. Cleanup and permanent trash confirmation stay
  separate. Set `KONDO_E2E_SHOTS` to an output directory for visual evidence.
  These checks use only synthetic stores and do not establish screen-reader
  or cross-platform desktop behavior beyond the platform actually tested.

Appearance has its own safety boundary. The Electron smoke starts with Chalk,
checks all six named native radios through Chromium's accessibility tree and
real arrow-key navigation, and compares a visible background across light and
dark selections. The shell header must keep its height across all six themes
at 1360px, including the longer Signal Original name. Visiting Themes preserves
the Library item and search plus the selected Project section. At 900x600,
the selected theme card and Library detail must fit without horizontal
overflow; optional screenshots
capture both Chalk and Carbon. The suite then reloads the renderer and
relaunches Electron against the same fixture to prove Carbon persists through
`appearanceGet()` and Kondo's own `appearance.json`. Before and after these
actions it compares every synthetic Claude file and directory plus the exact
journal bytes, including the absence of a journal on first use. Changing
appearance must never change any of them. These checks complement the
preference adapter's invalid-input and write-error coverage; visual evidence
does not prove every theme's colors or every assistive technology.
An additional Electron regression temporarily replaces the fixture's
`appearance.json` with an empty directory to force a portable save failure.
Keyboard retries must keep focus on the checked native radio while the retry
button disappears and reappears, including repeated failure and successful
recovery after the collision is removed. Claude files and journal bytes stay
unchanged. Optional screenshots also capture Signal Original and the save
error/recovery states.

`node --test test/e2e/single-instance.mjs` is a separate built-app desktop
regression. It creates synthetic stores and disposable app data, uses different
Chromium profile flags with the same Kondo data override, and discovers an
unused debugging port from its own child's output. It checks that the second
process exits cleanly and that the first window restores and receives focus.
Run after `npm run build` with a display. When Electron omits CDP's native
window-bounds methods, the test uses its own primary process's inspector to
minimize the window and verify native restoration/focus. Both debugging ports
are allocated by the OS and only endpoints emitted by the fixture child are
used; no test-only API is added to the production bridge. A local pass
establishes behavior only on the tested desktop.

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

Six invariants are also enforced outside the suite, by checks under
`.jig/checks/`:

| Guard | Refuses | Lanes |
|---|---|---|
| `renderer-reaches-past-the-bridge` | `node:` / `electron` imports and `require()` under `src/` | session (observe), pre-commit, CI |
| `outbound-network-call` | `fetch`, `WebSocket`, `XMLHttpRequest`, `node:http(s)` anywhere shipped | session, pre-commit, CI |
| `raw-path-across-the-seam` | a path-shaped parameter in `electron/preload/` or `ipc.ts` (ADR-0008) | session, pre-commit, CI |
| `test-touches-a-real-store` | `homedir()`, home-ish env vars, or a hard-coded store path in `test/` | session (observe), pre-commit, CI |
| `workspace-adapter-outruns-domain-doc` | a commit touching `electron/main/workspace/` without `docs/domain.md` staged | pre-commit only |
| `seam-contract-outruns-its-adr` | a commit touching `shared/contract.ts` without an ADR staged | pre-commit only |

The session lane (a Claude Code `PostToolUse` hook) ignores a guard's path
scope, so two guards are held in *observe* there until jig honours it
(ROADMAP entries 017, 021); the path-scoped guards also misfire on
workspace-internal helpers in that lane — read the pre-commit result, not the
session one. The two paired-change guards read the git index, so they run
at pre-commit (`core.hooksPath=.jig/hooks`, per clone) and report themselves
skipped in CI. Each check carries a violation/near-miss fixture pair inline
and proves itself with `node .jig/checks/run.mjs --selftest`. The driver is
standard-library node, so it runs with nothing installed. `/jig:review` shows
what they have caught.
