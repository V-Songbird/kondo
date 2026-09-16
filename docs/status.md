# Status

Where work stands, for a session that starts without context. Written
2026-09-16; Git is the authority, so check `git log`, `git branch -a` and
`git worktree list` before relying on the tables below.

## Main today

`main` is `3e56ba8`. Five entries landed on 2026-09-15 and 2026-09-16, each
squash-merged with `--match-head-commit` and a Foreman trailer. Every run named
below covered Windows, macOS and Linux:

| Entry | Subject | PR | Merge | Hosted CI |
|---|---|---|---|---|
| 146 | Reconcile the status document and the roadmap after batch 1 | #24 | `0d238bf` | PR run 35036503022 green on attempt 2; `main` run 35037504008 failed — both exceptions below |
| 135 | Distinguish an unreadable MCP project path from a gone one | #25 | `cad3cc3` | PR run 35037702505 and `main` run 35037869224, green first attempt |
| 129 | Keep non-boolean `enabledPlugins` values from reading as a plugin state | #26 | `269bdc1` | PR run 35038047422 and `main` run 35038315364, green first attempt |
| 105 | Include all companion files in cleanup size estimates | #27 | `c704b30` | PR run 35046964362 and `main` run 35047126954, green first attempt |
| 106 | Inventory every plugin installation and component layout | #28 | `3e56ba8` | PR run 35047628542 and `main` run 35047771519, green first attempt |

- The first exception: 146's attempt 1 never started, because GitHub Actions
  refused the jobs with a billing block. The owner made the repository public
  on 2026-09-15 and the rerun was green.
- The second: the push run on `main` for `0d238bf` failed only `verify` on
  `windows-latest`, with one vitest timeout of 5000 ms in
  [tidy.test.ts](../test/tidy.test.ts) — the case "never offers a project that
  holds only memory/, on disk or unlocated (entry 058)" — on a docs-only
  commit. Every later `main` run was green.
- Decisions the batch touched: [ADR-0021](adr/0021-summarize-settings-files.md)
  and [ADR-0015](adr/0015-bind-removal-to-reviewed-state.md) amended by 129 and
  105, [ADR-0023](adr/0023-a-plugin-is-its-installations.md) added by 106.
- Local checks, reported by each worker from its own worktree through fnm
  Node 22. On 106's merged tree, which was the last: `npm test` passed 821 and
  skipped 14 because the host cannot create file symlinks; `npm run typecheck`,
  `npm run lint`, `npm run guards` and `npm run build` were clean. 105 and 106
  each drove the built app with `.claude/skills/run-kondo/` against a synthetic
  fixture outside the OS temp root. Nobody ran `npm run test:e2e` locally in
  this batch; hosted CI ran the smoke on every pull request.
- Version 0.5.0, pre-release. There are no releases or tags, and the repository
  has been public since 2026-09-15.
- What the app does is in [README.md](../README.md#what-it-does). Refused or
  read-only by decision: settings changes
  ([ADR-0010](adr/0010-splice-config-files-never-whole-file-writes.md)), hook
  declarations ([ADR-0017](adr/0017-hook-layer-boundary.md)) and Desktop
  sessions ([ADR-0016](adr/0016-desktop-session-boundary.md)).

## Work in progress

No pull requests are open and `origin` holds only `main`.

Entry 132 is in progress: its [plan](plans/132-sandbox-preload-startup.md) is
written and no experiment has run. A hosted Linux case on 2026-09-15 showed the
failure is not Windows-only.

Batch 3 is in flight on worktree branches, both cut from `3e56ba8`:

| Entry | Branch |
|---|---|
| 123 | `worktree-123-personal-context` |
| 147 | `worktree-147-status-after-batch-2` |

## Next steps

1. Land batch 3: 123 and 147.
2. Then 110, 115, 124, 125, 126, 127, 134, 137 to 144 and 148 to 156.
3. Then 132 and 120, both of which need a quiet machine.
4. Finally 114.

## Open findings

Code that contradicts a decision in force or its own documentation. Each needs
an owner decision or a roadmap entry.

1. **Settings controls look available and are refused only after a click.** The
   capability matrix allows skill and plugin toggles and plugin moves, so the
   renderer shows them enabled without refusal text — for example a plugin
   control's `Writes <path>` tooltip
   ([plugin-control.tsx:107](../src/features/projects/plugin-control.tsx)) and
   Settings leftovers' "Remove selected settings"
   ([orphans.tsx:192](../src/features/orphans/orphans.tsx)) — and the mutation
   layer then refuses
   ([mutations.ts:390](../electron/main/workspace/mutations.ts)). MCP is
   settled: 103 removed the switch control and left a sentence pointing at
   Claude Code's own `/mcp` panel
   ([projects.tsx:735](../src/features/projects/projects.tsx)). ADR-0010 holds
   for the rest; the UI does not say so up front. Possibly part of 110.
2. **Hook-script cleanup copy says scripts "nothing runs"**
   ([tidy.tsx:87](../src/features/tidy/tidy.tsx) and the journal summary in
   [tidy.ts:563](../electron/main/workspace/tidy.ts)), while the category
   retains every script because Kondo cannot establish disuse (ADR-0002).
   Assigned to 110.
3. **History's empty state** says "After you move, disable or remove something"
   ([journal.tsx:225](../src/features/journal/journal.tsx)) while disabling is
   refused. Unassigned; 110 is the likely home.
4. **`<kondo-data>` inside a Claude store is not refused.** The locator accepts
   any `KONDO_DATA_ROOT`
   ([locator.ts:222](../electron/main/workspace/locator.ts)), although ADR-0001
   and foundations.md state the rule. Tracked as 115.
5. **Stale code comments** describe superseded behaviour: `skills.disabled/` as
   Claude's convention ([kinds.ts:358](../electron/main/workspace/kinds.ts));
   `enable`/`disable` seats instead of one `plan` seat
   ([capabilities.ts:15](../electron/main/workspace/capabilities.ts)); a hook
   move with the user-facing "edit both files by hand for now"
   ([capabilities.ts:90](../electron/main/workspace/capabilities.ts)); hook
   scripts offered for cleanup ([contract.ts:1159](../shared/contract.ts));
   and plugin clearing and leftover removal as working edits
   ([contract.ts:1590](../shared/contract.ts), line 1677); and a settings file
   "created only then"
   ([projects.tsx:1222](../src/features/projects/projects.tsx)). 103 removed
   the MCP read-only comments and the "entry 031 will remove" note; 106 removed
   the single-installed-version comment, because `PluginInfo` now carries every
   installation ([contract.ts:663](../shared/contract.ts)). Unassigned.
6. **Read-only tooling out of step with the docs:** `.jig/hooks/pre-commit` is
   mode 100644, so Unix Git skips it while `.jig/activation.md` says every
   commit runs the checks (126); `.claude/settings.json` registers the session
   shim on `PostToolUse` while the guards run on `PreToolUse` (125);
   [test-touches-a-real-store.check.mjs:4](../.jig/checks/test-touches-a-real-store.check.mjs)
   still calls the suite read-only (134);
   [seam-contract-outruns-its-adr.check.mjs:20](../.jig/checks/seam-contract-outruns-its-adr.check.mjs)
   asks for "a new ADR superseding" the old one, which the ADR policy no longer
   uses (150); [SKILL.md:112](../.claude/skills/run-kondo/SKILL.md) and line 228
   cite entries 060 and 124; [smoke.mjs:503](../test/e2e/smoke.mjs) and line 515
   title the user scope "Global"; the PR template and CONTRIBUTING's checklist
   have diverged; and [release.yml:159](../.github/workflows/release.yml) keeps
   a history comment.
7. **Guards match fewer forms than the decisions they protect:** side-effect and
   dynamic imports pass `renderer-reaches-past-the-bridge`, and a parameter
   named `path` passes `raw-path-across-the-seam`
   ([testing.md](testing.md#the-guards)). No current code violates either
   decision.
8. **Hosted `verify` on `windows-latest` timed out once** on a 5000 ms vitest
   case in [tidy.test.ts](../test/tidy.test.ts), on a docs-only commit (run
   35037504008) — the same kind of timeout workers see locally under load.
   Unassigned.

Leads the reviews raised already have entries and are not repeated above. From
batch 1: repository checks collecting `.claude/worktrees` (137);
`CLAUDE_CONFIG_DIR` set in a Claude settings env block (138); a legacy
`.config.json` registry in a configuration home (139); transcripts stored under
`CLAUDE_CODE_PROJECT_DIR_NAME` (140); a profile data root keyed by its resolved
path, and a refusal naming the store set (141); the bundle inventory diffed
against the notice table in CI (142); MCP allowlists and URL or command deny
rules (143); `.mcp.json` reads measured on a large registry before the release
candidate (144); and an in-app Claude profile picker (145). From batch 2: the
run-kondo fixture location and screenshot traps recorded in the skill (148); a
jig check that catches drifting `file:line` anchors in this file (149); the
seam-contract check reworded for amended ADRs (150); the version-1 and
`installed_plugins_v2.json` plugin files read as Claude Code does (151); the
managed plugin scope added to the capability matrix (152); the plugin
components kondo does not list (153); a non-object `enabledPlugins` root and
non-string legacy array members reported (154); raw filesystem exception text
kept out of `Scan.errors` (155); and the JetBrains MCP rule scoped to the
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
3. **Which words should Library use?** The glossary's targets "Where it
   applies" and "All projects" differ from Library's `Scope`, `Location` and
   `Global`, and body copy says "response styles" where titles say "Output
   styles"; entry 110 may settle both.
4. **Is the second local smoke failure the 132 error?** Its output was not
   captured; the next failing run should keep the full log.
5. **README's releases link** (`../../releases`) resolves only on GitHub; the
   public repository's final URL depends on plan 111.
