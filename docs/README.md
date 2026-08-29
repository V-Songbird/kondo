# Documentation map

Every document in this repo, what it is for, and — the part that prevents rot —
**where a new piece of writing belongs**. If you are about to write something
and its home is not obvious from the table below, fix the table in the same PR.

## The map

| Document | Holds | Update when |
|---|---|---|
| [README.md](../README.md) | Front door: what kondo is, principles, quickstart | The product story or commands change |
| [ROADMAP.md](../ROADMAP.md) | Direction and non-goals | Priorities shift; an item ships or dies |
| [CHANGELOG.md](../CHANGELOG.md) | User-visible changes per release | Every user-visible PR |
| [SECURITY.md](../SECURITY.md) | Threat model, reporting channel | The security posture changes |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Dev setup, workflow, conventions, review bar | Tooling or process changes |
| [AGENTS.md](../AGENTS.md) | Operating manual for AI agents and humans working here | Working rules change |
| [CLAUDE.md](../CLAUDE.md) | Claude Code entry point; defers to AGENTS.md | Rarely |
| [docs/domain.md](domain.md) | Facts about Claude's on-disk world (stores, files, formats) | You observe a new store fact or Claude changes one |
| [docs/foundations.md](foundations.md) | Architecture: processes, seams, modules, data flow | Structure changes |
| [docs/adr/](adr/) | Decisions with reasons, one file each | A decision is made, revisited, or superseded |
| [docs/plans/](plans/) | Feature plans, one file each, written before building ([index and template](plans/README.md)) | A feature is planned; marked done when shipped |
| [docs/glossary.md](glossary.md) | Shared vocabulary | A term is coined or found ambiguous |
| [docs/testing.md](testing.md) | Test strategy and safety invariants | The strategy changes |
| [docs/release.md](release.md) | Versioning, packaging, shipping | The release process changes |

## Routing rule

- Made a **decision** that was hard, is hard to reverse, or keeps being
  re-asked? → new ADR ([template](adr/README.md)).
- Learned a **fact about Claude's files** (a path, a schema, a convention)? →
  [domain.md](domain.md), with a verified/expected marker.
- Changed **how the code is put together**? → [foundations.md](foundations.md).
- About to **build a feature**? → a plan in [plans/](plans/) first.
- Defined or bent a **term**? → [glossary.md](glossary.md).
- Everything about **process** (branching, review, style)? → CONTRIBUTING.md.

Documentation debt is a bug. A PR that makes any doc above wrong and does not
fix it is incomplete — reviewers should treat it exactly like a failing test.
