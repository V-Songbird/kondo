# Plan: release tag provenance

Status: **in progress**

`release.yml` says a tag `v<version>` on main produces the draft release, but it
runs for any pushed `v*` tag and checks only that the tag names the
`package.json` version. A tag on a side branch, or on a main commit that is no
longer the reviewed candidate, can build installers and a draft outside the
procedure in [release.md](../release.md). A `workflow_dispatch` rehearsal
started on a tag ref also has `github.ref_type == 'tag'`, so today it reaches
the `publish` job and can create a draft. This plan binds the tag to main's
reviewed candidate before anything is packaged and keeps every rehearsal free of
publication.

## The relationship release.md defines

1. The candidate is prepared on `main`: the version bump and CHANGELOG section
   are committed there (step 1).
2. Hosted `verify` and `smoke` pass on that exact commit and the owner approves
   that exact SHA (step 2, the public-history gate and CONTRIBUTING's merge
   checks).
3. The rehearsal runs against `main` (step 3).
4. The tag is created on that commit and pushed (step 4).

Steps 2 and 3 review main's tip, so the reviewed candidate is the commit at the
tip of `main` when the tag is pushed. A tag is inside the contract only when it
points at that commit.

## Scope

- `scripts/verify-release-provenance.mjs`, a standard-library Node script run
  in the repository checkout:
  - Fetches `refs/heads/main` and, on a tag push, the pushed tag from `origin`
    with forced refspecs and no tag following. It unshallows a shallow checkout
    in the same fetch, so no ref already in the checkout is trusted.
  - Peels the fetched tag to a commit, which covers annotated and lightweight
    tags, and requires it to be the run's commit.
  - Requires the tag commit to be reachable from `origin/main` and to be its
    tip. Every result names the tag commit and the candidate commit it compared.
  - On `workflow_dispatch` it reports the same comparison for the run's commit
    and exits 0; it fails only when the evidence cannot be read.
- `release.yml`:
  - A `provenance` job runs the script once; `package` and `publish` need it.
  - `publish` runs only for `github.event_name == 'push'` on a tag ref.
  - The version, CHANGELOG, three-platform package and smoke, and draft-only
    gates stay as they are.
- `docs/release.md` states what the check guarantees and what it cannot, and
  step 4 tags and pushes the approved commit by name.
- A CHANGELOG `[Unreleased]` entry.

## Out of scope

- Branch protection, rulesets or tag protection: this private repository's plan
  refuses them.
- Reading hosted check runs or workflow runs as evidence of review: that needs
  `checks: read` or `actions: read`, a permission this task may not add.
- Any tag push, live rehearsal, release publication or visibility change.
- Re-checking provenance inside `publish` (Decision 7).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The candidate is `origin/main`'s tip, fetched when the check runs; the tag commit must equal it, not merely be reachable from it. | It is the only candidate evidence a tag run can read without new permissions or configuration, and steps 2–3 review main's tip. Reachability alone would admit a superseded main commit whose CI and rehearsal evidence belongs to a later tip. |
| 2 | Report "not reachable from origin/main" and "on origin/main but not its tip" as separate reasons. | A side-branch tag and a stale candidate need different fixes. |
| 3 | Fetch main and the tag from `origin` with forced refspecs and `--unshallow` when the checkout is shallow. | `actions/checkout` fetches depth 1 with no main ref, and a stale local `origin/main` or tag would otherwise decide the result. |
| 4 | The tag as re-read from `origin` must peel to the run's commit. | A tag moved after the push would otherwise be judged by the commit the run did not build. |
| 5 | One `provenance` job on `ubuntu-latest`, needed by `package` and `publish`. | It fails the workflow once, before any packaging step on any OS, and the gate is visible in the job graph. |
| 6 | `publish` requires `github.event_name == 'push'` as well as a tag ref; a rehearsal runs the check in report mode. | A dispatch on a tag ref has `ref_type == 'tag'`. Rehearsals may legitimately run on a branch, and still show whether a tag on that commit would pass. |
| 7 | No second check in `publish`; release.md asks for no push to `main` between the tag push and the draft, and for the publisher to compare the provenance log with the approved SHA. | A re-check would reject a good release whenever main moves during the long run. A draft is never public until a person publishes it. |
| 8 | The check uses the token `actions/checkout` persists; permissions stay `contents: read` outside `publish`. | No permission broadening. |
| 9 | Tests spawn the real CLI against temporary bare and cloned repositories, with `GIT_ALLOW_PROTOCOL=file` and isolated Git configuration. | They exercise exit codes and messages as the workflow sees them, and Git itself refuses any network transport. |
| 10 | The workflow test reads `release.yml` as text. | The repository has no YAML dependency, and the assertions concern a few lines. |

## What the check guarantees

When the `provenance` job passes on a tag push, the tag as it exists on
`origin` peels to the commit the run builds, and that commit was the tip of
`origin/main` when the job ran. Packaging and the draft proceed only after that.

It cannot establish:

- **That main's tip was reviewed.** It reads no CI result or approval; steps 2
  and 3 and the owner's SHA approval stay manual.
- **That main holds only reviewed commits.** Nothing server-side protects
  `main`.
- **Anything about a tag whose commit changes the check.** A tag push runs the
  workflow file and script from the tagged commit, so a side branch that edits
  or removes either builds a draft unchecked. The publisher's comparison of the
  draft's tag commit with the approved SHA is the remaining control.
- **Anything from a version match.** A tag naming the `package.json` version
  proves only the name.

## Seam changes

None. Nothing under `electron/`, `shared/` or `src/` changes.

## Tests

`test/release-provenance.test.mjs`, offline:

- A lightweight tag on main's tip in a depth-1 clone exits 0, and so does an
  annotated tag; stdout names the tag commit and the candidate commit.
- A tag on an unrelated branch exits non-zero; stderr names both commits and
  says the tag commit is not reachable from `origin/main`.
- A tag on an older main commit exits non-zero as not main's tip, including
  when the clone's own `origin/main` still points at the tag commit.
- A tag moved on `origin` after the run's commit was pushed exits non-zero,
  naming both commits.
- A tag or `main` missing on `origin` exits non-zero and says what is missing.
- A rehearsal on main's tip, and one on a tag ref at a side-branch commit, both
  exit 0 and report the comparison.
- `release.yml`: `provenance` runs the script; `package` and `publish` need it;
  `publish` requires a push event on a tag ref; the version gate and
  `draft: true` remain.

## Done when

A tag pushed anywhere but main's current tip fails the release run before any
installer is built, naming the tag commit and the candidate commit, and a manual
rehearsal never creates a draft; release.md says exactly what that proves.
