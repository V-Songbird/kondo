# Plan: Settings-derived data stays in main

Status: **in progress**

Decision 107 reproduced three ways settings content reached the renderer, with
synthetic fixtures at `b028598`: every top-level setting name, raw hook commands
(printed and in a tooltip), and JSON parser diagnostics that quote the file.
[ADR-0021](../adr/0021-summarize-settings-files.md) recorded those projections
as not secret-safe and assigned the hardening here. The owner approved a
deny-by-default projection: documented names and validated states cross; the
rest of the material stays in the main process
([ADR-0022](../adr/0022-project-settings-data-deny-by-default.md)).

## Audit at `667e9aa`

Scope: the settings, hook and project projection chain and every serialized
envelope that carries it, including errors and `unknown`.

| # | Source | What crossed | Result |
|---|---|---|---|
| A1 | `user-store.ts:179` → `SettingsLayerInfo.keys` | every top-level name (`Object.keys(parsed)`) | confirmed |
| A2 | `user-store.ts:380` → `HookInfo.command`; `projects.tsx:652` text and `title`, `library.tsx:552` | command text, truncated to 200 characters | confirmed |
| A3 | `user-store.ts:252` → `HookInfo.matcher`; `projects.tsx:651`, `library.tsx:549`, Library item names via `catalog.ts:128` | matcher pattern | confirmed |
| A4 | `user-store.ts:352`, `:359`, `:361` → `HookScript.path`; `projects.tsx:994` text and `title`, `library.tsx:583`, `catalog.ts:399` | the command's script token, raw or resolved | confirmed (survey lead) |
| A5 | `user-store.ts:360` through `scan.ts:110` | hook-script stat failure: a path built from the command and the raw `fs` message | confirmed (survey lead) |
| A6 | `user-store.ts:171` through `scan.ts:21` and `:31` | the `SyntaxError` text of a malformed settings file | confirmed |
| A7 | `scan.ts:179` for `~/.claude.json` (`sessions.ts:147`, `user-store.ts:1111`, `:1616`) and `.mcp.json` (`user-store.ts:1179`); `user-store.ts:467`, `:1409` | the same parser text from files holding MCP `env` and `headers` | confirmed (survey lead) |
| A8 | `mutations.ts:822` | the same parser text for a torn journal line, which can hold settings bytes from historical splice edits | confirmed (survey lead) |
| A9 | `user-store.ts:133` and `:161` | settings stat and read failures carry `fs` exception text (paths only) | confirmed |
| A10 | `user-store.ts:1054` → `McpServerInfo.transport` | any declared `type` string | found by this audit |

On Node 22.22.2, `JSON.parse('{"env":S107}')` fails with
`Unexpected token 'S', "{"env":S107}" is not valid JSON`; longer input yields a
window of the surrounding text.

Checked and left unchanged: plugin ids from `enabledPlugins` cross in ghost rows
and leftovers only after matching `<name>@<marketplace>` with installation
evidence (100); `SkillOverrideState.value` is validated; skill and MCP server
names are identities (ADR-0002, ADR-0008); `unknown` holds directory entries of
the transcript and desktop stores only. Planner refusals in `kinds.ts` name
display paths, ids, entity names and fixed sentences; the one `fs` message
(`kinds.ts:844`) describes a failed `~/.claude.json` read.

## Scope

**Workspace.** `readSettingsLayers` keeps documented names and sets
`unlistedKeys`. `rawHooks` validates event and handler type and reduces the
matcher to a boolean; the command stays internal for the script recognizer.
`hookScript` returns only a status, and its stat failure names the settings file
with a fixed sentence. Settings read and stat failures use fixed sentences.
`describe` replaces every `SyntaxError` message with one sentence, which covers
settings files, the registry, `.mcp.json`, the plugin manifest and journal lines
at their shared root. `transportOf` returns a validated transport.

**Seam.** See below.

**Renderer.** Project Technical details, the Library hook and settings pages and
the Library catalog show events, handler types, matcher presence, script status
and documented names, with a plain explanation of what is not shown. No command,
pattern or path is printed or placed in a `title`.

## Out of scope

- An effective-settings viewer, value display or reveal action (ADR-0021).
- Settings writes, which stay refused (098); hook declaration changes (ADR-0017).
- Reporting an unreadable hook script as unverifiable rather than missing (127).
- Reviewed vocabularies for matcher patterns, MCP disable scopes (103) and
  in-app wording beyond the changed rows (110).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | List the 161 top-level names the settings reference documents for settings files, checked 2026-09-15 | Fixed, reviewed labels. The 7 global-config names live in `~/.claude.json`. A name outside the list reads as unlisted, never as absent. |
| D2 | `unlistedKeys: boolean`, not a list or count of names | The owner asked for a generic explanation; a flag is enough to say more exists. |
| D3 | Hook `event` and `type` from documented lists (33 events, 5 handler types, checked 2026-09-15), else null | Unknown names are absent; the row survives, so hook counts and attribution stay honest. |
| D4 | `hasMatcher` is true for a string matcher other than `""` and `*` | The documented match-everything values; any pattern text is arbitrary. |
| D5 | `script` becomes `HookScriptStatus \| null` | A resolved path is still derived from the command. |
| D6 | Sanitize parser text in `describe`, settings-origin failures through a collector wrapper | One root fix for every JSON reader, and no exception text for the files that hold secrets. |
| D7 | Validate `transport` | The audit found the same class of leak in the project response. |

## Seam changes

`shared/contract.ts`: adds `settingsKeys`/`SettingsKey`, `hookEvents`/`HookEvent`,
`hookTypes`/`HookType` and `McpTransport`; `SettingsLayerInfo.keys` becomes
`SettingsKey[]` beside `unlistedKeys`; `HookInfo` drops `command` and `matcher`
and gains `type` and `hasMatcher`; `HookInfo.event` is nullable;
`HookInfo.script` is a status; `HookScript` is removed. No channel, method, id
format or preload line changes. Consumers: `projects.tsx`, `library.tsx`,
`catalog.ts`.

## Tests

- `test/workspace.test.ts`: a synthetic world with sentinels in a top-level
  name, nested unknown fields, settings `env` names and values, MCP `env` and
  `headers` names and values, an MCP `type`, hook matchers, commands, an unknown
  event and handler type, malformed user, project and `.mcp.json` files and a
  torn journal line. Every settings, hook, project, MCP, plugin, skill, cleanup,
  leftover and journal envelope, plus hook, settings, plugin and MCP refusals,
  serializes without a sentinel. Healthy documented names, events, types,
  script statuses, healthy layers and servers remain, with `parse-failed`
  errors naming the right files.
- `test/user-store.test.ts` and `test/hooks.test.ts`: adapter DTO shapes,
  statuses without paths, and a denied script stat that names the settings file
  with a fixed sentence and no command-derived text.
- `test/hook-cleanup.test.ts` and `test/library-catalog.test.ts`: the new shape,
  an unrecognized event name and a finding without a path.
- `test/e2e/smoke.mjs`: sentinel settings in the built app; Library hook and
  settings pages, All projects and project Technical details and their problem
  lists keep every sentinel out of text, `title` and `aria-label` attributes and
  bridge responses, at 1360×860 and 900×600 in Chalk and Carbon, with keyboard
  focus and unchanged fixture bytes and journal after restoring the files.

## Done when

A settings file shows only documented setting names and says when others exist;
a hook shows its documented event, handler type, whether a matcher applies, its
script status and the file that arms it; a malformed file reports a problem
without quoting it. No synthetic sentinel reaches a public envelope, visible
text or tooltip, and healthy entries beside the malformed ones stay listed.

## Implementation and evidence

The allowlists were compared mechanically with the markdown sources of the
settings, hooks and MCP references on 2026-09-15: 161 settings-file names, 33
events, 5 handler types, no duplicates or omissions. `kinds.ts`, `workspace.ts`,
`mutations.ts`, `boundary.test.ts` and `src/ui/` needed no edits: the root fix in
`describe` covers the journal, registry and `.mcp.json` parsers, and the
compiler found no other consumer.

- The workspace sentinel test, copied into a temporary detached worktree at
  `667e9aa`, failed with leaked matchers, command arguments, script paths, the
  unknown event, the MCP type, the top-level name and parser snippets from the
  malformed settings, `.mcp.json` and journal files. It passes on this branch.
- `npm test`: 42 files, 731 passed, 14 skipped (the existing Windows file-symlink
  skips). Typecheck, lint, the staged guards and their self-test pass;
  `git diff --check` is clean.
- `npm run build` passes, and `npm run test:e2e` passes 27/27 on the final code.
  With `KONDO_E2E_SHOTS`, the new case produced 32 screenshots under
  reduced-motion emulation (Chalk and Carbon, 1360×860 and 900×600, each page's
  top and its changed section); all were read. They show events, handler types,
  matcher presence, `? cannot check`, `! not found` and `? not recognized`
  statuses, documented setting names with the unlisted-settings sentence, and
  the fixed parse message, without overflow.
- Focus: the page heading shows its ring in the Library captures at both sizes
  and in the Carbon technical-details captures. The Chalk technical-details
  captures at 1360×860 show no distinguishable ring, although the active
  element's computed outline check passed. 117 changes no focus styling; this
  was not investigated further.
- Left unchanged: `readPluginInventory` (`user-store.ts:520`) still names an
  invalid `installed_plugins.json` key in its `parse-failed` message. That
  manifest is plugin machinery rather than settings, outside this projection
  chain.
- No Impeccable detector pass ran: the tool is not available in this session.
