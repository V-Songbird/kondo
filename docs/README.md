<img src="../src/assets/kondo-mark.svg" width="56" height="56" alt="">

# Documentation map

Every document in this repo, what it is for, and — the part that prevents rot —
**where a new piece of writing belongs**. If you are about to write something
and its home is not obvious from the table below, fix the table in the same PR.

## The map

| Document | Holds | Update when |
|---|---|---|
| [README.md](../README.md) | Front door: what kondo is, principles, quickstart | The product story or commands change |
| [ROADMAP.md](../ROADMAP.md) | Direction, open work and non-goals | Priorities shift; an item ships or dies |
| [docs/status.md](status.md) | Where work stands: `main`, branches and worktrees, next steps, open findings and questions | Work starts, lands or stops; a finding is opened or resolved |
| [CHANGELOG.md](../CHANGELOG.md) | User-visible changes per release | Every user-visible PR |
| [SECURITY.md](../SECURITY.md) | Threat model, private reporting, supported-version policy | The security posture changes |
| [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) | Attribution for everything the installers carry: fonts, the Electron runtime, the bundled renderer libraries; packaged license locations | A dependency lands or leaves, or a component's licensing changes |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Dev setup, workflow, conventions, review bar | Tooling or process changes |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Participation expectations, enforcement and reporting limits | Conduct policy or contact changes |
| [.github/ISSUE_TEMPLATE/](../.github/ISSUE_TEMPLATE/) | Safe bug and feature intake, security routing | Reporter information needs change |
| [AGENTS.md](../AGENTS.md) | Operating manual for AI agents and humans working here | Working rules change |
| [CLAUDE.md](../CLAUDE.md) | Claude Code entry point: verified commands, constraints and links; defers to AGENTS.md | Commands or constraints change |
| [.claude/skills/run-kondo/SKILL.md](../.claude/skills/run-kondo/SKILL.md) | Launching and driving the built app against a synthetic fixture | Navigation, controls or the fixture change |
| [DESIGN.md](../DESIGN.md) | The visual system: palette, type, shapes, cards, controls and rules | The look changes; a new control, state or colour is designed |
| [docs/domain.md](domain.md) | Facts about Claude's on-disk world (stores, files, formats) | You observe a new store fact or Claude changes one |
| [docs/foundations.md](foundations.md) | Architecture: processes, seams, modules, data flow | Structure changes |
| [docs/adr/](adr/) | Decisions in force, with reasons, one file each | A decision is made or changes; delete one that no longer holds |
| [docs/plans/](plans/) | Feature plans, one file each, written before building ([index and template](plans/README.md)) | A feature is planned; folded into lasting docs and deleted when shipped |
| [docs/glossary.md](glossary.md) | Shared vocabulary | A term is coined or found ambiguous |
| [docs/testing.md](testing.md) | Test strategy and safety invariants | The strategy changes |
| [docs/release.md](release.md) | Versioning, packaging, shipping | The release process changes |

## Public documentation and local working records

Commit reusable project knowledge here: plans, ADRs, domain facts, contributor
instructions, and the public direction in `ROADMAP.md`. Agent memory and
workstation setup are local working records, not documentation for a clone.
Promote useful lessons into the appropriate public document after removing
private paths and context.

| Shared in Git | Kept locally and ignored |
|---|---|
| `ROADMAP.md`, plans, ADRs, and contributor documentation | `ROADMAP.jsonl`, its migration backups, and all of `.foreman/` (settings, lessons, archives, and runtime state) |
| `.claude/settings.json`, portable rules, and `.claude/skills/run-kondo/` | `.claude/memory/`, `.claude/rules/jetbrains-mcp.md`, and local overrides |
| Jig config, manifest, activation instructions, checks, and hooks | `.jig/plan*.json`, `.jig/plan.md`, authored/backlog/discarded JSON, and runtime records covered by `.jig/.gitignore` |
| Source code and portable build configuration | `.idea/` workstation project state |

Fresh clones receive the public documents and shared checks, but no Foreman
queue, settings, or lesson history. Foreman is optional: initialize local records
only if using it, and keep reusable decisions in the public documents. Existing
local queues continue to work through the Foreman CLI. See
[ADR-0013](adr/0013-keep-working-records-local.md) for the publication decision.

Ignore rules do not untrack existing files. For an already tracked local record,
use `git rm --cached -- <path>` and confirm that its local copy still exists.
This changes future snapshots only; earlier Git history still contains files
that were previously committed.

## Routing rule

- Made a **decision** that was hard, is hard to reverse, or keeps being
  re-asked? → new ADR ([template](adr/README.md)).
- Learned a **fact about Claude's files** (a path, a schema, a convention)? →
  [domain.md](domain.md), with a verified/expected marker.
- Changed **how the code is put together**? → [foundations.md](foundations.md).
- About to **build a feature**? → a plan in [plans/](plans/) first.
- Defined or bent a **term**? → [glossary.md](glossary.md).
- Everything about **process** (branching, review, style)? → CONTRIBUTING.md.
- Changed **where work stands** — a branch, a pull request, a next step, an
  open finding? → [status.md](status.md).

Documents describe what `main` does today. When something stops being true,
rewrite or delete it rather than marking it superseded; Git keeps the history.
Keep dated evidence only where it qualifies a current claim.

Documentation debt is a bug. A PR that makes any doc above wrong and does not
fix it is incomplete — reviewers should treat it exactly like a failing test.
