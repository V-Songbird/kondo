# Plan: MCP approval and disable scopes

Status: **in progress**

Kondo lists MCP declarations from `~/.claude.json` and `<project>/.mcp.json`,
but reads their on/off state from lists Claude Code no longer consults for that
purpose and skips sources Claude honours. The 2026-09-07 publication audit found
a server rejected only in a project's `.claude/settings.local.json` reading as
on (A12), and a registered project holding only `.mcp.json` missing from the
inventory (A13). This plan reconciles the reader, the capability rows and the
toggle plans with Claude Code's current conventions, inside ADR-0002's boundary
and with every settings edit still refused (098,
[ADR-0010](../adr/0010-splice-config-files-never-whole-file-writes.md)).

## Verified Claude Code conventions

Read from the Claude Code 2.1.271 native binary; the trust gate, the switch and
the migration below also occur in the 2.1.269 and 2.1.270 binaries. Checked
against the [MCP guide](https://code.claude.com/docs/en/mcp),
[settings](https://code.claude.com/docs/en/settings),
[settings reference](https://code.claude.com/docs/en/settings-reference) and
[managed MCP](https://code.claude.com/docs/en/managed-mcp) pages on 2026-09-15.

1. **Declarations.** `user`: `mcpServers` of `~/.claude.json`. `local`:
   `projects[<path>].mcpServers` of the same file. `project`: `mcpServers` of
   `<path>/.mcp.json`. When one name is declared in several, Claude uses the
   whole entry from local, then project, then user; plugin servers, claude.ai
   connectors and managed `managedMcpServers` also take part, and Kondo lists
   none of them.
2. **The per-project switch.** A `/mcp` toggle writes
   `projects[<path>].disabledMcpServers` in `~/.claude.json` for any server
   name, user scope included; Claude's own guidance string says the toggle
   "applies to the current project only" even for a user-scope server. The name
   is compared exactly. `enabledMcpServers` is only for built-in servers that
   default to off. `claude mcp list` shows
   `⊘ Disabled for this project (re-enable via /mcp)`.
3. **Approval of `.mcp.json` servers.** `enableAllProjectMcpServers`,
   `enabledMcpjsonServers` and `disabledMcpjsonServers` are settings keys; the
   approval dialog writes them to the project's `.claude/settings.local.json`.
   Claude decides:
   - `rejected` when any settings file's `disabledMcpjsonServers` names the
     server;
   - in a trusted workspace (`projects[<path>].hasTrustDialogAccepted` is
     `true`), `approved` when the merged `enabledMcpjsonServers` names it or the
     merged `enableAllProjectMcpServers` is `true`;
   - in an untrusted one, `approved` only through user settings, managed or
     `--settings` sources, or a local settings file git does not track; the
     project's `.claude/settings.json` is ignored;
   - otherwise `pending` (`⏸ Pending approval`). `-p`, SDK and cloud sessions
     load a pending server without asking.

   Names in these keys match after Claude's normalization: every character
   outside `[a-zA-Z0-9_-]` becomes `_`.
4. **Legacy approval lists.** Older versions kept the same three keys in
   `projects[<path>]` of `~/.claude.json`. 2.1.271 does not consult them there.
   At startup in that project it merges them into `.claude/settings.local.json`
   (a `true` `enableAllProjectMcpServers` only where the local file states
   none), then deletes them from the registry; it defers while that file has
   validation errors.
5. **Lists merge.** A list key set in several settings files combines; a scalar
   follows managed > `--settings` > local > project > user.
6. **Restrictions.** `deniedMcpServers` and `allowedMcpServers` may sit in any
   settings file and merge from every scope. A deny entry matches an exact
   `serverName`, an exact `serverCommand`, or a `serverUrl` with `*` wildcards,
   and nothing overrides it. An allowlist, once present, blocks what it does not
   match. `allowManagedMcpServersOnly` and `managed-mcp.json` are managed-only.
7. **Settings sources.** Claude reads user (`~/.claude/settings.json`), project
   (`.claude/settings.json`), local (`.claude/settings.local.json`),
   `--settings` and managed sources. The user source is one file, so there is
   no user-level `settings.local.json`.

None of these is a connection state. Claude health-checks approved servers
separately, and Kondo never starts or contacts a server.

## Compatibility range

Supported: the behaviour of Claude Code 2.1.269 through 2.1.271, and the
documented behaviour on 2026-09-15, which dates trust-gated approvals to 2.1.196
and `managedMcpServers` to 2.1.259. A registry written by an older version is
read through item 4's legacy lists. A later shape Kondo does not recognize is no
statement (ADR-0005).

## What Kondo can establish

One status per declaration in one place: the user scope, or one project.

| Status | When | It does not mean |
|---|---|---|
| `configured` | a user or local declaration that nothing Kondo reads switches off or blocks | that Claude connects |
| `approved` | a `.mcp.json` declaration that an approval Claude honours here lets load | that Claude connects |
| `pending` | a `.mcp.json` declaration that no readable source approves | that it never loads |
| `rejected` | a readable `disabledMcpjsonServers` names it | — |
| `disabled` | this project's `disabledMcpServers` names it | — |
| `restricted` | a readable `deniedMcpServers` entry names it by `serverName` | — |
| `overridden` | a higher-precedence declaration with the same name exists here | — |
| `unknown` | a positive answer depends on something Kondo cannot read | — |

The first match wins, in this order: `overridden`, `restricted`, `rejected`,
`pending`, `disabled`, `unknown`, then `approved` or `configured`. The order
follows `claude mcp list`, which shows a pending server as pending even when it
is disabled. `unknown` only replaces a positive answer, when:

- a settings layer or the registry exists but could not be read;
- a readable layer holds `allowedMcpServers` or a URL or command deny entry,
  whose patterns Kondo does not evaluate;
- an untrusted project's only approval sits in its local layer, because git
  tracking is outside ADR-0002.

Documented rather than guessed: managed settings and `managed-mcp.json`,
`--settings`, approvals a running session holds in memory, environment
variables, and plugin, claude.ai and built-in servers.

## Scope

Workspace:

- `scanMcpServers` evaluates each declaration against the registry entry and
  the user, project and local settings layers of its place. `.mcp.json` is read
  by exact name for every present project that has a registry entry or a
  `.claude` directory. `verifyProjects` in `workspace.ts`, which resolves the
  mutation stores, is unchanged.
- `inheritedMcpServers` evaluates the user-scope declarations for one project.
- `mcpCapabilities` is the per-project switch: `disable` while the project's
  list does not name the server, `enable` while it does. Both are refused for a
  gone project, an overridden declaration or an unreadable registry. The user
  row refuses both on Global, with the corrected reason.
- `mcpTogglePlan` splices `projects[<path>].disabledMcpServers` for local,
  project and inherited user declarations; an inherited one names its project
  in `targetId`. Execution stays refused.

Renderer:

- Projects → Connections shows each declaration's status and reason, adds the
  user-scope servers a project inherits, and offers no switch. One visible
  sentence says switching edits Claude's settings, which Kondo cannot do yet,
  and that `/mcp` in Claude Code does it.
- Library shows the same statuses and no control.

Docs: domain.md's MCP rows with markers, ADR-0006 for the scope model, ADR-0022
for what the status carries across the seam.

## Out of scope

- Lifting 098.
- Planning approvals or rejections: approving a committed server is a trust
  decision Claude gates behind its own prompt.
- Evaluating allowlists and URL or command deny patterns, and managed policy.
- Plugin, claude.ai, built-in and `--mcp-config` servers, and
  `enabledMcpServers`.
- A `.mcp.json` above the project root: Kondo opens `<project>/.mcp.json` only.
- Telling an unreadable project path from a gone one (135).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The toggle is `/mcp`'s switch, `projects[<path>].disabledMcpServers`, for every scope | Claude consults that list for every server name. The previous project-scope target, the registry's `disabledMcpjsonServers`, is a legacy approval list Claude no longer reads there |
| 2 | Approval is read, never planned | Approving a committed `.mcp.json` server is the security prompt Claude shows itself |
| 3 | Trust is `hasTrustDialogAccepted` on the project's own registry entry | Claude keys project config and trust by the same workspace path, and a Kondo project is that key |
| 4 | Legacy registry approval lists read as the project's local layer | That is what Claude's startup migration turns them into |
| 5 | A user-scope server is switched per project, from the project page | The switch lives in each project's entry; this mirrors the inherited global skill (entry 062) |
| 6 | One status per declaration in one place, with a reason sentence built in main | One chip reads like `claude mcp list`, and the reason names the file to edit (ADR-0022) |
| 7 | Only `serverName` deny entries are evaluated; other restriction rules make a positive status `unknown` | Exact name matching is documented; URL and command matching details are not verified |
| 8 | Unreadable input never reads as on or off | ADR-0005, and this entry's invariant |
| 9 | `.mcp.json` of a present registered project is read without widening the mutation stores | A13. ADR-0002 already names the file; only `.claude` directories are stores |
| 10 | An overridden declaration offers no switch | The list is by name, so the switch would change the declaration Claude uses |
| 11 | Projects and Library show no MCP switch while 098 holds; the matrix keeps Claude's conventions | ADR-0010 separates convention from execution, and a dead control explains nothing |
| 12 | No user-level `settings.local.json` is read | Claude's user source is one file |

## Seam changes

- New `McpServerStatus`; `McpServerInfo.status` and `statusReason` replace
  `enabled`.
- New `InheritedMcpServerState`; `ProjectDetail.inheritedMcpServers`.
- `MutateRequest.targetId` also names the project of an inherited MCP switch.

Recorded in ADR-0006 and ADR-0022.

## Tests

- `test/mcp.test.ts`, native scope fixtures: a user declaration and user
  settings layer; a trusted project whose `settings.json` and
  `settings.local.json` reject and approve `.mcp.json` servers beside a healthy
  sibling; an untrusted project whose local approval reads `unknown` and project
  approval `pending`; a registered present project holding only `.mcp.json`; a
  `disabledMcpServers` entry switching an inherited user server off; a
  same-name local declaration; a `serverName` deny entry; an allowlist; a
  malformed local layer. Asserts the statuses and reasons, A12 and A13, the
  capability directions, each toggle plan's splice target, the 098 refusal with
  fixture bytes and journal unchanged, and no env or header name in any
  envelope.
- `test/boundary.test.ts`: a registered project with `.mcp.json` and decoys but
  no `.claude`; the pinned outside list gains exactly its root, its `.claude`
  stat and its `.mcp.json`.
- `test/projects-home.test.ts`: a storeless project's detail lists its
  `.mcp.json` declarations, and a project page lists inherited user servers
  with their status there.

## Done when

For each MCP declaration, a project page and the Library say whether Claude
Code uses it there, why not, or that Kondo cannot tell, without suggesting that
the server connects. A project holding only `.mcp.json` shows its servers, and
no control invites a change Kondo would refuse.
