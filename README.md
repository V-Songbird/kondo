<img src="src/assets/kondo-mark.svg" width="56" height="56" alt="">

# Kondo

**Keep your Claude tight.**

Kondo is a local-first desktop app that manages the state Claude leaves on your
machine. Claude Code and the Claude desktop app accumulate a lot of it —
thousands of session transcripts, skills scattered across scopes, plugins,
hooks, layered settings files, caches. It piles up silently. Kondo inventories
supported Claude Code data, reports part of Desktop's local storage, and offers
reviewed cleanup within those limits.

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
- **Sessions** — Claude Code transcripts under `~/.claude/projects`, grouped
  by project, with size, activity and cleanup signals. Compare opening prompts
  within a project or see a matching session ID in Desktop's local filenames;
  neither signal proves identical contents. Review selected Code transcripts
  and move them with recognized companion folders and released markers to
  Kondo's trash. Desktop-only sessions have no browsing or removal UI.
  See [session scope and retained data](#session-scope-and-retained-data).
  (Worked time is still on the roadmap, not in the build.)
- **Skills** — global and per-project, with what `skillUsage` says about
  each. Move a skill between scopes when no settings edit is needed, and
  thin out a skill kept twice once its copies prove identical. Settings-based
  enable/disable and moves that also edit settings are temporarily unavailable.
- **Plugins** — what is installed, from which marketplace, at which version,
  enabled where. Toggles, clearing overrides and scope changes are temporarily
  unavailable because they edit settings.
- **Agents, commands, rules, output styles** — listed per scope, movable
  between scopes the way a skill is.
- **Hooks** — read-only declarations from user settings and verified projects'
  project/local settings, with source attribution and limited script checks.
  Kondo does not move, toggle or remove hook declarations, or prove which hooks
  execute. See the [hook boundary decision](docs/plans/109-hook-layer-boundary.md).
- **MCP servers** — locally configured connections and their configured state.
  On/off changes are temporarily unavailable. Kondo does not test live
  connectivity or approval.
- **Settings** — the layered view: user, project, local. See what wins and why.
- **Clean up** — review files and caches, settings leftovers, or duplicate
  skills. File categories include saved Claude data for throwaway folders, projects that
  are gone, old and empty Code conversations, Code transcripts with a Desktop
  released marker, leftover session folders and snapshots, allowlisted caches,
  old plugin versions and residue. Hook scripts are kept because Kondo cannot
  establish that they are unused across all execution sources. Select, review,
  then move to trash in one undoable step. Disk space is freed only when the
  trash is permanently emptied.
- **Settings leftovers**, inside Clean up — entries flagged in Claude's configuration: registry
  entries and MCP declarations for folders that no longer exist, plugin
  switches for plugins no longer installed, skill settings for skills no
  scanned location supplies. Review the evidence; removal is temporarily
  unavailable because it edits settings.
- **History** — changes kondo made, their Undo controls, and the trash's size.
  Historical settings Undo is temporarily unavailable; its journal and
  recovery bytes remain intact. Kondo never hard-deletes until you empty the trash.
- **Themes** — six Signal appearances: Chalk (the default), Parchment, Sage,
  Slate, Carbon and Signal Original. Choose a visual preview; Kondo remembers
  your preference on this computer.

**Settings safety restriction:** on every platform, Kondo refuses the entire
operation before changing files or recording completion if it includes a
settings edit. This also applies to creating a settings file and to historical
settings Undo. Other moves, trash operations and their Undo retain their
existing checks. This prevents Kondo from overwriting a save made by another
application between its final read and replacement; safe settings replacement
is not yet implemented. See [the decision](docs/adr/0010-splice-config-files-never-whole-file-writes.md).

### Session scope and retained data

**Desktop session support is partial and read-only.** Kondo reports local store
metadata and matches filenames to Code session IDs. It does not manage Desktop
sessions or verify their contents. Desktop cache cleanup is a separate, existing
allowlisted operation; it does not remove Desktop session records, VM bundles,
unknown caches or other application state.

**Moving a session to trash does not erase a conversation.** Selected Code
removal moves its transcript, matching companion folder and
`.desktop-released.json` marker when present. These records can remain:

- `history.jsonl` with global prompt history;
- `session-env/` snapshots, which may qualify for a separate later cleanup;
- `file-history/` and `backups/`, which Kondo does not offer for cleanup;
- Desktop records, shared artifacts, exports, cloud copies and OS backups;
- Kondo's trash, journal and scan cache. Trash retains the removed files until
  you empty it; emptying it loses the affected Undo data and does not clear the
  journal or scan cache.

Whole-project Clean up moves the reviewed saved-data directory under
`~/.claude/projects`, so it can include more files than selected-session removal.
It still does not clear the global or external records above. Disk space from
displaced files is reclaimed when trash is emptied; this is not secure erasure.

The current UI's `also in desktop` label means a filename ID match, and
`deleted in desktop app` means a released marker was found beside a Code
transcript. Neither proves that all Desktop or cloud copies are gone. More
precise in-app scope and residual disclosures remain follow-up work in the
[decision package](docs/plans/108-desktop-session-boundary.md), under the accepted
[ADR-0016](docs/adr/0016-desktop-session-boundary.md).

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

### Kondo data and uninstalling

Kondo's own data directory, called `<kondo-data>` in the docs, is separate
from your Claude stores. With no override, it uses Electron's
[`userData` location](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
with the app name **Kondo** (capital K):

| Platform | Default `<kondo-data>` |
|---|---|
| Windows | `%APPDATA%\Kondo` (normally `%USERPROFILE%\AppData\Roaming\Kondo`) |
| macOS | `~/Library/Application Support/Kondo` |
| Linux | `$XDG_CONFIG_HOME/Kondo` when set; otherwise `~/.config/Kondo` |

`~` means your home directory. `KONDO_DATA_ROOT` selects a custom directory
instead, including the Electron profile and single-instance lock. It does
not move data from an earlier location. See the launch examples below.

Claude's desktop data is separate: on Linux, Kondo looks in
`$XDG_CONFIG_HOME/Claude` when that variable is absolute, otherwise
`~/.config/Claude` (including unset, empty or relative values).
`KONDO_DESKTOP_STORE_ROOT` overrides that lookup.

Kondo's data directory holds `journal.jsonl` (mutation history and undo records),
`trash/` (removed files and undo backups, potentially full transcripts or
settings), `appearance.json`, `scan-cache/`, and Electron profile files.
Trash has no automatic expiry. Moving files to Kondo's trash does not free
their disk space; **History → Empty the trash → Empty it permanently** removes
those bytes.

**Normal uninstall leaves this data, including the trash, behind.** The
configured Windows NSIS uninstaller retains app data by default (its explicit
`--delete-app-data` option is an exception). Removing the macOS `.app` or
Linux `.AppImage` removes that application, not the separate data directory.
These statements follow the installer configuration and application layout;
macOS/Linux uninstall behavior has not been manually validated.

To remove retained Kondo data, restore anything you want through History
first, then fully quit Kondo (on macOS, use Quit, not just close the window).
Open the exact directory above in your file manager, or your custom
`KONDO_DATA_ROOT`, verify it is Kondo's directory, and delete only that
directory. Empty the operating system's Recycle Bin/Trash too if you moved
it there and want its contents permanently removed. This loses Kondo's
history, preferences, caches and **all undo data in its trash**; it does not
undo earlier changes to Claude. Check separately for any older custom data
directories you used. Do not delete `.claude`, `.claude.json`, the Claude
desktop store, or the parent application-data directory as part of removing
Kondo's footprint.

### First run against disposable copies

Set all three overrides together, using **absolute, non-empty paths** to
separate disposable directories. They select roots; they do not copy stores,
rewrite embedded paths, or enforce isolation between the chosen directories.
Keep Kondo data outside both Claude stores, and keep the stores separate:

| Variable | Points to |
|---|---|
| `KONDO_STORE_ROOT` | Copied Claude Code `.claude` directory; its `.claude.json` registry belongs beside it, not inside it |
| `KONDO_DESKTOP_STORE_ROOT` | Copied Claude desktop data directory, or a deliberately empty directory if you are only trying Claude Code data |
| `KONDO_DATA_ROOT` | Fresh Kondo data directory for this rehearsal; do not reuse your normal journal/trash |

For example, prepare `home/.claude`, `home/.claude.json`, `desktop`, and
`kondo-data` under one disposable rehearsal directory. Before launching a
copy, remap registry project keys and matching `projects/<flattened-path>`
directory names to disposable project directories. Review other embedded
project paths and symbolic links/junctions too: none may lead back to live
stores or live projects' `.claude` directories. Merely copying `.claude`
and clearing its registry is insufficient, because project resolution can
fall back to paths reconstructed from those directory names.

For a ready-made synthetic example from a source checkout, run
`node .claude/skills/run-kondo/fixture.mjs <absolute-new-rehearsal-directory>`
with a new destination substituted. It creates the layout above, including
disposable projects, and prints the three root values. Use synthetic fixtures
for development and automated tests; never use personal stores in tests.

After the [source setup](#getting-started-from-source), launch from the repo
root. Substitute your prepared directory below. Use a fresh terminal and
quit any Kondo instance using that same data directory first.

**Windows PowerShell** (initialize Node through fnm if you use it):

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
$env:KONDO_STORE_ROOT = 'C:\kondo-rehearsal\home\.claude'
$env:KONDO_DESKTOP_STORE_ROOT = 'C:\kondo-rehearsal\desktop'
$env:KONDO_DATA_ROOT = 'C:\kondo-rehearsal\kondo-data'
npm run dev
```

**macOS/Linux Terminal** (bash/zsh):

```bash
KONDO_STORE_ROOT="/absolute/path/kondo-rehearsal/home/.claude" \
KONDO_DESKTOP_STORE_ROOT="/absolute/path/kondo-rehearsal/desktop" \
KONDO_DATA_ROOT="/absolute/path/kondo-rehearsal/kondo-data" \
  npm run dev
```

For a packaged build, replace only `npm run dev` with the executable launch:
PowerShell `& 'C:\path\to\Kondo.exe'`, macOS
`"/Applications/Kondo.app/Contents/MacOS/Kondo"`, or Linux
`"/absolute/path/Kondo-<version>.AppImage"`. Keep the three assignments;
launching from a desktop shortcut does not apply this shell recipe. Quit
Kondo and close the rehearsal terminal when finished (PowerShell assignments
remain in that terminal for subsequent launches).

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
