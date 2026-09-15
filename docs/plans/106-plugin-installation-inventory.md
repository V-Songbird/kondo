# Plan: every plugin installation and component layout

Status: **in progress**

Kondo reads `installed_plugins.json` and keeps only the first record of each
entry, so a plugin installed at two scopes or in two versions shows one of them
and hides the rest. It reads plugin-shipped skills from `<install>/skills`
alone, so a plugin that ships its components through a manifest path, through
`commands/`, or as a skills-directory plugin looks skill-less. This slice
replaces first-record selection with a full inventory, reads every component
layout Claude Code 2.1.271 documents for skills and commands, and itemizes what
it cannot read instead of answering empty.

## Verified record shape

Read off the Claude Code 2.1.271 binary on this machine
(`~/.local/share/claude/versions/2.1.271`), whose Zod schema for the version-2
file carries its own field descriptions:

| Field | Type | The binary's own description |
|---|---|---|
| `scope` | `"managed" \| "user" \| "project" \| "local"` | Installation scope |
| `projectPath` | string, optional | Project path (required for project/local scopes) |
| `installPath` | string | Absolute path to the versioned plugin directory |
| `version` | string, optional | Currently installed version |
| `installedAt` | string, optional | ISO 8601 timestamp of installation |
| `lastUpdated` | string, optional | ISO 8601 timestamp of last update |
| `gitCommitSha` | string, optional | Git commit SHA for git-based plugins |
| `resolvedVersion` | string, optional | Tag-derived semver this install resolved to |
| `auto` | boolean, optional | True when pulled in as a dependency |

The file is `{ version: 2, plugins: { <id>: <entry>[] } }`. A version-1 file is
`{ version: 1, plugins: { <id>: <entry> } }` — one record, not an array — and
Claude Code converts it on load ("Loaded and converted N plugins from V1
format"). The same build also knows a second filename, `installed_plugins_v2.json`.

This machine's own store holds five entries, every one `scope: "user"` with a
single record, so multi-scope and multi-version shapes are covered by fixtures
rather than by observation.

## Verified component layouts

The manifest is `<plugin root>/.claude-plugin/plugin.json`. The same binary
describes each component field, and the sentences below are its own:

| Manifest field | Default | Rule |
|---|---|---|
| `skills` | `skills/` | "Loaded in addition to the skills/ directory" — **additive** |
| `commands` | `commands/` | "When set, the commands/ directory is not auto-loaded" — **replaces** |
| `agents` | `agents/` | "When set, the agents/ directory is not auto-loaded" — replaces |
| `outputStyles` | `output-styles/` | "When set, the output-styles/ directory is not auto-loaded" — replaces |
| `hooks` | `hooks/hooks.json` | "additional hooks (in addition to those in hooks/hooks.json, if it exists)" — additive |

A `skills` entry is a "path to a skill directory, relative to the plugin root
(`.` / `./` denote the plugin root itself)". A `commands` entry is a "path to a
command file or skill directory, relative to the plugin root". Both accept a
single string or an array of strings; `commands` also accepts an object mapping
command names to `{ source }` or `{ content }`.

The build recognises a directory as plugin-shaped when it holds
`.claude-plugin/` or "a `commands/`, `skills/`, `agents/`, `hooks/`, `themes/`,
`output-styles/`, `monitors/`, `workflows/`, `SKILL.md`, `.mcp.json`, or
`.lsp.json` at the top level".

A **skills-directory plugin** is any folder under a skills directory that holds
`.claude-plugin/plugin.json`; it loads as `<name>@skills-dir` with no
marketplace and no installation record. The two skills directories are
`~/.claude/skills/` and `<project>/.claude/skills/`, the second only in a
trusted workspace. The build skips such a folder as a skill
("`[skills] skipping <dir>: .claude-plugin/plugin.json is not a regular file or
exceeds <n>`"), so a folder is a plugin **or** a skill, never both.

## Scope

**Workspace.** `firstInstall` goes. `readPluginInventory` keeps validating
records as it does today and additionally carries `projectPath`, so
`scanPlugins` can build a `PluginInstallation[]` per plugin — every record, by
scope, project, version and install path, each with its own confinement
verdict. The displayed version, scope and timestamps become a documented
projection over that array rather than array position. `scanPlugins` also
discovers skills-directory plugins under the user store and each verified
project store. `scanPluginSkills` reads, per followed installation: the default
`skills/`, every additive manifest `skills` path, and either the manifest's
`commands` paths or the default `commands/`.

**Seam.** `PluginInfo` gains `installations` and `source`; `ProjectPluginState`
gains the same two, so the project page attributes a plugin exactly as the
Library does. Recorded in [ADR-0023](../adr/0023-a-plugin-is-its-installations.md).

**Renderer.** The Library's plugin page lists every installation and, per
installation, the skills it ships. The plugin's own catalogue row states how
many installations there are when there is more than one. The project page's
plugin rows carry the same installation facts.

## Out of scope

- Agents, output styles, hooks, MCP servers, LSP servers, themes, monitors and
  workflows a plugin ships. This slice inventories installations and the two
  component layouts that produce *skills*.
- Version-1 `installed_plugins.json` and `installed_plugins_v2.json`. Kondo
  keeps reporting a non-2 version as unsupported and establishing no absence
  from it. Recorded as a finding for the roadmap.
- `resolvedVersion`, `gitCommitSha` and `auto`. Read but not surfaced; `auto`
  in particular would change what the residue sweep may offer, which is its own
  decision.
- The object form of `commands` and its inline `content`. Itemized as an
  unsupported source rather than read.
- Enabling, disabling or moving a skills-directory plugin's own files. Plugin
  components stay read-only, as they are today.
- `pluginStateIn` and the `enabledPlugins` layer reading, which entry 129 owns.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep every validated record in `PluginInfo.installations`, ordered by scope rank (`managed`, `user`, `project`, `local`), then project path, then version, then install path | Array position is not an ordering Claude promises; a stated order makes the same store produce the same page twice, and a record can no longer hide another |
| 2 | The displayed version, scope and timestamps are `installations[0]` under that order | The row still shows one plugin, and which record it shows is now a rule a reader can check rather than a file's write order |
| 3 | An install path that escapes the user store keeps its record, with `followed: false` | The record is a fact of the manifest; dropping it would make a plugin look less installed than it is. ADR-0005 |
| 4 | Skills-directory plugins carry `source: 'skills-dir'` and an empty `installations` | They are installed without an installation record, so an empty array is the truth; the flag is what keeps "no records" apart from "no plugin" |
| 5 | A skills directory that holds `.claude-plugin/plugin.json` is a plugin and not a skill, in the Skills tab too | Claude Code skips it as a skill; listing it in both places would offer a move on files that belong to a plugin |
| 6 | Tier-1 project counts still count such a folder as a skill | Counting by `readdir` alone is ADR-0007's bargain; domain.md already records the one tier-1/tier-2 disagreement and this joins it |
| 7 | The read boundary for a plugin's components is the install root, not the user store | Claude Code refuses a component path that "escapes plugin directory"; the tighter boundary matches it and costs nothing |
| 8 | An unreadable manifest, an unsupported `commands` shape and an unresolvable component path each become a `Scan.errors` item with a fixed sentence | ADR-0005 itemizes beside partial data, and ADR-0022 forbids parser text crossing the seam |
| 9 | Two sources shipping the same skill name resolve to one row, first under the documented order | Claude Code itself skips a duplicate ("same file already loaded from"), and an id has to be unique |
| 10 | `commands` reads flat `*.md` from a directory, or the directory itself when it holds a `SKILL.md`, or a single named `.md` file | The binary calls an entry "a command file or skill directory"; both readings are cheap, and covering both is what keeps a silent empty from standing in for an unread layout |

## Seam changes

`shared/contract.ts`:

- `PluginInstallScope` — Claude's four scopes as a union.
- `PluginInstallation` — one validated record: `scope`, `projectPath`,
  `version`, `installedAt`, `lastUpdated`, `installPath` (display, always) and
  `followed` (whether kondo may read it).
- `PluginSource` — `'record' | 'skills-dir'`.
- `PluginInfo.installations: PluginInstallation[]` and `PluginInfo.source`.
- `ProjectPluginState.installations` and `ProjectPluginState.source`.

No call signature changes. `PluginInfo`'s existing scalars stay, now documented
as the projection Decision 2 describes.

## Tests

`test/plugin-skills.test.ts`

- A plugin installed twice lists the skills of both installations, and a skill
  name shipped by both appears once.
- The default `skills/` and a manifest `skills` path both list, additively.
- A manifest `commands` path replaces the default `commands/`: a skill under
  the named path lists and one under `commands/` does not.
- With no manifest, `commands/*.md` list as command-backed skills.
- A `commands` entry naming a single `.md` file lists that one skill.
- A `commands` entry naming a directory that holds `SKILL.md` lists it once.
- An unreadable `plugin.json` yields an itemized error whose message contains
  no parser text and no file content, and the default `skills/` still lists.
- The object form of `commands` yields an itemized unsupported-source error
  rather than an empty list.
- A manifest path pointing outside the install root is refused, reported, and
  never read — asserted against the `readdir` calls.
- A skills-directory plugin under the user store lists its own skills.

`test/plugin-toggle.test.ts`

- A plugin installed at user and project scope reports both installations with
  their own versions and install paths, in the documented order.
- Its displayed version and scope are the first under that order, whichever way
  round the file lists the records.
- A skills-directory plugin appears in `pluginsList` with `source: 'skills-dir'`,
  no installations, and the same three-position control per scope.

`test/kinds.test.ts`

- `projectPluginStates` carries the same `installations` the Library row does,
  for the same plugin.
- A skills-directory plugin's folder is not in `skillsList`.

`test/tidy.test.ts`

- The existing multi-scope sweep still protects every registered install path
  (the regression this slice must not break).
- A plugin whose records include one escaping path still protects the paths
  that do not escape.

## Done when

The Library lists each plugin once, names every place it is installed with that
installation's own version and scope, and shows the skills each installation
ships from the default directory, a manifest path or a commands directory
alike. A plugin whose manifest kondo cannot read still lists the skills it can
find and says, in the same view, what it could not read. A plugin that ships
its skills through a skills directory appears as a plugin rather than as a
stray skill. A project page names the same installations the Library does. No
residue sweep offers a directory any installation record names.
