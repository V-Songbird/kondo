# Plans

One file per feature, written **before** the code. A plan is where a feature
pre-answers its review questions: what is in, what is deliberately out, what
crosses the seam, and which tests prove it. CONTRIBUTING.md makes the plan
the first commit of a feature, not a document written afterwards to describe
one.

A plan lives until its work ships. Then whatever is still true moves to its
lasting home — a decision into an [ADR](../adr/), a store fact into
[domain.md](../domain.md), architecture into
[foundations.md](../foundations.md), test strategy into
[testing.md](../testing.md), a release gate into [release.md](../release.md),
open follow-up work into [ROADMAP.md](../../ROADMAP.md) — and the plan is
deleted; Git keeps it. A plan dropped before shipping is deleted too. While it
lives, `Status:` at the top says `in progress`. Plans being written on other
branches are listed in [status.md](../status.md).

## Index

- [119 — Release tag provenance](119-release-tag-provenance.md) — a release
  tag must be main's reviewed tip before anything is packaged, and a rehearsal
  never drafts a release.
- [132 — Sandboxed preload startup failure under load](132-sandbox-preload-startup.md)
  — the experiments that separate an Electron, smoke-harness or kondo startup
  cause; none has run yet.
- [111 — Public Git history decision](111-public-history-decision.md) — the
  owner chose strategy A, a separate public repository with a new root commit;
  the public identity and destination are open. Its
  [baseline manifest](111-public-history-baseline.manifest) and
  [evidence](111-public-history-evidence.json) sit beside it and are read by its
  reproduction script.

## Template

```markdown
# Plan: <feature>

Status: **in progress**

<One paragraph: what this is and why now.>

## Scope

<What gets built, grouped by layer: workspace / seam / renderer.>

## Out of scope

<What is deliberately not in this slice, so review does not ask for it.>

## Decisions

| # | Decision | Rationale |
|---|---|---|

## Seam changes

<Contract additions, per CONTRIBUTING.md "Changing the seam". None is a
valid answer and worth stating.>

## Tests

<The specific assertions to write, not "add tests".>

## Done when

<One user-visible paragraph.>
```

The Decisions table is the load-bearing part. A decision recorded with its
reason here is a review question that never has to be re-argued; one that is
hard to reverse or keeps coming back graduates to an [ADR](../adr/) before the
plan is deleted.
