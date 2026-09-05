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

- **Projects first** — one row per project Claude knows about, the global
  store above them, and for the one you pick a page with everything attached
  to it: skills, plugins, hooks, agents, commands, rules, MCP servers,
  settings files, sessions. Throwaway runs and projects whose folder is gone
  fold away behind a count.
- **Sessions** — one inventory across every store: Claude Code's
  `~/.claude/projects` and the desktop app's session directories. See per
  project how many sessions exist, how large they are, which are stale,
  empty, orphaned, deleted on the desktop side, or duplicated — the same
  session id held in both stores, or two sessions of one project opening
  with near-identical prompts. Pick any set and move it to kondo's trash in
  one undoable step. (Worked time is still on the roadmap, not in the build.)
- **Skills** — global and per-project, with what `skillUsage` says about
  each. Disable with Claude's own `skillOverrides` switch, move a skill
  between scopes or from one project to another, and thin out a skill kept
  twice once its copies prove identical.
- **Plugins** — what is installed, from which marketplace, at which version,
  enabled where. Toggle globally or per project; hand one from one scope to
  another as a single undoable edit.
- **Agents, commands, rules, output styles** — listed per scope, movable
  between scopes the way a skill is.
- **Hooks** — every hook that will fire, which settings file arms it, and
  whether the script it names is still there.
- **MCP servers** — user, project and `.mcp.json` declarations, read-only.
- **Settings** — the layered view: user, project, local. See what wins and why.
- **Clean up** — reclaim space by category: throwaway folders, projects that
  are gone, old and empty conversations, conversations the desktop app
  deleted, leftover session folders and snapshots, caches Claude rebuilds,
  old plugin versions and residue, hook scripts nothing runs. Preview first;
  one undoable step.
- **Leftovers** — dead lines in Claude's configuration files: registry
  entries and MCP declarations for folders that no longer exist, plugin
  switches for plugins no longer installed, skill settings for skills no
  scope ships. Spliced out byte-exactly, undoable.
- **History** — every change kondo made, with Undo beside each, and the
  trash's size. Kondo never hard-deletes until you empty the trash.

## Principles

1. **Local-first, zero network.** No telemetry, no sync, no phoning home.
2. **Read-only by default.** Every mutation is explicit, journaled, and
   reversible ([ADR-0001](docs/adr/0001-mutations-are-reversible.md)).
3. **Native conventions over invented state.** Disabling a skill writes
   Claude's own `skillOverrides` key; toggling a plugin edits `enabledPlugins`
   in the right settings file. Kondo keeps no shadow database of your intent
   ([ADR-0006](docs/adr/0006-native-conventions-over-invented-state.md)).
4. **Project privacy boundary.** Claude-only files, nothing else
   ([ADR-0002](docs/adr/0002-project-privacy-boundary.md)).
5. **Cross-platform from day one.** Windows, macOS, Linux
   ([ADR-0003](docs/adr/0003-store-locator.md)).

## Status

Pre-release, v0.5. Everything above ships and has been run against a real
store of 11,517 projects and 1.6 GB of transcripts. Installers are built by
CI from a version tag and published as drafts a person promotes
([docs/release.md](docs/release.md)). What comes next is in
[ROADMAP.md](ROADMAP.md).

## Install

Packaged builds — an NSIS installer for Windows, a DMG for macOS, an AppImage
for Linux — are attached to each
[GitHub Release](../../releases). They are **unsigned** for now
([ADR-0011](docs/adr/0011-unsigned-releases-for-now.md)), so:

- **Windows** — SmartScreen will say the publisher is unknown. Choose *More
  info* → *Run anyway*.
- **macOS** — Gatekeeper will refuse the first open. Right-click the app and
  choose *Open*, or allow it under *System Settings → Privacy & Security*.
- **Linux** — `chmod +x Kondo-*.AppImage` and run it.

Kondo makes no network request of any kind, so nothing checks in after
install; updates are a new download.

## Getting started from source

Requires Node 22+ (an `.nvmrc` is provided; `fnm use` or `nvm use` picks it up).

```bash
npm install
npm run dev        # launch the app with hot reload
npm test           # run the test suite
npm run typecheck  # strict TypeScript across app and electron
npm run build      # typecheck + production build
npm run test:e2e   # the built app, launched against a fixture store and driven
npm run package    # unsigned installers under release/ (electron-builder)
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
