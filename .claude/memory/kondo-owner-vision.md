---
name: kondo-owner-vision
description: "The owner's product vision for kondo (project-first, move/promote everything, clean ~/.claude) and where the 2026-09-02 direction audit left the roadmap"
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd453f8-1b29-4a5d-941f-fdb6251fa81d
  modified: 2026-09-02T06:48:00.166Z
---

Owner's brief (2026-09-01, in Spanish): kondo must be simple. On open, show
projects with the skills, plugins, hooks (and agents, MCP servers) tied to
each; move plugins between projects; disable per project or globally;
promote a skill/agent from project to global; and clean `~/.claude` —
duplicates, duplicate/dead/temporary projects, orphaned config (MCP
declarations for gone projects, unused skills).

Audit outcome: the mutation core (journal/trash/undo, kind registry, native
conventions) is sound; the product direction was off — kind-first tabs, no
project view, no MCP/agent kinds, and project identity keyed on an
un-flattening guess that resolved 7 of 9,171 dirs. Fixed the identity
(ADR-0009: `~/.claude.json` `projects` keys flattened with `[^A-Za-z0-9]→-`),
rewrote ROADMAP.md around v0.3 "project view", v0.4 "move everything",
v0.5 "clean my ~/.claude", and logged entries 022–037 in ROADMAP.jsonl.

**Why:** every future session should build toward the project-first shape,
not extend the kind-first tabs.

**How to apply:** pick work from ROADMAP.jsonl 023+ in dependency order
(023/024/025 → 026). Never write `~/.claude.json` until entry 031's splice
step exists. See [[kondo-scaffold]], [[kondo-fixture-run-recipe]].
