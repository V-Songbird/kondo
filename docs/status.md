# Status

Where work stands, for a session that starts without context. Written
2026-09-15; Git is the authority, so check `git log`, `git branch -a` and
`git worktree list` before relying on the tables below.

## Main today

- The code on `main` is unchanged since `b25df65`; later commits change only
  documentation. Hosted CI run 34977725352 passed `verify` and `smoke` on
  Windows, macOS and Linux for `b25df65`.
- Local checks on `b25df65`, Windows, 2026-09-15: `npm run guards` reported no
  findings (its two paired-change checks skip when nothing is staged);
  `npm run typecheck`, `npm run lint` and `npm run build` passed; `npm test`
  passed 731 tests in 42 files, with 14 skipped because the host cannot create
  file symlinks. `npm run test:e2e` failed 10 of 28 twice — the first time with
  the sandboxed-preload startup error (132) while other processes loaded the
  machine, the second time with a cause that was not captured — and then passed
  with no failures (27 passed). `npm run dev` was not run.
- Version 0.5.0, pre-release. There are no releases or tags, and the repository
  is private.
- What the app does is in [README.md](../README.md#what-it-does). Refused or
  read-only by decision: settings changes
  ([ADR-0010](adr/0010-splice-config-files-never-whole-file-writes.md)), hook
  declarations ([ADR-0017](adr/0017-hook-layer-boundary.md)) and Desktop
  sessions ([ADR-0016](adr/0016-desktop-session-boundary.md)).

## Work in progress

No pull requests or issues are open, and `origin` holds only `main`.

| Branch | Where | State |
|---|---|---|
| `claude/131-plugin-key-diagnostics` | worktree `../kondo-worktrees/131-plugin-key-diagnostics` | Entry 131. No commits of its own; based on `a48ccdf`, one commit behind `main`. The worktree holds an uncommitted fix in `electron/main/workspace/user-store.ts` and an untracked plan, `docs/plans/131-plugin-key-diagnostics.md`. The test in `test/user-store.test.ts`, the `docs/domain.md` line and the checks are still missing. |
| `claude/132-sandbox-preload-startup` | worktree `../kondo-worktrees/132-sandbox-preload-startup` | Entry 132. One commit, `261fd51`, adding `docs/plans/132-sandbox-preload-startup.md` and its index row; based on `a48ccdf`. No experiment results yet. |

Both task branches predate the current plan index, so their
`docs/plans/README.md` rows need re-adding when they rebase.

## Next steps

1. Finish 131 in its worktree: rebase onto `main`, add the test and the
   `docs/domain.md` line, run guards, tests, typecheck and lint.
2. Run 132's experiments from its plan.
3. Then the open work under "Now" in [ROADMAP.md](../ROADMAP.md), in dependency
   order: 103, 104 and 105 first, 110 once its inputs are settled, and 114
   last.

## Open findings

Code that contradicts a decision in force or its own documentation. The
reconciliation changed no code; each needs an owner decision or a roadmap
entry.

1. **Settings controls look available and are refused only after a click.** The
   capability matrix allows skill, plugin and MCP toggles and plugin moves, so
   the renderer shows them enabled without refusal text — for example a plugin
   control's `Writes <path>` tooltip
   ([plugin-control.tsx:106](../src/features/projects/plugin-control.tsx)) and
   Settings leftovers' "Remove selected settings"
   ([orphans.tsx:192](../src/features/orphans/orphans.tsx)) — and the mutation
   layer then refuses
   ([mutations.ts:1119](../electron/main/workspace/mutations.ts)). ADR-0010
   holds; the UI does not say so up front. Possibly part of 110.
2. **Hook-script cleanup copy says scripts "nothing runs"**
   ([tidy.tsx:87](../src/features/tidy/tidy.tsx), line 115, and the journal
   summary in [tidy.ts:563](../electron/main/workspace/tidy.ts)), while the
   category retains every script because Kondo cannot establish disuse
   (ADR-0002). Assigned to 110.
3. **History's empty state** says "After you move, disable or remove something"
   ([journal.tsx:225](../src/features/journal/journal.tsx)) while disabling is
   refused.
4. **An unreadable local MCP project path reads as gone.** Any stat failure
   sets `orphan: true`
   ([user-store.ts:1186](../electron/main/workspace/user-store.ts)), so the
   toggle is refused as "gone; Leftovers removes the whole entry"
   ([capabilities.ts:115](../electron/main/workspace/capabilities.ts)), while
   Leftovers requires ENOENT and never offers it — against ADR-0005 and
   ADR-0009. Tracked as 135.
5. **`<kondo-data>` inside a Claude store is not refused.** The locator accepts
   any `KONDO_DATA_ROOT`
   ([locator.ts:72](../electron/main/workspace/locator.ts)), although ADR-0001
   and foundations.md state the rule. Tracked as 115.
6. **Stale code comments** describe superseded behaviour: MCP and placed kinds
   as read-only ([contract.ts:82](../shared/contract.ts),
   [kinds.ts:780](../electron/main/workspace/kinds.ts),
   [capabilities.ts:208](../electron/main/workspace/capabilities.ts));
   `skills.disabled/` as Claude's convention
   ([kinds.ts:307](../electron/main/workspace/kinds.ts)) and as what the
   toggle writes ([capabilities.ts:259](../electron/main/workspace/capabilities.ts));
   `enable`/`disable` seats instead of one `plan` seat
   ([capabilities.ts:15](../electron/main/workspace/capabilities.ts)); a hook
   move "when the plan lands", with the user-facing "edit both files by hand
   for now" ([capabilities.ts:74](../electron/main/workspace/capabilities.ts));
   a single installed plugin version and hook scripts offered for cleanup
   ([contract.ts:943](../shared/contract.ts)); plugin toggle, clear, move and
   leftover removal as working edits ([contract.ts:1316](../shared/contract.ts),
   [contract.ts:1419](../shared/contract.ts)); "entry 031 will remove"
   ([user-store.ts:1138](../electron/main/workspace/user-store.ts)); and a
   settings file "created only then"
   ([projects.tsx:1174](../src/features/projects/projects.tsx)).
7. **Read-only tooling out of step with the docs:** `.jig/hooks/pre-commit` is
   mode 100644, so Unix Git skips it while `.jig/activation.md` says every
   commit runs the checks (126); `.claude/settings.json` registers the session
   shim on `PostToolUse` while the guards run on `PreToolUse` (125);
   [test-touches-a-real-store.check.mjs:4](../.jig/checks/test-touches-a-real-store.check.mjs)
   still calls the suite read-only;
   [seam-contract-outruns-its-adr.check.mjs:20](../.jig/checks/seam-contract-outruns-its-adr.check.mjs)
   asks for "a new ADR superseding" the old one, which the ADR policy no longer
   uses; [SKILL.md:54](../.claude/skills/run-kondo/SKILL.md) says
   `createLocator` alone reads the three overrides (the entry point also reads
   `KONDO_DATA_ROOT`) and lines 108 and 224 cite entries 060 and 124;
   [smoke.mjs:503](../test/e2e/smoke.mjs) and line 515 title the user scope
   "Global"; the PR template and CONTRIBUTING's checklist have diverged; and
   [release.yml:126](../.github/workflows/release.yml) keeps a history comment.
8. **Guards match fewer forms than the decisions they protect:** side-effect and
   dynamic imports pass `renderer-reaches-past-the-bridge`, and a parameter
   named `path` passes `raw-path-across-the-seam`
   ([testing.md](testing.md#the-guards)). No current code violates either
   decision.

## Open questions

1. **Is the task workflow accepted?** Its Windows validation (`36d3de9`,
   2026-09-06) backs the published platform-coverage statement in README,
   [release.md](release.md) and `release.yml`, but no owner acceptance was
   recorded.
2. **Should ADR-0022's fixed-sentence rule cover the plugin manifest and the
   registry?** A non-ENOENT read failure of `installed_plugins.json` or
   `~/.claude.json` passes the exception into `Scan.errors`
   ([user-store.ts:491](../electron/main/workspace/user-store.ts), line 1437),
   and ADR-0022 names `~/.claude.json` as a credential holder.
3. **Does Claude keep a user-level `settings.local.json`?** Kondo reads none
   ([user-store.ts:205](../electron/main/workspace/user-store.ts)), so a global
   `/skills` toggle written there would be invisible.
4. **Which words should Library use?** The glossary's targets "Where it
   applies" and "All projects" differ from Library's `Scope`, `Location` and
   `Global`, and body copy says "response styles" where titles say "Output
   styles"; entry 110 may settle both.
5. **Is the second local smoke failure the 132 error?** Its output was not
   captured; the next failing run should keep the full log.
6. **README's releases link** (`../../releases`) resolves only on GitHub; the
   public repository's final URL depends on plan 111.
