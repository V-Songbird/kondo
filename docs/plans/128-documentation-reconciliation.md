# Plan: documentation and Foreman reconciliation

Status: **awaiting owner acceptance** — uncommitted on
`claude/128-documentation-reconciliation`, based on `638dec7`

A reconciliation pass on 2026-09-14 and 2026-09-15 compared every tracked
document and the local Foreman records with the code at `638dec7`. Several
documents still described earlier behavior — a Projects-first navigation, an
effective-settings viewer, guards held in observe mode, release work that has
since shipped — and would mislead the next change. The owner asked to reconcile
all documentation before development continues, leaving in-app wording to
entry 110.

## Scope

- Public and contributor documents: README, ROADMAP, the CHANGELOG
  `[Unreleased]` structure, AGENTS, CLAUDE, CONTRIBUTING, the pull request
  template and the documentation map.
- Architecture, testing and store facts: `docs/foundations.md`,
  `docs/testing.md`, `docs/glossary.md` and stale statements in
  `docs/domain.md`.
- Decision records: a public ADR for the accepted settings-scope decision 107,
  and plan and index statuses matched to recorded acceptance.
- The run-kondo guide's navigation, feature and label descriptions, and a
  shutdown instruction that no longer stops unrelated Electron apps.
- Foreman, which is local and not in Git: a survey of the 15 open entries with
  owner-approved corrections, and retirement of recorded lessons the code
  contradicts.

## Out of scope

- Application code, code comments and in-app wording (entry 110). Stale seam
  comments in `shared/contract.ts` — the `mcp` and placed-kind notes on
  `EntityKind` — are left for the next change that touches that file.
- The owned-process shutdown helper for run-kondo (124), personal context in
  `docs/domain.md` and a test fixture (123), and every behavior change the
  survey re-described (103–106, 115, 117, 119, 120, 125–127).
- Committing, pushing or integrating: the owner accepts the result first.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Record decision 107 as ADR-0021 | Accepted decisions carry a public record; 108 and 109 already do. |
| 2 | Mark a plan done only with recorded acceptance or shipped evidence | A status line is evidence. The UX workflow plan says shipped without claiming acceptance, because none is recorded. |
| 3 | Describe configured CI as configured and date the last hosted run | A job definition is not evidence for later commits. |
| 4 | Replace the guide's `taskkill //IM electron.exe` with stopping the launched command | The old instruction also closes unrelated Electron apps; 124 still owns a verified helper. |
| 5 | Keep entry numbers only with enough context to read without the local queue | ADR-0013. |

## Seam changes

None.

## Verification

Run on 2026-09-15 against the uncommitted branch:

- [x] Markdown link, anchor and backticked-path check over tracked Markdown:
  5 unresolved references, all present before this pass (a GitHub-relative
  releases link, two Claude store paths and two line-range citations); none
  new.
- [x] `npm run guards` with all 26 changed files staged: no findings; the
  index was reset afterwards. `git diff --check`: clean.
- [x] `npm test` (42 files, 730 passed, 14 skipped where file symlinks are
  unavailable), `npm run build` including `tsc -b`, and `npm run lint` pass
  with no code changes.
- [x] The rewritten run-kondo guide ran end to end on a fresh fixture: the
  staged skill move and its Undo, the plugin create-file question and the
  settings refusal, project plugin labels, Other tools, a Clean up review and
  trash, Duplicate skills verdicts, bridge reads and the `Browser.close`
  shutdown.
- [x] Foreman `doctor` reports the same 2 errors and 13 warnings as before the
  pass — Codex-era model and source values on 115–127 and an unknown
  `fableEnabled` setting — and nothing new.

## What actually shipped

- Decision 4 went one step further: the guide closes the app with CDP
  `Browser.close` through the shared `cdp.mjs` client, as
  `test/e2e/process.mjs` does, and launches Electron with
  `node node_modules/electron/cli.js`, because `fnm exec` cannot start the
  `.bin` shim on Windows. No script changed; 124 still owns a helper.
- Plans 112 and 121 also had their status lines matched to recorded
  acceptance.

## Done when

A new session can read the documentation map, AGENTS and CLAUDE, the roadmap
and the plans index and learn what ships today, what is suspended, what is open
and how to verify a change, without meeting a claim the code contradicts.
