---
name: kondo-github-remote
description: "kondo's GitHub repo, why it has no branch protection, and why /jig:review lies about CI"
metadata:
  type: project
---

kondo lives at https://github.com/V-Songbird/kondo, **private**, created
2026-08-29. The owner intends MIT open-source eventually (see
[[kondo-scaffold]]) but decided on 2026-08-29 that it stays private for now.

**Branch protection is impossible and should not be retried.** Both the
classic `branches/main/protection` API and the newer `rulesets` API return
403 "Upgrade to GitHub Pro or make this repository public" — the account is
on the Free plan and the repo is private. Nothing is protecting `main` on
the server; the local `.jig/hooks/pre-commit` lane is the only blocking gate.
If the repo ever goes public or the plan changes, the status check contexts
to require are `verify (ubuntu-latest)`, `verify (windows-latest)` and
`verify (macos-latest)`.

**`/jig:review` reports `lanes.ci.runs: false`, and that is wrong.** It only
means jig owns no workflow file of its own. CI does run the guards:
`.github/workflows/ci.yml` is a single three-OS matrix that runs
`npm run typecheck`, `npm test`, `npm run lint`, then `node .jig/checks/run.mjs`
and `node .jig/checks/run.mjs --selftest`. Do not "fix" the reported gap by
generating `.github/workflows/jig.yml` — that was tried on 2026-08-29 and
removed as a duplicate.

Dependabot is on: `.github/dependabot.yml` watches npm and github-actions
weekly, and vulnerability alerts plus automated security fixes are enabled.
