# Glossary

Shared vocabulary. Code, docs, and the definitions below use these words with
exactly these meanings.

## What the UI says instead

The definitions below are kondo's internal vocabulary. A first-time user did
not choose any of them, so the screen shows the right-hand column and the
code keeps the left. This table is the mapping layer between the two: types,
IPC channel names and `shared/contract.ts` fields never move to the right-hand
spelling, and a string a user can read should use the right-hand one. Some
screens still show internal terms, such as Library's `Scope` and `Location`
columns, `Global` for the user scope in Library, and the scope id in a skill's
trash summary; entry 110 reconciles them.

| Internal term | What the UI shows |
| --- | --- |
| Journal | History |
| Tidy sweep | Clean up |
| Delete (kondo displacing a file) | Move to trash |
| Dry run | Preview |
| Sidecar | Session folder |
| Stale session | Untouched N+ days (N from `staleAfterDays` on the seam) |
| Orphan | Leftover |
| Desktop-released session | Conversation deleted in the desktop app |
| Desktop caches (`desktop-caches`) | Caches the desktop app rebuilds |
| Skill duplicate group | Duplicate skills |
| Trash a duplicate copy | Move this copy to trash |
| Settings layer | Settings file |
| Scope | Where it applies |
| Winning / effective layer | In effect |
| Unknown entries | Files kondo did not recognize |
| Global / user scope | All projects |
| Inherited from Global | Shared from All projects |
| Inherit / follows global | Follow shared setting |
| MCP server | Connections (MCP) |
| Session (in project management) | Conversation |
| Effective plugin state | Configured here |

"All projects" names the shared configuration; a project can override it.
"Configured here" and connection listings describe saved settings, not a
runtime connection check. Technical details retain the actual settings file
names and storage identifiers. Conversation numbers label rows within the
current list; the saved ID is available in Conversation details.

- **Store** — a root directory where a Claude product keeps its state. Kondo
  knows three kinds: the *user store* (`~/.claude`, or the Claude profile a
  launch selected), *project stores* (`<project>/.claude`), and the *desktop
  store* (the Claude desktop app's data directory). See
  [domain.md](domain.md).
- **Claude profile** — one Claude Code configuration directory: `~/.claude`, or
  whichever directory `CLAUDE_CONFIG_DIR` or Kondo's `--claude-config-dir`
  names. The UI says "Claude profile" too. One launch reads exactly one, fixed
  before the single-instance lock, and each keeps its own Kondo history
  ([domain.md](domain.md#claude-profiles)).
- **Store adapter** — the main-process module that knows one store kind:
  where it lives per OS, what is inside, how to read it. Adapters return data
  plus per-item errors; they never throw a whole scan away.
- **Scope** — where a thing takes effect: `user` (global), `project`
  (committed, shared), `local` (project, uncommitted). Mirrors Claude Code's
  own settings layering.
- **Session** — one conversation with Claude, identified by a UUID.
- **Transcript** — the JSONL file recording a session's events. A session may
  also own sibling directories (subagent output, memory).
- **Project directory** — under `~/.claude/projects`, one directory per
  working directory Claude Code has been run in, named by flattening the
  path: every character outside `[A-Za-z0-9]` becomes `-`
  (`D:\Projects\my-app` → `D--Projects-my-app`). The real path comes from
  the registry, `~/.claude.json` (ADR-0009).
- **Project key** — that flattened name, the one spelling of a project
  shared by its ids, its store name and its settings layers.
- **Unlocated project** — a project directory whose real path kondo could
  not find in the registry or by guessing. Not evidence the folder is gone,
  so never a dead project; a transcript-less one with no `memory/` and no
  recent activity can still be a scratch project. `location: 'unlocated'`.
- **Dead project** — a project the registry names whose path no longer
  exists on disk. `location: 'gone'` — the failed stat is evidence, which is
  why this and *unlocated project* are separate states and not one flag. The
  tidy sweep offers its `projects/<key>` directory whole, under
  `dead-projects`.
- **Scratch project** — a directory under `projects/` that looks throwaway:
  its known path sits under the OS temp directory or its name carries a
  `.claude-worktrees` or `.claude-jobs` marker, or it holds no transcript, no
  `memory/` and no path Kondo can find. A name alone never makes it removable:
  a marker- or temp-named tree holding `memory/`, recent activity or unreadable
  activity evidence is withheld and counted separately, and so is a
  transcript-less unlocated tree with recent activity. A transcript-less tree
  holding `memory/` is offered nowhere. Offered whole under the tidy sweep's
  `scratch-projects` after review.
- **Category exclusivity** — no store path is offered under two tidy
  categories. The whole-tree categories claim their `projects/<key>`
  directory first and the per-file categories skip everything inside it;
  `scratch-projects` wins over `dead-projects` on a directory that is both.
- **Stale session** — no activity for longer than the staleness threshold
  (30 days, the `STALE_AFTER_DAYS` constant).
- **Empty session** — a zero-byte transcript, the tidy sweep's definition.
  A transcript with lines but no user or assistant message is not yet
  detected.
- **Orphan** — a session's sibling directory, or a desktop-released marker,
  whose transcript is gone.
- **Duplicate** — two sessions judged to be the same work: identical session
  id in two stores (`SessionSummary.mirroredIn`, tier 1), or same project +
  near-identical opening prompt (`sessionNearDuplicates`, tier 2, one project
  at a time). Evidence, never a verdict: kondo groups them and says nothing
  about which to keep.
- **Worked time** — the summed active spans inside a session's transcript
  (gaps above an idle threshold are not counted), not last-minus-first
  timestamp. Defined, not yet computed (ROADMAP, Later).
- **Skill** — a directory with a `SKILL.md` manifest. Lives in the user
  store, a plugin, or a project store.
- **Plugin** — an installed package from a marketplace, recorded in
  `installed_plugins.json`, enabled via `enabledPlugins` in settings.
- **Marketplace** — a source repository plugins are installed from.
- **Hook** — a command Claude Code runs on an event, armed by a `hooks` entry
  in some settings layer. A script file under a `hooks/` directory is not a
  hook until a settings entry names it.
- **MCP server** — a Model Context Protocol server declared for Claude: at
  user scope in `~/.claude.json`, at project scope in `<project>/.mcp.json`,
  or locally for one project in `~/.claude.json`'s `projects` map. Kondo lists
  their declarations under Connections; its on/off switches are refused while
  settings edits are suspended (098), and it does not check runtime
  connectivity or approval.
- **Agent / command / rule / output style** — the other things a scope can
  hold beside skills: `agents/*.md`, `commands/*.md`, `rules/*.md`,
  `output-styles/*.md` under `~/.claude` or `<project>/.claude`. Kondo lists
  these under Other tools, with moves where supported. Output styles are
  listed in All projects.
- **Registry** — `~/.claude.json`, Claude Code's own record of projects,
  MCP servers and usage (ADR-0009).
- **Bridge / seam** — the context-isolated preload API; the only door between
  renderer and disk.
- **Journal** — kondo's append-only record of every mutation it performs,
  holding enough to undo each one.
- **Kondo trash** — where "deleted" files actually go; emptying it is the
  only destructive act kondo has, and it is explicit.
