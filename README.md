# Kondo

**Keep your Claude tight.**

Kondo is a local-first desktop app that manages the state Claude leaves on your
machine. Claude Code and the Claude desktop app accumulate a lot of it —
thousands of session transcripts, skills scattered across scopes, plugins,
hooks, layered settings files, caches. It piles up silently. Kondo scans all of
it, shows you what you have, and lets you tidy it safely.

Kondo is about Claude's own files, and only those. It **never reads your
project files** — the one exception is a project's `.claude/` directory
(its `settings.json` and other Claude-only files). Everything runs on your
machine; nothing is ever sent anywhere.

## What it does

- **Sessions** — one inventory across every store: Claude Code's
  `~/.claude/projects` and the desktop app's session directories. See per
  project how many sessions exist, how much time you have worked in them, how
  large they are, which are stale, duplicated, empty, or orphaned.
- **Skills** — a single catalog of global and per-project skills. Enable or
  disable without deleting. Move a skill between scopes or from one project to
  another.
- **Plugins** — what is installed, from which marketplace, at which version,
  enabled where. Toggle globally or per project.
- **Hooks** — every hook that will fire, and which settings file arms it.
- **Settings** — the layered view: user, project, local. See what wins and why.
- **Housekeeping** — reclaim space from stale sessions and dead caches. Kondo
  trashes, journals, and can undo. It never hard-deletes.

## Principles

1. **Local-first, zero network.** No telemetry, no sync, no phoning home.
2. **Read-only by default.** Every mutation is explicit, journaled, and
   reversible ([ADR-0001](docs/adr/0001-mutations-are-reversible.md)).
3. **Native conventions over invented state.** Disabling a skill uses Claude's
   own `skills.disabled` convention; toggling a plugin edits `enabledPlugins`
   in the right settings file. Kondo keeps no shadow database of your intent
   ([ADR-0006](docs/adr/0006-native-conventions-over-invented-state.md)).
4. **Project privacy boundary.** Claude-only files, nothing else
   ([ADR-0002](docs/adr/0002-project-privacy-boundary.md)).
5. **Cross-platform from day one.** Windows, macOS, Linux
   ([ADR-0003](docs/adr/0003-store-locator.md)).

## Status

Pre-release. The current build is the **read-only core**: it scans and reports
sessions, skills, plugins, hooks, and settings. Mutations (toggle, move, tidy)
are designed but not yet shipped — see [ROADMAP.md](ROADMAP.md).

## Getting started

Requires Node 22+ (an `.nvmrc` is provided; `fnm use` or `nvm use` picks it up).

```bash
npm install
npm run dev        # launch the app with hot reload
npm test           # run the test suite
npm run typecheck  # strict TypeScript across app and electron
npm run build      # typecheck + production build
```

## Documentation

Start at [docs/README.md](docs/README.md) — it maps every document in this
repo and says where new writing belongs. Highlights:

- [docs/domain.md](docs/domain.md) — the Claude data landscape: every store,
  file, and format kondo touches.
- [docs/foundations.md](docs/foundations.md) — architecture.
- [docs/adr/](docs/adr/) — decisions and their reasons.
- [AGENTS.md](AGENTS.md) — operating manual for humans and AI agents working
  on this codebase.

## Credit

Kondo's architecture builds on patterns proven in
[skilldex](https://github.com/klubinskak/skilldex) (MIT), a skills manager for
AI agents. Kondo generalizes the idea to the whole Claude surface.

## License

[MIT](LICENSE)
