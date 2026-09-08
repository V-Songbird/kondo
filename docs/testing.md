# Testing

## Strategy

Kondo's core risk is misreading or damaging a user's real Claude state, so the
test strategy centers on **fixture stores**: synthetic `.claude` trees built
in temp directories by the builders in `test/helpers.ts`. Fixture roots are
resolved with `realpath` before constructing registry paths or write expectations,
including macOS temp symlinks and Windows short-name aliases. The Electron smoke
requests graceful shutdown before removing its disposable tree; a forced or
abnormal exit fails the smoke, and transient file locks receive bounded retries.
The smoke prefix deliberately contains a dot, underscore and space so the fixture's
flattened transcript names must follow Claude's full non-alphanumeric rule.

1. **Unit — store adapters.** Every adapter is exercised against fixture
   trees covering healthy data, malformed JSON and unknown files from newer
   Claude versions. `test/sessions.test.ts` also covers an existing empty
   user directory with no `projects/` directory. Adapters must return
   partial data + itemized errors, never throw. Permission-denied regressions
   in `test/sessions.test.ts`, `test/user-store.test.ts` and
   `test/desktop-store.test.ts` inject `EACCES` at exact fixture paths while
   forwarding unrelated filesystem calls. They assert the denied operation
   ran, the scan resolved, healthy sibling data survived, and the error names
   the path with `read-failed` or `stat-failed`. Spies restore before fixture
   cleanup. This is deterministic adapter coverage, not evidence of native
   OS ACL enforcement; no real stores or system permissions are changed.
2. **Unit — analysis.** Staleness (`isStale`) and the project-path join
   (`projects.ts`) are pure functions over scanned data, table-tested.
   Prompt-signature grouping (`sessionNearDuplicates`) and the scan cache
   join them in `test/session-duplicates.test.ts`; worked time will when it
   ships.
3. **Integration — the seam.** Workspace methods — the functions the IPC
   handlers delegate to one line each — invoked directly against a fixture
   store; asserts channel contracts (shape in, shape out, errors as values).
   `test/workspace.test.ts` distinguishes a genuinely absent `.claude` from
   an existing empty directory in a synthetic home, with isolated registry,
   desktop, app-data and temporary roots. It asserts honest `user.exists`,
   zero overview counts, and empty session-project, skill, hook and configuration
   orphan listings with no errors or unknown entries. Each API starts from a
   fresh workspace; the reads leave the user store absent or empty as supplied.
   `test/appearance-ipc.test.ts` also drives `registerIpc` with a mocked
   Electron handler registry, verifying that native appearance updates follow
   successful saves and are not sent after failed saves.
4. **Safety invariants.** The tests that must never be deleted, and where
   each lives today:
   - `test/boundary.test.ts` observes `fs/promises.readdir`, `stat`, `lstat`
     and `readFile` across the fixture read-API sweep, rejecting pathname
     escapes except the named registry, project-root stat and project MCP
     file. All five protected identity/token files exist as invented
     sentinels: a separate assertion rejects any `readFile` attempt naming
     one, even when an adapter catches its failure. Five negative cases
     inject EACCES and prove that assertion fails. Spies forward ordinary
     calls and restore before fixture cleanup. Resolved-boundary cases also
     intercept transcript `createReadStream`, promise `open` and returned
     file-handle `read`, `readFile`, `readv` and `createReadStream`, resolving
     observed content paths at call time. Deliberate negative probes prove that
     the observer detects these mechanisms. Synthetic links exercise external
     skills directories (A6), cross-store escapes, post-inventory transcript
     swaps, nested trees, dangling links, cycles and positive in-store aliases.
     File-link setup failures explicitly skip only those cases; directory
     junction variants provide Windows coverage without file-link privileges.
     This does not intercept every synchronous or callback API and is not an
     all-mechanisms filesystem proof. Workspace tests also assert that the emitted project
     objects omit `guessedPath`, while internal inventory resolution remains
     covered by boundary and session tests.
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
   - Every permitted mutation journals before it touches the store, its Undo
     restores the fixture byte-for-byte, nothing is unlinked, and no write
     lands outside a known store root or `<kondo-data>` —
     `test/mutation.test.ts` (ADR-0001). A mutation PR must extend the relevant
     invariants. Cross-scope move checks in `test/skill-move.test.ts` cover
     supported moves, name collisions, plugin-owned refusals, verified copies
     and Undo. Session selection checks in `test/session-duplicates.test.ts`
     cover one journal entry for the whole selection, sidecars, restoration
     and refusal when any chosen id no longer resolves.
   - Settings execution is currently refused on every platform (098,
     ADR-0010). Tests must exercise the production gate for both `write` and
     `splice`, before step preparation, journaling or filesystem effects.
     Mixed plans must refuse whole, even if a move or trash step appears
     first. Confirmed creation of a missing layer must also refuse. Assert
     unchanged target and recovery bytes, unchanged or absent journal, no
     temporary artifacts and no success result. Historical Undo fixtures must
     include write, splice and mixed records and prove no completion is
     appended and no recovery evidence is consumed. Preserve coverage for
     permitted moves, trash and their Undo.
   - `test/mutation.test.ts` retains the pure check "retains reversible byte
     edits without permitting publication" for `applyEdits`, `invertEdits`
     and `digestSource`. This establishes only helper behavior, not exhaustive
     planner coverage or safe filesystem replacement. Per-feature suites
     retain discovery and precedence checks and now assert workspace refusal
     with unchanged stores and history. Re-enabling settings execution must
     restore successful per-feature planning, publication and Undo coverage.
     A pre-replacement competing write reproduced the old apply/Undo data
     loss; refusal prevents entry into that replacement path. Re-enabling it
     requires native concurrency and recovery evidence beyond digest checks,
     temporary-file synchronization or injected-error tests.
   - Undo recovery (099, ADR-0018) uses synthetic rename and journal failures.
     `test/mutation.test.ts` proves a zero-effect Undo remains retryable after
     recreating the workspace; partial Undo preserves later edits at confirmed
     paths; occupant displacement resumes without losing either version; pending
     intent, post-effect and pre-close interruptions do not imply no effects.
     Uncheckpointed forward effects remain reversible without finishing the
     forward plan. Ambiguous pending bytes refuse replay. Corrupt/omitted actions,
     adjusted completion cursors, escaped trash references, torn lines and failed legacy Undo retain
     history and cannot establish a false `undoneBy`. Existing settings refusal,
     streaming, privacy and EXDEV byte-preservation assertions remain in force.
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
   The shared client exposes `on(method, handler)` (returning unsubscribe),
   `exceptions` (`Runtime.exceptionThrown` payloads), and `consoleErrors`
   (error-type `Runtime.consoleAPICalled` payloads, including arguments and
   stack traces). Runtime collectors are installed before Runtime.enable,
   including any replayed evidence. Smoke subscribes to
   `Network.requestWillBeSent` before Network.enable, then reloads with cache
   bypassed and requires a new ready renderer plus an observed `file:` document
   request. This monitors a full renderer initialization on each launch.
   After each test and final shutdown, retained evidence from every launch must
   contain no exceptions, no unexpected error console output, and no request URLs outside
   `file:` and `devtools:`. Invalid URLs also fail. Diagnostics include full
   violating payloads. The app and Themes import the mark SVG with `?no-inline`
   so Vite emits a local file; its default data-URL inlining would fail this
   policy even though that image makes no outbound connection.
   Intentional malformed-store and save-failure checks
   expect bridge error values and visible alerts; they do not exempt console
   errors or uncaught exceptions. Warnings and ordinary console logs do not fail.
   `test/cdp.test.mjs` exercises the actual client and smoke assertion with
   synthetic frames, proving each failure without making external requests.
   Evidence survives reloads, disconnects, and fixture app relaunches. Coverage
   begins when each CDP domain is enabled; the first navigation before attachment
   can be missed. The monitored reload covers renderer initialization, not the
   original process startup. This page-target check does not monitor Electron
   main-process traffic, the splash, or separate worker/other page targets, and
   does not establish whole-process network silence. Capture ends at CDP
   disconnect, before forced process termination in the direct-executable lane.
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

Project fixtures in the plugin-move, plugin-toggle, skill-move, skill-toggle
and placed-move suites use `registerProjects` from `test/helpers.ts` before
creating the workspace. It writes exact synthetic paths to the fixture's
`~/.claude.json` (ADR-0009), so project resolution does not depend on reversing
flattened directory names. Their mutation and undo cases run unconditionally,
including when the temporary root contains hyphens.

`test/error-boundary.test.tsx` covers defensive error normalization and static
fallback markup (including escaped text and the version); server rendering is
not evidence that a boundary catches descendant errors. Electron smoke drives
the actual App boundary through a test-only synthetic Search input event: its
value throws the retained Error during catalog filtering in the next render.
This uses React's host-node handler property and fails explicitly if that
scaffolding changes; no production crash API ships. Smoke exempts exactly one
caught-error console event per exercise, only after CDP proves its sole
argument is that same Error object. All other console events, every uncaught
exception and every request retain the normal health gate, including after
reload and shutdown. The fixture test asserts populated startup after the
initial read, alert and button accessibility roles, literal message, build
version, heading focus, visible keyboard focus, and Enter-to-reload recovery.
Chalk and Carbon are checked at 1360x860 and 900x600 with optional screenshots
and unchanged fixture stores/journal. This does not establish screen-reader
announcements or recovery of asynchronous actions or store mutations.

## Reviewed removals (102)

The focused fixture suites `test/tidy.test.ts`, `test/session-duplicates.test.ts`
and `test/skill-duplicates.test.ts` cover review-token requirements and stale
preconditions. Audit A5/A9/A11 are inverted: adding a cache after preview,
resuming a transcript, or changing a formerly identical skill must refuse before
store mutation or journal append. Unchanged reviewed plans retain their existing
apply/Undo checks. Scratch activity and memory checks keep uncertain trees out
of the reviewed candidate set.

The workspace and IPC integration tests exercise the selected-session preview
and token forwarding. The Electron fixture smoke covers confirmation through
the real bridge, visible stale-review refusal, cleared selection, focus and a
return to review. Chalk/Carbon captures at normal and compact sizes are visual
evidence for the host tested. A clean mechanical detector is separate evidence
from those rendered states. None of these tests claims filesystem transactions
or a complete absence of races with external writers after preflight.

The 099 built-app smoke moves a fixture's recovery directory temporarily out of
reach, verifies the inline `data:null` refusal does not claim Undo or consume the
original, checks result focus and keyboard retry, and restores exact fixture
bytes. Another case relaunches Electron against a partial prefix of the journal
that the app actually produced, with filesystem state matching that prefix.
History reports incomplete Undo and resumes without changing a later edit at the
confirmed restore path. Chalk/Carbon at 1360x860 and 900x600 supply rendered
proof. This is synthetic interruption/relaunch coverage, not a power-loss test.
Journal assertions count operation intents, not internal progress lines.

One remaining suite limitation:

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

`test/relocation.test.ts` exercises link identity through trash and undo with
native directory links, both rename and an injected `EXDEV` fallback. It checks
future internal and sibling targets, exact-file restoration, occupied restore
paths and physical trash measurement/removal without following referents. A
corrupted copy must retain its source and remove only its incomplete destination;
if cleanup also fails, undo refuses before changing the healthy source or journal.
These are fixture and injected-error checks, not a native multi-volume proof.

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
