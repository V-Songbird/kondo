# Plan: private security reporting and maintenance

Status: **awaiting acceptance**

Make the security policy match the repository's actual reporting and release
capabilities. The owner has approved the private email contact; the proposed
maintenance commitment and documentation are ready for owner review.

## Scope

- Verify repository identity, visibility, private vulnerability reporting,
  Actions permissions, releases, tags and branch-rule availability with
  authenticated read-only API requests and current GitHub documentation.
- Correct security reporting instructions and define a reviewable maintenance
  proposal without inventing a contact, release, response deadline or backport.
- Document release gates and how to recheck remote capabilities.

## Out of scope

No remote settings, purchases, visibility changes, tags, releases or reports.
No general audit or application privacy changes. No real-store access.

## Decisions

| Decision | Reason |
|---|---|
| Treat HTTP 404 as an unavailable answer, not proof that reporting is disabled | Repository access alone does not prove every endpoint's token permissions |
| Publish the owner-approved email with its evidence limit | The owner confirmed control and monitoring; delivery was not tested |
| Separate proposed support from current support | A source version does not establish a published, maintained release |
| Separate check results from enforcement | Green Actions checks do not prove branch protection exists |

## Seam changes

None. Documentation only; workflow permissions already use read-only defaults
and a job-scoped release publication grant.

## Verification

Run the authenticated repository, private-reporting and workflow-permissions
API reads; inspect tags, releases, branch protection, rulesets and check runs.
Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run guards` with owned
changes staged, and `git diff --check`. Report genuine skips and unavailable
remote evidence separately. Do not submit a vulnerability report as a probe.

## Done when

The policy names an owner-approved private channel with its verification limits,
the owner has reviewed the maintenance commitment, and documentation
clearly distinguishes configured checks from enforceable remote gates.

## Observed capabilities

Read-only verification on 2026-09-08 established the following. These are a
snapshot; recheck before publication or remote configuration changes.

| Surface | Observed result | Meaning / limit |
|---|---|---|
| Repository | `V-Songbird/kondo`, private, default branch `main`, caller `admin: true` | Identity and repository access verified; not proof of all endpoint permissions |
| Reporting status | HTTP 404 | No enabled/disabled status obtained; GitHub documents this feature for public repositories |
| Workflow defaults | `read`; PR-review approval `false` | Matches workflow defaults; the release publish job explicitly requests `contents: write` |
| Actions availability | Enabled; allowed actions `all`; SHA pinning not required | Actions are available; this is not required-check enforcement |
| Branch protection and rulesets | Both HTTP 403 with an upgrade-or-public visibility restriction | Availability blocked by the reported plan/visibility condition; no active rules inspected |
| Releases and tags | Both API lists empty; no local tags | Source 0.5.0 is not a published release |
| Hosted checks | Remote main `ea9929710f16fbeedf769c7c2888ae72ded3ed23`: six verify/smoke and three package checks succeeded; publish skipped | Evidence for that remote commit only, not this documentation branch or protection |
| Classic statuses | Zero statuses; combined state `pending` | Does not contradict successful Actions check runs |

Primary references: GitHub's
[private-reporting configuration](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository),
[branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
and [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

## Owner-approved contact and pending review

The owner supplied [songbird@tuta.com](mailto:songbird@tuta.com) in response to
the request for a private contact they control, monitor and authorize publishing.
That declaration on 2026-09-08 is the evidence for control and monitoring.
SECURITY.md now directs private reports there; the issue chooser links to that
policy. No test email was sent or authorized, and independent receipt remains
unverified. The previous missing-contact decision is resolved.

The owner still reviews the latest-published-stable-only maintenance proposal
in `docs/release.md` and the documentation package. No SLA or backport commitment
is inferred. Manual review and the remote enforcement limitation remain explicit;
a compatible plan or remote protection configuration requires separate approval.
Changing repository visibility is a separate decision.

No remote configuration was changed and no report or test message was sent.

## Local verification

On Windows with Node 22.22.2 and npm 12.0.2:

- `npm ci` completed from the lockfile; audit reported zero vulnerabilities.
  npm reported blocked install scripts for two esbuild versions and
  electron-winstaller. No approval settings were changed; the required checks
  below still ran. This is not packaging evidence.
- `npm test`: 41 files passed, 645 tests passed and 14 skipped. The skips are
  existing Windows file-symlink fixture limitations (13 boundary tests and one
  mutation test); this run does not establish those file-symlink behaviors.
- `npm run typecheck` and `npm run lint`: passed.
- `npm run guards` with all five documentation/configuration changes staged:
  no findings. `git diff --check` and `git diff --cached --check`: passed.
- Reviewed the issue chooser's policy target and the documentation links.
  Existing CI/release workflow grants match the documented permissions; no
  workflow implementation changed.

No Electron smoke or new hosted run was launched for this documentation-only
change. The historical remote check results above do not validate this branch.
Private report receipt and remote enforcement remain unverified for the reasons
recorded above.
