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

- [112 — Private security reporting and maintenance](112-security-reporting-maintenance.md) — **accepted 2026-09-08; local integration by coordinating session**

- [100 — Conservative configuration inventory](100-conservative-config-inventory.md) — **done — accepted 2026-09-08**

- [099 — Undo recovery](099-undo-recovery.md) — **awaiting acceptance**

- [098 — Concurrent settings writes](098-concurrent-settings-writes.md) — **done**

- [109 — Hook layer boundary and accurate claims](109-hook-layer-boundary.md) — **accepted decision**

- [108 — Desktop session boundary and removal scope](108-desktop-session-boundary.md) — **accepted decision**

- [102 — Reviewed cleanup](102-reviewed-cleanup.md) — **awaiting acceptance**

- [097 — Resolved store boundaries](097-resolved-store-boundaries.md) — **done**

- [113 — Hosted CI and release rehearsal](113-hosted-ci-rehearsal.md) — **in progress**

- [096 — Public repository surface](096-public-repository-surface.md) — **done**

- [094 — Session projection and protected-file boundary](094-session-path-privacy.md) — **done**
- [091 — Store config and temporary roots](091-store-root-resolution.md) — **done**
- [088 — Render failure recovery](088-render-error-boundary.md) — **done**
- [085 — Renderer evidence in the CDP smoke](085-cdp-smoke-events.md) — **done**
- [084 — Single-instance startup and window security](084-single-instance-security.md) — **done**
- [083 — Bundle third-party notices](083-bundled-third-party-notices.md) — **done**
- [081 — Platform and installation guidance](081-platform-release-guidance.md) — **done**
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
