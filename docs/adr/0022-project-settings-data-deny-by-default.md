# Project settings-derived data deny-by-default

Settings files, `~/.claude.json` and `.mcp.json` hold credentials in `env`,
`headers`, helper commands and arbitrary keys. Anything that reaches the
renderer has already crossed the bridge (ADR-0004), whether or not a view
prints it, and a denylist of secret-looking names cannot know which arbitrary
key or command holds a token.

Settings-derived data therefore crosses the seam only as documented names and
validated states, chosen in the main process before a DTO is built:

- A settings-file summary lists only the top-level names Claude Code documents
  for settings files (`settingsKeys`). Any other name stays in main;
  `unlistedKeys` says only that one exists. Values never cross.
- A hook row carries a documented event (`hookEvents`) or null, a documented
  handler type (`hookTypes`) or null, whether a matcher narrows it, the status of
  the first script its command names, and the settings file, layer and project
  that arm it. Command text, matcher patterns and script paths stay in main.
- An MCP transport is `stdio`, `http`, `sse`, `ws` or `unknown`;
  `streamable-http` reads as `http`.
- A failure while reading a settings file or statting a hook script keeps its
  code and the settings file's display path, with Kondo's own sentence instead
  of exception text. A JSON syntax error never contributes its message anywhere,
  because V8 quotes the parsed source in it.
- No reveal, copy-raw or tooltip path brings omitted material back.

## Considered options

- **Deny secret-looking names (`env`, `headers`, `token`).** Rejected: secrets
  sit in arbitrary keys, commands and nested values, so a denylist fails open.
- **Mask values in the renderer.** Rejected: the bytes would already be in the
  renderer process.
- **A reviewed vocabulary of matcher patterns.** Rejected: a matcher is a
  pattern over tool, notification, agent or file names, so a vocabulary would
  still need the omission rule and a maintained source.
- **Remove settings summaries and hook rows.** Rejected: attribution, event,
  handler type and script status answer "which file arms what" without the
  secret-bearing parts.
- **Documented names and validated states, built in main (chosen).**

## Consequences

- Useful data remains: documented names such as `env`, `permissions` and
  `hooks`, hook events, types and script findings, and itemized `parse-failed`
  errors beside healthy siblings (ADR-0005).
- Claude Code adds settings, events and types over time. Until a list is
  updated, a new name reads as unlisted and a new event or type as unrecognized.
  Updating a list is a reviewed contract change with a new check date in
  `docs/domain.md`.
- Diagnosing a malformed file means opening it in an editor: Kondo does not
  quote the offending text.
- Identifiers already published are unchanged: skill, MCP server and plugin
  names, project and display paths. A plugin key from `enabledPlugins` crosses
  only after it matches `<name>@<marketplace>` with installation evidence
  (ADR-0010), and a key from `installed_plugins.json` is named in a diagnostic
  only when it matches that grammar.
- Settings writes stay refused (ADR-0010), the renderer gains no disk access,
  and nothing adds network access. This hardens projections; it is not an
  effective-settings viewer (ADR-0021).
