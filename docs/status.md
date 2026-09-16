# Status

Where work stands, for a session that starts without context. Written
2026-09-16; Git is the authority, so check `git log`, `git branch -a` and
`git worktree list` before relying on the tables below.

## Main today

`main` is `74dee6a`. Four pull requests landed on 2026-09-16, each
squash-merged with `--match-head-commit` and a Foreman trailer. Every run named
below covered Windows, macOS and Linux:

| Entry | Subject | PR | Merge | Hosted CI |
|---|---|---|---|---|
| 147 | Reconcile the status document and the roadmap after batch 2 | #30 | `b4a9388` | PR run 35051073843 and `main` run 35051248508, green first attempt |
| 110 | State in-app claims as what kondo does and reads | #31 | `5bda991` | PR run 35053731093 and `main` run 35053857539, green first attempt |
| 110 | Name the files a conversation removal moves, and the ones it keeps | #32 | `22c8932` | PR run 35055087902 and `main` run 35055203539, green first attempt |
| 115 | Check resolved overlap between Kondo data and Claude stores | #33 | `74dee6a` | PR run 35059080850 and `main` run 35059290002 green; the first PR run is the exception below |

- The exception: 115's first pull-request run (35058601692, at head `39f8e19`)
  failed only `verify` on `windows-latest`, with four suites past the 5000 ms
  timeout across journal, placed-move and tidy. The cause was a per-step
  `realpath` round trip in `rootOf`
  ([mutations.ts:466](../electron/main/workspace/mutations.ts)) — a genuine
  regression, not the flake in finding 4 — and the worker moved the project
  store's check to once per serialized operation before the green run at
  `b2aeb87`.
- Decisions the batches touched:
  [ADR-0015](adr/0015-bind-removal-to-reviewed-state.md) amended by 110 with a
  "What a review discloses" section. 115 changed no decision and no seam.
- Local checks, reported by each worker from its own worktree through fnm
  Node 22. On 115's tree `b2aeb87`, the last tree whose local results were
  reported: `npm test` passed 860 with no failure, and `npm run guards`,
  `npm run typecheck`, `npm run lint` and `npm run build` were clean. That run
  reported no separate skipped count; 110's second half, at `367d34f`, reported
  832 passed and 14 skipped because the host cannot create file symlinks. 110
  ran `npm run test:e2e` locally (27 passed) and drove the built app with
  `.claude/skills/run-kondo/` in Chalk and Carbon at 1360x860 and 900x600
  against a synthetic fixture outside the OS temp root; 115 ran no local smoke,
  and 147 was documentation only. Hosted CI ran the smoke on every pull
  request.
- Version 0.5.0, pre-release. There are no releases or tags, and the repository
  has been public since 2026-09-15.
- What the app does is in [README.md](../README.md#what-it-does). Refused or
  read-only by decision: settings changes
  ([ADR-0010](adr/0010-splice-config-files-never-whole-file-writes.md)), hook
  declarations ([ADR-0017](adr/0017-hook-layer-boundary.md)) and Desktop
  sessions ([ADR-0016](adr/0016-desktop-session-boundary.md)). A `<kondo-data>`
  whose resolved path sits inside a Claude store is refused at every operation
  that reaches it ([ADR-0001](adr/0001-mutations-are-reversible.md)), through
  `overlapRefusal` ([scan.ts:109](../electron/main/workspace/scan.ts)).

## Work in progress

No pull requests are open and `origin` holds only `main`.

Entry 132 is in progress: its [plan](plans/132-sandbox-preload-startup.md) is
written and no experiment has run. A hosted Linux case on 2026-09-15 showed the
failure is not Windows-only.

Entry 157 is in flight on a worktree branch cut from `74dee6a`:

| Entry | Branch |
|---|---|
| 157 | `worktree-157-status-after-batch-5` |

## Next steps

1. Land 157.
2. Then 124, 125, 126, 127, 134, 137 to 144 and 148 to 156, taking 149 first
   among the tooling entries: 147 found 11 of 24 `file:line` anchors wrong
   after a single batch.
3. Then 132 and 120, both of which need a quiet machine.
4. Finally 114.

## Open findings

Code that contradicts a decision in force or its own documentation. Each needs
an owner decision or a roadmap entry.

1. **Stale code comments** describe superseded behaviour: `skills.disabled/` as
   Claude's convention ([kinds.ts:358](../electron/main/workspace/kinds.ts));
   the user layer as the Global page's business, after 110 renamed that scope
   to "All projects" everywhere it shows
   ([kinds.ts:532](../electron/main/workspace/kinds.ts)); `enable`/`disable`
   seats instead of one `plan` seat
   ([capabilities.ts:15](../electron/main/workspace/capabilities.ts)); hook
   scripts offered for cleanup ([contract.ts:1200](../shared/contract.ts)); and
   plugin clearing and leftover removal as working edits
   ([contract.ts:1631](../shared/contract.ts), line 1718). 103 removed the MCP
   read-only comments and the "entry 031 will remove" note; 106 removed the
   single-installed-version comment, because `PluginInfo` now carries every
   installation ([contract.ts:704](../shared/contract.ts)); 110 removed the
   hook-move comment and the settings-file one in `projects.tsx`. Unassigned.
2. **Read-only tooling out of step with the docs:** `.jig/hooks/pre-commit` is
   mode 100644, so Unix Git skips it while `.jig/activation.md` says every
   commit runs the checks (126); `.claude/settings.json` registers the session
   shim on `PostToolUse` while the guards run on `PreToolUse` (125);
   [test-touches-a-real-store.check.mjs:4](../.jig/checks/test-touches-a-real-store.check.mjs)
   still calls the suite read-only (134);
   [seam-contract-outruns-its-adr.check.mjs:20](../.jig/checks/seam-contract-outruns-its-adr.check.mjs)
   asks for "a new ADR superseding" the old one, which the ADR policy no longer
   uses (150); [SKILL.md:112](../.claude/skills/run-kondo/SKILL.md) and line 228
   cite entries 060 and 124; the PR template and CONTRIBUTING's checklist have
   diverged; and [release.yml:159](../.github/workflows/release.yml) keeps a
   history comment.
3. **Guards match fewer forms than the decisions they protect:** side-effect and
   dynamic imports pass `renderer-reaches-past-the-bridge`, and a parameter
   named `path` passes `raw-path-across-the-seam`
   ([testing.md](testing.md#the-guards)). No current code violates either
   decision.
4. **Hosted `verify` on `windows-latest` timed out once** on a 5000 ms vitest
   case in [tidy.test.ts](../test/tidy.test.ts), on a docs-only commit (run
   35037504008) — the same kind of timeout workers see locally under load.
   Unassigned.
5. **CONTRIBUTING explains the missing `main` protection as a consequence of
   "this private repository"**
   ([CONTRIBUTING.md:101](../CONTRIBUTING.md)), although the repository has been
   public since 2026-09-15. The protection is still absent; only the stated
   reason is wrong. Unassigned.
6. **Electron writes its Chromium profile into `KONDO_DATA_ROOT` before any
   kondo check.** [index.ts:40-45](../electron/main/index.ts) creates the
   directory and hands it to Electron as `userData` before the single-instance
   lock, while `claimDataRoot` runs only once the app is ready
   ([index.ts:220](../electron/main/index.ts)), so a root inside a Claude store
   takes profile files before the refusal can speak. A synchronous resolved
   check before the lock would close it. Unassigned.
7. **The reverse overlap direction is unchecked:** a Claude store whose
   resolved path sits inside `<kondo-data>` passes, because `overlapRefusal`
   ([scan.ts:109](../electron/main/workspace/scan.ts)) reads ADR-0001's sixth
   decision in one direction only, as the lexical tests always did. Unassigned.
8. **`PluginControl` lost its `busy` prop** with 110
   ([plugin-control.tsx:66](../src/features/projects/plugin-control.tsx)):
   `onChoose` and `onMove` stay wired but unreachable while settings writes are
   refused, and `git grep SETTINGS_WRITES_SUSPENDED` finds every place to
   revisit when they return. Unassigned.
9. **The smoke has no remount-a-section helper:** two cases inline the pair of
   `section` calls that reaches a screen the way a user would
   ([smoke.mjs:1546](../test/e2e/smoke.mjs), line 1578). Unassigned.

Leads the reviews raised already have entries and are not repeated above. From
batch 1: repository checks collecting `.claude/worktrees` (137);
`CLAUDE_CONFIG_DIR` set in a Claude settings env block (138); a legacy
`.config.json` registry in a configuration home (139); transcripts stored under
`CLAUDE_CODE_PROJECT_DIR_NAME` (140); a profile data root keyed by its resolved
path, and a refusal naming the store set (141), where `kondoDataRoot` is still
the raw `KONDO_DATA_ROOT`
([locator.ts:171](../electron/main/workspace/locator.ts)); the bundle inventory
diffed against the notice table in CI (142); MCP allowlists and URL or command
deny rules (143); `.mcp.json` reads measured on a large registry before the
release candidate (144); and an in-app Claude profile picker (145). From
batch 2: the run-kondo fixture location and screenshot traps recorded in the
skill (148), where [SKILL.md:112](../.claude/skills/run-kondo/SKILL.md) still
places the fixture under the OS temp root although a fixture there is withheld
as a throwaway run; a jig check that catches drifting `file:line` anchors in
this file (149); the seam-contract check reworded for amended ADRs (150); the
version-1 and `installed_plugins_v2.json` plugin files read as Claude Code does
(151); the managed plugin scope added to the capability matrix (152); the
plugin components kondo does not list (153); a non-object `enabledPlugins` root
and non-string legacy array members reported (154); raw filesystem exception
text kept out of `Scan.errors` (155); and the JetBrains MCP rule scoped to the
checkout WebStorm has open (156).

## Open questions

1. **Is the task workflow accepted?** Its Windows validation (`36d3de9`,
   2026-09-06) backs the published platform-coverage statement in README,
   [release.md](release.md) and `release.yml`, but no owner acceptance was
   recorded.
2. **Should ADR-0022's fixed-sentence rule cover the plugin manifest and the
   registry?** A non-ENOENT read failure of `installed_plugins.json` or
   `~/.claude.json` passes the exception into `Scan.errors`
   ([user-store.ts:571](../electron/main/workspace/user-store.ts), line 1946),
   and ADR-0022 names `~/.claude.json` as a credential holder. Tracked as 155.
3. **Is the second local smoke failure the 132 error?** Its output was not
   captured; the next failing run should keep the full log.
4. **README's releases link** (`../../releases`) resolves only on GitHub; the
   public repository's final URL depends on plan 111.
