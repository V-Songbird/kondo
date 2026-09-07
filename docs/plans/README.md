# Plans

One file per feature, written **before** the code. A plan is where a feature
pre-answers its review questions: what is in, what is deliberately out, what
crosses the seam, and which tests prove it. CONTRIBUTING.md makes the plan
the first commit of a feature, not a document written afterwards to describe
one.

Plans are living until they ship. `Status:` at the top is `in progress` or
`done — shipped in <sha>`. A shipped plan keeps a short "what actually
shipped" section when reality diverged from the design, because the gap
between the two is the part a later reader needs.

## Index

- [080 — Smoke the release artifacts](080-release-artifact-smoke.md) — **done**
- [074 — Durable and confined splice replacement](074-safe-splice.md) — **in progress**
- [v0.1 — the read-only core](v1-read-only-core.md) — **done**
- [001 — the mutation journal and kondo trash](001-mutation-journal-and-trash.md) — **done**
- [006 — the tidy sweep with a dry-run preview](006-tidy-sweep.md) — **done**
- [007 — undo and the trash, on screen](007-undo-and-trash-ui.md) — **done**
- [026 — the Projects home](026-projects-home.md) — **in progress**
- [Claude Code usability and safety review](2026-09-06-claude-usability-review.md) — **in progress**
- [Approachable UX workflow](2026-09-06-ux-workflow.md) — **in progress**
- [Signal themes](2026-09-06-signal-themes.md) — **done**
- [082 — Private and machine-local publication hygiene](082-private-local-publication.md) — **done**

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
hard to reverse or keeps coming back graduates to an [ADR](../adr/).
