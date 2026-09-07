# Plan: Public repository contribution and reporting surface

Status: **done — shipped in 08a401d**

Prepare package identity, contributor guidance and privacy-conscious reporting
for the configured V-Songbird/kondo repository (Foreman 096).

## Scope

Package repository/bugs/homepage metadata; conduct guidance; bug and feature
issue forms; guard activation instructions; truthful security reporting and
supported-version guidance; documentation map and plan index.

## Out of scope

Application code, packaging behavior, GitHub settings, publishing and real stores.

## Decisions

| Decision | Rationale |
|---|---|
| Retain private:true | Repository links do not authorize npm publication. |
| Ask for synthetic reproductions, never private store contents | Reports are public and stores contain sensitive data. |
| Preserve the private advisory route without promising availability or response time | Existing policy names that route; hosted availability is not verified. |
| State that no supported release range is declared | Local tags are empty; package version alone is not release evidence. Owner must define support and conduct contact. |

## Seam changes

None.

## Verification checklist

- [x] npm run guards passes (paired staged-change checks may skip before staging).
- [x] npm test passes using fixtures only.
- [x] npm run typecheck passes.
- [x] npm run lint passes.
- [x] git diff --check passes; manually review GitHub form syntax, privacy,
      local links and package URLs against origin.

## Done when

Contributors can find expectations and required checks; reporters get safe
prompts and private vulnerability guidance without invented support commitments.
Owner decisions and hosted validation limits are explicit at handoff.

## Observed verification

Guards, typecheck, lint and whitespace checks passed. Vitest passed 533 tests
in 38 files; five symlink cases skipped because Windows fixture link creation
returned EPERM. Local Markdown file targets resolve and package URLs match origin;
private:true and packaging settings are unchanged.

Issue forms were manually reviewed against GitHub's issue-form and form-schema
documentation (name/description/body, unique IDs, typed attributes, boolean
validations, distinct dropdown options and checkbox required flags), and the
chooser config against its documented contact_links structure. No repository
schema validator was found or added. Live GitHub rendering was not exercised.

Owner decisions remain: designate a private conduct contact and escalation
route, confirm private vulnerability reporting or provide a fallback, and declare
a supported release range. Local tags are empty; hosted releases and reporting
availability could not be verified. No publication or settings change was made.

Accepted by the owner on 2026-09-07 for local integration into main.
