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
store and the desktop store's device and token files — are statted for size
but never opened or surfaced. Of `~/.claude.json`, kondo uses only the project
registry, MCP server declarations with their disable lists, and `skillUsage`;
its account and machine keys are never surfaced (ADR-0009, ADR-0022).

Settings files, `~/.claude.json` and `.mcp.json` can hold credentials in
arbitrary keys, commands and nested values. Their data reaches the renderer only
as documented setting names, validated states (hook event, handler type, matcher
presence and script status; MCP transport), identities, display paths and
Kondo's own error sentences. Hook commands, matcher patterns, script paths,
`env` and `headers` names and values, undocumented names and parser messages
stay in the main process, and no view offers to reveal or copy them
([ADR-0022](docs/adr/0022-project-settings-data-deny-by-default.md)).

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

The owner approved this maintenance policy on 2026-09-08: only the latest
published stable release receives security maintenance, with no guaranteed
backports to older versions and no response or fix deadline. This policy becomes
applicable when a release is published; there is no active supported range today.
Before publication, identify the exact supported version here. See the
[approved release maintenance policy](docs/release.md#security-maintenance-and-publication-gate)
and [GitHub Releases](https://github.com/V-Songbird/kondo/releases) when assessing
artifacts, and include the exact version or source commit in a report.

## Reporting a vulnerability

Email [songbird@tuta.com](mailto:songbird@tuta.com) to report a vulnerability
privately. The repository owner authorized this contact and confirmed that they
control and monitor it on 2026-09-08. Email delivery has not been independently
tested. No response or fix deadline is promised.

Do not put vulnerability details in public issues, pull requests or discussions.
The issue forms are not a security-reporting fallback. If email cannot be
submitted or is returned undeliverable, retain the details privately rather than
posting them publicly; no second private contact is currently designated.

Include the Kondo version or source commit, OS, impact, and a minimal synthetic
reproduction. Do not attach real transcripts, settings, credentials, tokens,
personal paths, or copied private store data, even in a private report.

The repository was verified as private on 2026-09-08. GitHub documents
[private vulnerability reporting for public repositories](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
The authenticated reporting-status request returned HTTP 404, so the GitHub
advisory form is not advertised as an available channel. A 404 alone does not
establish whether a feature is disabled or whether the caller can inspect it.
Use the approved email contact above while the repository remains private.
