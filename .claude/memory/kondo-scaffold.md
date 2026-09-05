---
name: kondo-scaffold
description: "What kondo is, the choices its owner locked in, and where the scaffold stands"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf9efd38-5567-42db-a814-4156f7c8a16d
  modified: 2026-08-29T01:18:01.091Z
---

Kondo (D:\Projects\Personal\SoftwareDevelopment\kondo) is an MIT open-source
Electron + React + strict-TS desktop app that inventories and will later tidy
Claude's on-disk state — sessions, skills, plugins, hooks, settings — across
~/.claude, project .claude dirs, and the desktop app store. Never reads
project files outside .claude; no network.

Owner-locked choices (2026-08-28): desktop app form factor; all Claude stores
in scope; cross-platform from day one; fresh codebase modeled on skilldex
(cloned for reference at D:\Projects\Knowledge\kondo\skilldex) but "one level
up" — fix its known flaws (duplicated seam types, non-strict renderer, no CI,
string errors). v0.1 = docs + read-only core; mutations (journal + trash,
native conventions like skills.disabled) are v0.2.

The repo's docs/ tree is the authority: ADRs 0001–0008, domain.md (store
facts, ✅/◇ markers), foundations.md. Contract lives in shared/contract.ts;
ids, never paths, cross the IPC seam.
