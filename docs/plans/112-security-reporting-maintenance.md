# Plan: private security reporting and maintenance

Status: **in progress — owner decisions pending**

Make the security policy match the repository's actual reporting and release
capabilities. A working private contact and the maintenance commitment need
owner approval before this task can be completed.

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
| Require an approved, verified private contact | A Git author email is not authorization to publish a security inbox |
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

The policy names an approved private channel whose availability has been
verified, the owner has chosen the maintenance commitment, and documentation
clearly distinguishes configured checks from enforceable remote gates.
