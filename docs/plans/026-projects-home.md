# Plan: the Projects home — project-first navigation

Status: **in progress**

Kondo opens on a dashboard of directory sizes and offers eight kind-first
tabs. The owner's first requirement is the opposite shape: open the app, see
your projects, pick one, and see everything Claude ties to it. Nothing new has
to be read from disk to serve that — entries 023-025 landed the `mcp`,
`agent`, `command`, `rule` and `output-style` kinds and the `projectId`
attribution fields, so the Projects home is a *projection* over kinds that
already exist rather than a new adapter. This slice builds that projection,
cuts the sidebar to three destinations, and folds the old dashboard into the
global row.

## Scope

**Workspace.** `countStoreEntries` in `user-store.ts` — tier-1 counts for one
store root, by readdir names alone. `clearEnabledPlugin` there too: the splice
that removes one `enabledPlugins` member, the inverse of `editEnabledPlugins`.
`pluginClearPlan` in `kinds.ts`, mirroring `pluginTogglePlan`.

**Seam.** Three methods: `projectsList`, `projectDetail`, `pluginClear`.

**Renderer.** `src/features/projects/` — the list on the left, the project
page on the right. `src/ui/last-change.tsx` — the banner with Undo. The
sidebar drops to Projects, Clean up, History; the six views those three
replace are deleted, their tables becoming the project page's sections.

## Out of scope

- Writing MCP servers. The matrix still refuses every operation on the `mcp`
  kind (ADR-0009, entry 031); the section lists and does not act.
- Moving an agent, command, rule or output style. Entry 028.
- Any new capability operation. `pluginClear` is gated on the layer's existing
  `disable` decision — permission to write the key covers permission to
  unwrite it — so `CapabilityOperation` is untouched.
- The wording pass over labels, empty states and refusal captions. Entry 037.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | `projectsList` counts hooks and MCP servers as `null`, not as a number | A hook is a fragment of `settings.json` and an MCP server a key of `~/.claude.json` or `.mcp.json`. Neither can be counted without opening a file, and the invariant for this channel is readdir only (ADR-0007). `projectDetail` fills both in for the one project opened. The alternative — reading every project's settings to draw a home screen — is the exact cost ADR-0007 exists to refuse. |
| 2 | The global row's id is `store:user:user` | The user store is a store, not a project, and the matrix already holds that kind and scope (ADR-0008). Inventing a `project:global` would be a project that is not one. |
| 3 | `projectDetail` narrows by handing each scanner a one-project `VerifiedProject[]`, then filters on `projectId` | Every scanner already takes the project list as a parameter, so narrowing is a parameter and not a second scanner. The filter joins on the DTO field, never on a parsed id (ADR-0008). |
| 4 | Opening one project still stats the registry's other MCP-declaring projects | `scanMcpServers` reads `~/.claude.json` whole — unavoidable for any MCP answer — and stats the root of each entry that declares a server, to mark orphans. Those are stats, not reads, and the alternative is a near-duplicate scanner. Cost is bounded by how many projects declare MCP servers, not by how many exist. |
| 5 | The write target is the highest-precedence layer of *this scope* that already states a value, else this scope's `settings.local.json` | A user who has already said something about a plugin in `settings.json` expects the next click to change that statement, not to shadow it from a file they did not open. When nothing states anything, the private layer is the one that cannot surprise a teammate. |
| 6 | "Follows global" is a real write, not a display state | It removes this project's statement so the user layer wins again. Offering it as an unreachable third position would be a dead end in the control. It is a `write` step like any other, so `mutations` snapshots the old bytes and undo restores them (ADR-0001) with no new machinery. |
| 7 | The six replaced views are deleted rather than left unreachable | Nothing imports them once the sidebar drops to three. Their content is the project page's sections. |
| 8 | Tier-1 counts admit a skill directory with no `SKILL.md`; tier-2 does not list it | The count is a readdir and the listing is a frontmatter read, so the two can disagree by exactly one broken directory. Honest tiering (ADR-0007) beats a count that lies about its cost. |

## Seam changes

Added to `shared/contract.ts`:

- `ProjectRowCounts`, `ProjectRow` — one row per project plus the global row.
- `ProjectPluginChoice`, `ProjectPluginState` — the three-way control's state
  and the layer a click would write.
- `ProjectDetail` — the sections of one project page.
- `KondoApi.projectsList(refresh?)`, `.projectDetail(id)`, `.pluginClear(pluginId, layerId)`,
  and their three channel names.

Nothing is removed. `storesOverview` stays: it is the global row's Storage
section now instead of the app's front door.

## Tests

- `projectsList` returns the global row first, then one row per project.
- Its counts match a fixture holding two skills (one benched), two agents, one
  command, one rule and both settings files, in a project store.
- Its `hooks` and `mcpServers` are null, and the call opens no file: the write
  and read probes in `test/helpers.ts` see no `readFile` of a settings file.
- A project with no `.claude` still returns a row, with zero counts (ADR-0005).
- `projectDetail` on a project id returns only that project's skills, agents,
  hooks, MCP servers and settings layers — nothing carrying another project's
  `projectId`, and nothing user-scoped in the project lists.
- `projectDetail` on `store:user:user` returns the user store's entries, the
  desktop and user store reports, and no sessions.
- An unknown id answers `unknown-id`; a malformed one answers `bad-request`.
- `ProjectPluginState.targetLayerId` is the local layer when nothing states a
  value, and the stating layer when one does.
- `pluginClear` removes the key, leaves every other key byte-identical, and
  `journalUndo` puts the original file back.
- `pluginClear` on a layer that says nothing is refused, not written.

## Done when

Opening kondo shows a list of projects with a global row above them. Picking
one shows its skills, plugins, hooks, agents, MCP servers, settings layers and
sessions, with the actions on each row. A plugin can be turned on here, off
here, or set back to following the global setting, and the file that changed is
named. The sidebar holds Projects, Clean up and History, and the old size
dashboard is the Storage section of the global row.
