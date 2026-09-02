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
  to know which project an entity belongs to, the DTO carries `projectId`
  (entry 025) — the renderer may not split an id to find out.
