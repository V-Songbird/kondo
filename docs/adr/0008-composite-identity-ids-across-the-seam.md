# Composite identity, ids across the seam

Skilldex could say "a skill's identity is its directory" because everything
it managed was a directory. Kondo cannot: a hook is a JSON object inside a
shared settings file, a plugin toggle is a key in `enabledPlugins`, a session
is a file plus optional sidecar directory. Path-as-identity does not
generalize, and paths crossing the IPC seam are a security liability.

Decision, two halves:

- **Identity is composite.** Every entity kondo shows has an id of the form
  `<kind>:<scope-or-store>:<key>` (e.g. `skill:user:alpha-skill`,
  `plugin:foreman@foundry`, `session:code:D--Projects-app/11111111-…`).
  The key is stable under content edits (skilldex's one identity principle
  worth keeping) and unique within kind+scope. Ids are opaque to the
  renderer — display strings travel separately.
- **Only ids cross the seam.** The renderer drills into or (later) mutates
  an entity by returning an id from a previous scan. Main resolves ids
  against its own scan state and validates shape before touching disk; an
  unknown id is a typed error, not a lookup elsewhere. No IPC channel
  accepts a free-form path, ever.

## Considered options

- **Paths as ids** (skilldex). Rejected: doesn't cover non-file entities,
  changes identity when enable/disable moves a directory (skilldex needed a
  compensating "favourite key" module to undo that), and hands the renderer
  path-shaped power.
- **Numeric handles per scan.** Rejected: unstable across refreshes, so the
  UI loses selection on every rescan and ids mean nothing in logs or tests.
- **Composite string ids, resolved against scan state (chosen).**

## Consequences

- Selections survive refreshes and toggles; logs and tests read naturally.
- Main must keep its id→entity resolution fresh; a stale id after an
  external change resolves to a typed `unknown-id` error the UI can turn
  into "rescan".
- Every new entity kind must define its key rule here before shipping.
- The grammar as built (2026-09-02): `kind ':' scope ':' key`, split on the
  first two colons only — scope and key may hold `/` (a project scope is
  `project/<flat>`, a session key is `<flat>/<uuid>`) but never `:`. Two
  shipped ids bend it and are recorded rather than renamed: a hook id nests
  a settings-layer id (`hook:settings:user:user:0`), and a plugin id has no
  scope segment (`plugin:<name>@<marketplace>`) because a plugin's state
  lives in settings layers, not in the plugin.
- The project key — the segment every project-scoped id, store name and
  settings layer shares — is Claude's flattened path (ADR-0009). Kinds still
  to come (`mcp`, `agent`, `command`, `rule`) take it unchanged.
- Attribution travels as fields, never by parsing an id: when a view needs
  to know which project an entity belongs to, the DTO carries `projectId` —
  the renderer may not split an id to find out. As built (entry 025) that is
  `SkillInfo`, `HookInfo`, `SettingsLayerInfo` and `PluginScopeState`, each
  holding a `project:code:<flat>` id or null for the user scope. A folder
  name is not an id and never keys anything: `PluginScopeState.projectLabel`
  exists only to be displayed, because two projects can both be called `app`.
- A resolution that depends on the project resolves per project. A plugin's
  winning settings layer was one global answer (`winningLayerId`) until it
  had to serve a per-project page; it is now `PluginInfo.effectiveIn`, one
  entry per project plus one for the user scope, each naming the layer whose
  value stands there.
- The project set is the union of Claude's two records of a project — the
  `projects` keys of `~/.claude.json` and the directories under
  `~/.claude/projects` — joined on the flattened path. `SessionProject`
  therefore says which half named it (`sources`), whether its directory is
  still on disk (`pathExists`), and whether it holds a `.claude` at all
  (`hasStore`). A member with `hasStore: false` is a project kondo can name
  and cannot write into; the skill-move picker filters on that field, and the
  workspace refuses such a destination as `bad-request` naming the missing
  directory rather than as an id it never heard of.
- A screen that is *about* a scope rather than about one entity still takes
  an id, and the user store has one for it: `store:user:user`. The projects
  home (entry 026) passes that where a project page passes
  `project:code:<flat>`, so `projectDetail` has one parameter and not a
  parameter plus a flag. Inventing a `project:global` was rejected — it would
  be a project that is not one, and the `store` kind already exists for
  exactly this: a whole store rather than a thing inside it.
- A row of that home (`ProjectRow`) carries no `capabilities`, unlike every
  entity DTO here. It is an aggregate over entities rather than an entity, so
  there is no kind × scope × operation lookup it could stand for; permission
  travels with the things inside it, which arrive with `projectDetail`.
- The `projectId` join is what makes a project page possible without new
  adapters: the workspace narrows every scanner to one project and then keeps
  the entries whose `projectId` field matches. One join is not on that field —
  `McpServerInfo` carries `project`, the flattened path — and it is done in
  the main process, which is where flattening is understood. The renderer
  still never splits an id.
