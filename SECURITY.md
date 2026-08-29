# Security

## Threat model

Kondo reads and (in future releases) mutates the most sensitive directories a
Claude user has: full session transcripts, prompt history, settings including
environment variables, and plugin code. The design treats that as the primary
risk:

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

Kondo reads Claude's stores and writes nothing back in v0.1. What it will
keep of its own lives in kondo's data directory (see foundations.md,
"Kondo's own footprint"): the mutation journal and the kondo trash. Trashed
data — which can include full session transcripts — persists **until the
user empties the trash**; there is no automatic expiry, the UI must show
trash size, and emptying is the only permanent deletion kondo can perform.
Kondo never copies store content anywhere else, and identity/token files in
the desktop store are statted for size but never opened.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository (Security tab →
"Report a vulnerability"). Please do not open public issues for exploitable
problems. You will get a response within a week.
