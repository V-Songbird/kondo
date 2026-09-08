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

No published releases or tags were returned by the repository's authenticated
GitHub API on 2026-09-08. There is currently **no supported release range**.
The source package version, 0.5.0, is not evidence of a published release.
Development builds, prereleases and older versions have no security-maintenance
commitment. No response deadline, fix deadline or backport window is promised.

Before publishing the first release, the owner must approve a maintenance
policy and identify supported versions here. The
[release maintenance proposal](docs/release.md#security-maintenance-and-publication-gate)
is pending approval; it is not a current support promise. Recheck
[GitHub Releases](https://github.com/V-Songbird/kondo/releases) when assessing
artifacts, and include the exact version or source commit in a report.

## Reporting a vulnerability

**No verified private reporting channel is currently documented.** Do not put
vulnerability details in public issues, pull requests or discussions. Retain
sensitive details privately until an approved contact is published here; the
issue forms are not a security-reporting fallback.

The repository was verified as private on 2026-09-08. GitHub documents
[private vulnerability reporting for public repositories](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
The authenticated reporting-status request returned HTTP 404, so the former
advisory-form link is not advertised as an available channel. A 404 alone does
not establish whether a feature is disabled or whether the caller can inspect it.
The owner must designate a private contact while the repository remains private.
No alternate address has been approved; do not infer one from Git history.

Once an approved private channel is available, include the Kondo version or
source commit, OS, impact, and a minimal synthetic reproduction. Do not attach
real transcripts, settings, credentials, tokens, personal paths, or copied
private store data, even in a private report.
