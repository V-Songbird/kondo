<img src="src/assets/kondo-mark.svg" width="56" height="56" alt="">

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

- **Library** — the starting screen. Find a skill, plugin or connection by
  name or type, understand its locations, and open the matching management
  section in a project. Return to the same item and search afterwards.
  Technical details and findings remain available when needed.
- **Projects** — choose All projects for shared configuration or a specific
  project for its own settings. Start with an overview, then focus on skills,
  plugins, connections, other tools, conversations or technical details.
  Throwaway runs and projects whose folder is gone fold behind a count.
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
- **MCP servers** — locally configured connections and the on/off controls
  their scope supports. Kondo does not test live connectivity or approval.
- **Settings** — the layered view: user, project, local. See what wins and why.
- **Clean up** — review files and caches, settings leftovers, or duplicate
  skills. File categories include saved Claude data for throwaway folders, projects that
  are gone, old and empty conversations, conversations the desktop app
  deleted, leftover session folders and snapshots, caches Claude rebuilds,
  old plugin versions and residue, hook scripts nothing runs. Select, review,
  then move to trash in one undoable step. Disk space is freed only when the
  trash is permanently emptied.
- **Settings leftovers**, inside Clean up — entries flagged in Claude's configuration: registry
  entries and MCP declarations for folders that no longer exist, plugin
  switches for plugins no longer installed, skill settings for skills no
  scanned location supplies. Review the evidence before removing them;
  supported changes are spliced out byte-exactly and undoable.
- **History** — every change kondo made, with Undo beside each, and the
  trash's size. Kondo never hard-deletes until you empty the trash.
- **Themes** — six Signal appearances: Chalk (the default), Parchment, Sage,
  Slate, Carbon and Signal Original. Choose a visual preview; Kondo remembers
  your preference on this computer.

## Principles

1. **Local-first, zero network.** No telemetry, no sync, no phoning home.
2. **Read-only by default.** Every Claude-store mutation is explicit, journaled, and
   reversible ([ADR-0001](docs/adr/0001-mutations-are-reversible.md)).
3. **Native conventions over invented state.** Disabling a skill writes
   Claude's own `skillOverrides` key; toggling a plugin edits `enabledPlugins`
   in the right settings file. Kondo keeps no shadow database of your intent
   ([ADR-0006](docs/adr/0006-native-conventions-over-invented-state.md)).
4. **Project privacy boundary.** Claude-only files, nothing else
   ([ADR-0002](docs/adr/0002-project-privacy-boundary.md)).
5. **Platform-aware stores.** Windows, macOS and Linux locations
   ([ADR-0003](docs/adr/0003-store-locator.md)); verified coverage is listed below.

## Status

Pre-release, v0.5. The current UX workflow has passed Windows validation using
synthetic stores; see the [implementation and evidence](docs/plans/2026-09-06-ux-workflow.md)
and the preceding [Claude Code review](docs/plans/2026-09-06-claude-usability-review.md)
for remaining release work. Installers are built by
CI from a version tag and published as drafts a person promotes
([docs/release.md](docs/release.md)). What comes next is in
[ROADMAP.md](ROADMAP.md).

## Install

Packaged builds are attached to each [GitHub Release](../../releases):

| Platform | Architecture | Artifact |
|---|---|---|
| Windows | x64 (Intel/AMD 64-bit) | NSIS installer, `Kondo Setup <version>.exe` |
| macOS | arm64 (Apple silicon only) | DMG, `Kondo-<version>-arm64.dmg` |
| Linux | x64 (Intel/AMD 64-bit) | AppImage, `Kondo-<version>.AppImage` |

The DMG does not support Intel Macs. Windows/Linux ARM builds are not provided.

Platform coverage: Windows x64 has recorded local fixture validation of the UI and installed NSIS app. macOS arm64 and Linux x64 have no recorded manual validation. Release CI requires packaged smoke checks before upload; a green run verifies the installed Windows app, Linux AppImage in extract-and-run mode, and macOS app bundle. DMG installation, Gatekeeper, and Linux FUSE mounting remain unverified.

See the recorded [Windows UI validation](docs/plans/2026-09-06-ux-workflow.md#validation-2026-09-06)
and [17 installed-app smoke checks](docs/plans/080-release-artifact-smoke.md#observed-verification).
Configured CI gates alone do not establish a successful run; the
[release procedure](docs/release.md) describes the required rehearsal.

Builds are **unsigned** for now
([ADR-0011](docs/adr/0011-unsigned-releases-for-now.md)). After checking the
download against `SHA256SUMS` below, proceed only if you trust the release:

- **Windows** — run the NSIS installer. If SmartScreen shows an unknown
  publisher warning and offers it, choose *More info* → *Run anyway*.
- **macOS** — open the DMG and copy Kondo to Applications. Try opening it,
  then, if the developer cannot be verified, use *System Settings → Privacy
  & Security → Open Anyway* and confirm *Open*
  ([Apple's instructions](https://support.apple.com/en-us/102445)). If a trusted
  download is still blocked by quarantine, run
  `xattr -dr com.apple.quarantine "/Applications/Kondo.app"` in Terminal, then
  reopen Kondo. This removes the quarantine attribute recursively from that
  app bundle only; it does not sign or notarize it. Do not use this to override
  a malware warning.
- **Linux** — in the download directory, run `chmod +x Kondo-*.AppImage`, then
  `./Kondo-<version>.AppImage` with the downloaded version substituted. If it
  reports missing FUSE or `libfuse.so.2`, install the FUSE 2 compatibility
  library: `sudo apt install libfuse2` on Ubuntu 22.04, or
  `sudo apt install libfuse2t64` on Ubuntu 24.04. Other distributions use
  different package names; follow the [AppImage FUSE guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

Because they are unsigned, the `SHA256SUMS` asset attached to the same release
is the only thing that tells you a download is the file CI built. Hash what you
downloaded and compare it against that file's line for it:

- **Windows** — `Get-FileHash 'Kondo Setup *.exe' -Algorithm SHA256` in PowerShell.
- **macOS** — `shasum -a 256 Kondo-*.dmg`.
- **Linux** — `sha256sum -c SHA256SUMS --ignore-missing`.

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

Bundled fonts and runtime: [third-party notices](THIRD-PARTY-NOTICES.md).
