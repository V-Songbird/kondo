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
directory, and its own data directory (see foundations.md, "Kondo's own
footprint"), and every write is journaled before a store byte moves
(ADR-0001). What it keeps of its own is the mutation journal and the kondo
trash. Trashed data — which can include full session transcripts and whole
settings files — persists **until the user empties the trash**; there is no
automatic expiry, the UI shows the trash size, and emptying is the only
permanent deletion kondo can perform. Kondo never copies store content
anywhere else. Identity and token files — `.credentials.json` in the user
store, the desktop store's device and token files, and the account and
machine keys of `~/.claude.json` — are statted for size but never opened or
surfaced; of `~/.claude.json` kondo keeps only the project paths and, later,
MCP server names (ADR-0009). Kondo does not write `~/.claude.json` at all
until a splice step can prove the bytes it changes are the bytes it read.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository (Security tab →
"Report a vulnerability"). Please do not open public issues for exploitable
problems. You will get a response within a week.
