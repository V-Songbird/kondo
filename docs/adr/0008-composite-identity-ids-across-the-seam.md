# Composite identity, ids across the seam

A hook is a JSON object inside a shared settings file, a plugin toggle is a
key in `enabledPlugins`, a session is a file plus an optional sidecar
directory. Path-as-identity does not generalize across those, and paths
crossing the IPC seam are a security liability.

Decision, two halves:

- **Identity is composite.** Every entity kondo shows has an id of the form
  `<kind>:<scope-or-store>:<key>` (e.g. `skill:user:alpha-skill`,
  `plugin:foreman@foundry`, `session:code:D--Projects-app/11111111-…`).
  The key is stable under content edits and unique within kind+scope. Ids are
  opaque to the renderer — display strings travel separately.
- **Only ids cross the seam.** The renderer drills into or mutates an entity
  by returning an id from a previous scan. Main resolves ids against its own
  scan state and validates shape before touching disk; an unknown id is a
  typed error, not a lookup elsewhere. No IPC channel accepts a free-form
  path, ever.

## Considered options

- **Paths as ids** (skilldex). Rejected: doesn't cover non-file entities,
  changes identity when a move or bench changes a directory (skilldex needed a
  compensating module to undo that), and hands the renderer path-shaped power.
- **Numeric handles per scan.** Rejected: unstable across refreshes, so the
  UI loses selection on every rescan and ids mean nothing in logs or tests.
- **Composite string ids, resolved against scan state (chosen).**

## Rules

- Grammar: `kind ':' scope ':' key`, split on the first two colons only —
  scope and key may hold `/` (a project scope is `project/<flat>`, a session
  key is `<flat>/<uuid>`) but never `:`. Two ids bend it and are kept rather
  than renamed: a hook id nests a settings-layer id
  (`hook:settings:user:user:0`), and a plugin id has no scope segment
  (`plugin:<name>@<marketplace>`) because a plugin's state lives in settings
  layers, not in the plugin.
- Every new entity kind defines its key rule here before shipping. The project
  key that every project-scoped id, store name and settings layer shares is
  Claude's flattened path (ADR-0009).
- Attribution travels as fields, never by parsing an id: `SkillInfo`,
  `HookInfo`, `SettingsLayerInfo`, `PluginScopeState` and `PlacedEntryInfo`
  carry `projectId` (a `project:code:<flat>` id, or null for the user scope).
  A folder name such as `projectLabel` is display-only, because two projects
  can share one. `McpServerInfo` carries the flattened `project` instead,
  joined in main; the renderer still never splits an id.
- A screen about a scope rather than one entity still takes an id: the user
  store is `store:user:user`, so `projectDetail` has one parameter. A
  `project:global` id was rejected — it would be a project that is not one.
- A resolution that depends on the project resolves per project
  (`PluginInfo.effectiveIn`: one answer per project plus one for the user
  scope).
- Display paths are display strings built by `tildify` in `display.ts`, with
  forward slashes on every OS. Real OS paths (`ProjectRecord.guessedPath`,
  `ProjectRecord.absPath`) stay in main and are what a mutation resolves
  against; `SessionProject` omits `guessedPath`.
- Evidence a DTO cannot produce is `null`, never a default
  (`SkillInfo.neverUsed`, `ProjectRowCounts.hooks` and `mcpServers`); a view
  badges on `true`, never on the absence of a record.
- A store fact travels as a fact and its verdict lives in one place
  (`SessionSummary.releasedByDesktop` is the marker; the
  `desktop-released-sessions` category decides), and a threshold travels
  beside the flag it produced (`staleAfterDays` beside `stale`).

## Consequences

- Selections survive refreshes and toggles; logs and tests read naturally.
- Main must keep its id→entity resolution fresh; a stale id after an
  external change resolves to a typed `unknown-id` error the UI can turn
  into "rescan".
