# Status

Where work stands, for a session that starts without context. Written
2026-09-15; Git is the authority, so check `git log`, `git branch -a` and
`git worktree list` before relying on the tables below.

## Main today

`main` is `3856bee`. Four entries landed on 2026-09-15, each squash-merged with
`--match-head-commit` and a Foreman trailer:

| Entry | Subject | PR | Merge | Hosted CI |
|---|---|---|---|---|
| 119 | Require release tags to reference the reviewed main candidate | #20 | `7428a89` | run 35030534552, green on Windows, macOS and Linux, first attempt |
| 133 | Bundle complete third-party notices and verify them when packaging | #21 | `8e8a9b8` | run 35032881820, see the exception below |
| 104 | Discover and select alternate Claude configuration profiles | #22 | `50e8c4e` | run 35033552504, green first attempt |
| 103 | Read and toggle MCP approval and disable scopes faithfully | #23 | `3856bee` | run 35034362175, green first attempt |

- The one exception: 133's attempt 1 failed only `smoke` on `macos-latest`,
  test 14, in the `leaks()` helper. Attempt 2, a rerun of the failed job
  approved by the owner, was green, and the squash body states the exception.
- Local checks, reported by each worker from its own worktree through fnm
  Node 22. On 103's merged tree, which was the last: `npm test` passed 783 and
  skipped 14 because the host cannot create file symlinks; `npm run typecheck`,
  `npm run lint`, `npm run guards` and `npm run build` were clean. 104 ran
  `npm run test:e2e` locally with 25 passed and 2 failed on the Library focus
  waits under load (tests 9 and 14); a targeted rerun passed both, recorded on
  entry 120. The smoke and the build were not run locally on the final `main`
  tip; hosted CI ran both.
- Version 0.5.0, pre-release. There are no releases or tags, and the repository
  is private.
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

Batch 2 is in flight on worktree branches, all cut from `3856bee`:

| Entry | Branch |
|---|---|
| 135 | `worktree-135-unreadable-mcp-paths` |
| 129 | `worktree-129-non-boolean-enabled-plugins` |
| 106 | `worktree-106-plugin-installation-inventory` |
| 105 | `worktree-105-companion-file-sizes` |
| 146 | `worktree-146-status-after-batch-1` |

## Next steps

1. Land batch 2: 135, 129, 106 and 105.
2. Then 110, which waits on 105.
3. Then 115, 123, 124, 125, 126, 127, 134 and 137 to 144.
4. Then 132 and 120, both of which need a quiet machine.
5. Finally 114.

## Open findings

Code that contradicts a decision in force or its own documentation. Each needs
an owner decision or a roadmap entry.

1. **Settings controls look available and are refused only after a click.** The
   capability matrix allows skill and plugin toggles and plugin moves, so the
   renderer shows them enabled without refusal text — for example a plugin
   control's `Writes <path>` tooltip
   ([plugin-control.tsx:106](../src/features/projects/plugin-control.tsx)) and
   Settings leftovers' "Remove selected settings"
   ([orphans.tsx:192](../src/features/orphans/orphans.tsx)) — and the mutation
   layer then refuses
   ([mutations.ts:390](../electron/main/workspace/mutations.ts)). MCP is
   settled: 103 removed the switch control and left a sentence pointing at
   Claude Code's own `/mcp` panel
   ([projects.tsx:730](../src/features/projects/projects.tsx)). ADR-0010 holds
   for the rest; the UI does not say so up front. Possibly part of 110.
2. **Hook-script cleanup copy says scripts "nothing runs"**
   ([tidy.tsx:87](../src/features/tidy/tidy.tsx) and the journal summary in
   [tidy.ts:563](../electron/main/workspace/tidy.ts)), while the category
   retains every script because Kondo cannot establish disuse (ADR-0002).
   Assigned to 110.
3. **History's empty state** says "After you move, disable or remove something"
   ([journal.tsx:225](../src/features/journal/journal.tsx)) while disabling is
   refused. Unassigned; 110 is the likely home.
4. **An unreadable local MCP project path reads as gone.** Any stat failure
   sets `orphan`
   ([user-store.ts:1458](../electron/main/workspace/user-store.ts)), so the
   toggle is refused as "gone; Leftovers removes the whole entry"
   ([capabilities.ts:120](../electron/main/workspace/capabilities.ts)), while
   Leftovers requires ENOENT and never offers it — against ADR-0005 and
   ADR-0009. Tracked as 135.
5. **`<kondo-data>` inside a Claude store is not refused.** The locator accepts
   any `KONDO_DATA_ROOT`
   ([locator.ts:222](../electron/main/workspace/locator.ts)), although ADR-0001
   and foundations.md state the rule. Tracked as 115.
6. **Stale code comments** describe superseded behaviour: `skills.disabled/` as
   Claude's convention ([kinds.ts:350](../electron/main/workspace/kinds.ts));
   `enable`/`disable` seats instead of one `plan` seat
   ([capabilities.ts:15](../electron/main/workspace/capabilities.ts)); a hook
   move with the user-facing "edit both files by hand for now"
   ([capabilities.ts:90](../electron/main/workspace/capabilities.ts)); a single
   installed plugin version ([contract.ts:587](../shared/contract.ts)) and hook
   scripts offered for cleanup ([contract.ts:1055](../shared/contract.ts));
   plugin clearing and leftover removal as working edits
   ([contract.ts:1443](../shared/contract.ts)); and a settings file "created
   only then" ([projects.tsx:1217](../src/features/projects/projects.tsx)).
   103 removed the MCP read-only comments and the "entry 031 will remove" note.
   Unassigned.
7. **Read-only tooling out of step with the docs:** `.jig/hooks/pre-commit` is
   mode 100644, so Unix Git skips it while `.jig/activation.md` says every
   commit runs the checks (126); `.claude/settings.json` registers the session
   shim on `PostToolUse` while the guards run on `PreToolUse` (125);
   [test-touches-a-real-store.check.mjs:4](../.jig/checks/test-touches-a-real-store.check.mjs)
   still calls the suite read-only;
   [seam-contract-outruns-its-adr.check.mjs:20](../.jig/checks/seam-contract-outruns-its-adr.check.mjs)
   asks for "a new ADR superseding" the old one, which the ADR policy no longer
   uses; [SKILL.md:111](../.claude/skills/run-kondo/SKILL.md) and line 227 cite
   entries 060 and 124; [smoke.mjs:503](../test/e2e/smoke.mjs) and line 515
   title the user scope "Global"; the PR template and CONTRIBUTING's checklist
   have diverged; and [release.yml:159](../.github/workflows/release.yml) keeps
   a history comment. 104 fixed the `createLocator` sentence this list used to
   name.
8. **Guards match fewer forms than the decisions they protect:** side-effect and
   dynamic imports pass `renderer-reaches-past-the-bridge`, and a parameter
   named `path` passes `raw-path-across-the-seam`
   ([testing.md](testing.md#the-guards)). No current code violates either
   decision.

Leads the batch-1 reviews raised already have entries and are not repeated
above: repository checks collecting `.claude/worktrees` (137); `CLAUDE_CONFIG_DIR`
set in a Claude settings env block (138); a legacy `.config.json` registry in a
configuration home (139); transcripts stored under `CLAUDE_CODE_PROJECT_DIR_NAME`
(140); a profile data root keyed by its resolved path, and a refusal naming the
store set (141); the bundle inventory diffed against the notice table in CI
(142); MCP allowlists and URL or command deny rules (143); `.mcp.json` reads
measured on a large registry before the release candidate (144); and an in-app
Claude profile picker (145).

## Open questions

1. **Is the task workflow accepted?** Its Windows validation (`36d3de9`,
   2026-09-06) backs the published platform-coverage statement in README,
   [release.md](release.md) and `release.yml`, but no owner acceptance was
   recorded.
2. **Should ADR-0022's fixed-sentence rule cover the plugin manifest and the
   registry?** A non-ENOENT read failure of `installed_plugins.json` or
   `~/.claude.json` passes the exception into `Scan.errors`
   ([user-store.ts:494](../electron/main/workspace/user-store.ts), line 1349),
   and ADR-0022 names `~/.claude.json` as a credential holder.
3. **Which words should Library use?** The glossary's targets "Where it
   applies" and "All projects" differ from Library's `Scope`, `Location` and
   `Global`, and body copy says "response styles" where titles say "Output
   styles"; entry 110 may settle both.
4. **Is the second local smoke failure the 132 error?** Its output was not
   captured; the next failing run should keep the full log.
5. **README's releases link** (`../../releases`) resolves only on GitHub; the
   public repository's final URL depends on plan 111.
