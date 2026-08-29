# Glossary

Shared vocabulary. Code, docs, and UI use these words with exactly these
meanings.

- **Store** — a root directory where a Claude product keeps its state. Kondo
  knows three kinds: the *user store* (`~/.claude`), *project stores*
  (`<project>/.claude`), and the *desktop store* (the Claude desktop app's
  data directory). See [domain.md](domain.md).
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
  path (`D:\Projects\x` → `D--Projects-x`).
- **Stale session** — no activity for longer than the staleness threshold
  (30 days in v0.1, the `STALE_AFTER_DAYS` constant; a user-configurable
  threshold is planned).
- **Empty session** — a transcript with no user or assistant message.
- **Orphan** — session residue whose owner is gone: a sibling directory with
  no transcript, or a transcript whose project directory no longer maps to an
  existing working directory.
- **Duplicate** — two sessions judged to be the same work: identical session
  id in two stores, or same project + near-identical opening prompt.
- **Worked time** — the summed active spans inside a session's transcript
  (gaps above an idle threshold are not counted), not last-minus-first
  timestamp.
- **Skill** — a directory with a `SKILL.md` manifest. Lives in the user
  store, a plugin, or a project store.
- **Plugin** — an installed package from a marketplace, recorded in
  `installed_plugins.json`, enabled via `enabledPlugins` in settings.
- **Marketplace** — a source repository plugins are installed from.
- **Hook** — a command Claude Code runs on an event, armed by a `hooks` entry
  in some settings layer.
- **Bridge / seam** — the context-isolated preload API; the only door between
  renderer and disk.
- **Journal** — kondo's append-only record of every mutation it performs,
  holding enough to undo each one.
- **Kondo trash** — where "deleted" files actually go; emptying it is the
  only destructive act kondo has, and it is explicit.
