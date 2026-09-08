# Security

## Threat model

Kondo reads and mutates the most sensitive directories a Claude user has:
full session transcripts, prompt history, settings including environment
variables, the `~/.claude.json` registry (MCP server declarations with their
`env`, account identity), and plugin code. The design treats that as the
primary risk:

- **No network.** Kondo makes no outbound requests. There is no telemetry, no
  update ping, no crash reporting. Anything that changes this requires an ADR
  and a visible opt-in.
- **Renderer sandbox.** The UI process has no Node.js or filesystem access. It
  talks to disk only through a context-isolated preload bridge exposing a
  small, typed, validated API. A compromised renderer (e.g. via a malicious
  string rendered from a transcript) cannot read arbitrary files.
- **Path confinement.** Main-process store adapters resolve paths through a
  single locator and refuse to operate outside the known Claude stores. No IPC
  channel accepts a free-form path from the renderer.
- **Reversible writes.** Mutations are journaled and undoable; deletions go to
  a kondo-managed trash, never straight to unlink. See
  [ADR-0001](docs/adr/0001-mutations-are-reversible.md).
- **Untrusted content.** Transcript and skill content is attacker-influenced
  text (prompt injection lives there). The renderer renders it as text, never
  as HTML, and kondo never executes anything it scans.
- **Lean supply chain.** Dependencies are kept minimal and pinned via
  lockfile. New runtime dependencies need justification in the PR.

## Data handling

Kondo writes only inside the user store, a verified project's `.claude`
directory, and its own data directory (see
[Kondo's own footprint](docs/foundations.md#kondos-own-footprint)); Claude-store
mutations are journaled before a store byte moves (ADR-0001). Its own data
includes the mutation journal, kondo trash, appearance preferences, scan
caches and Electron profile files. Trashed data — which can include full
session transcripts and whole settings files — persists **until the user
empties the trash**; there is no
automatic expiry, the UI shows the trash size, and emptying is the only
permanent deletion kondo can perform. Normal uninstall leaves Kondo's data,
including the trash, behind: the configured Windows NSIS uninstaller retains
app data by default (unless explicitly invoked with `--delete-app-data`),
and removing the macOS `.app` or Linux `.AppImage` leaves the separate data
directory. macOS/Linux uninstall behavior has not been manually validated.
See [data locations and removal](README.md#kondo-data-and-uninstalling) for
the per-OS paths and custom `KONDO_DATA_ROOT`. Restore anything needed before
quitting Kondo and removing that exact directory; removing retained trash
permanently loses those contents and their undo, without reverting earlier
Claude-store changes. Kondo never copies store content
anywhere else. Identity and token files — `.credentials.json` in the user
store, the desktop store's device and token files, and the account and
machine keys of `~/.claude.json` — are statted for size but never opened or
surfaced; of `~/.claude.json` kondo keeps only the project paths and, later,
MCP server names (ADR-0009).

Kondo currently refuses every store-mutation plan containing a `write` or
`splice`, on every platform, before journal or filesystem effects. Historical
Undo entries containing those steps are also refused whole, retaining their
existing journal and recovery bytes. This covers `~/.claude.json`, existing
settings layers and creation of missing settings layers. A digest check
followed by rename cannot preserve a competing save made between those
operations. No native settings-preservation backend or bypass is provided;
see [ADR-0010](docs/adr/0010-splice-config-files-never-whole-file-writes.md).
Other mutations retain their existing checks; this settings refusal establishes
no additional concurrency guarantee for them.

## Supported versions

No supported release range or backport window is currently declared. The source
package identifies itself as 0.5.0, but a package version and changelog are not
proof of a published release. Consult [GitHub Releases](https://github.com/V-Songbird/kondo/releases)
for published artifacts and [the release process](docs/release.md).
Development builds and older versions carry no security-maintenance commitment.
The repository owner must declare the supported versions and update this policy
when publishing releases; no response or fix deadline is promised.

## Reporting a vulnerability

Use the repository's existing private route:
[Report a vulnerability](https://github.com/V-Songbird/kondo/security/advisories/new)
(Security tab). Do not open public issues for exploitable problems.
Private reporting availability depends on the repository's GitHub settings and
has not been verified here. If the option is unavailable, do not publish exploit
details; the owner needs to confirm that channel or designate a private fallback.
No alternate address is currently documented.

Include the Kondo version or source commit, OS, impact, and a minimal synthetic
reproduction. Do not attach real transcripts, settings, credentials, tokens,
personal paths, or copied private store data, even in a private report.
