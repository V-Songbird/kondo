# Unsigned releases, for now

Status: accepted, 2026-09-05 (entry 066). Revisit when the first condition
under "What changes this" holds.

## Context

docs/release.md left the signing choice open until releases began: buy
certificates (an Apple Developer ID plus notarization, a Windows OV or EV
certificate), ship unsigned with honest install docs, or sign one platform and
not the other. Releases begin with this entry, and the first two options need
what no build pipeline can supply — the owner's money, an Apple developer
account, and secrets in the repository's settings.

Unsigned builds cost the user a warning: Windows SmartScreen interrupts the
installer, macOS Gatekeeper refuses to open the app until it is allowed under
Privacy & Security or opened from the context menu. Neither prevents running
the app; both look alarming.

## Decision

- Every artifact ships unsigned: `electron-builder` runs with no identity
  (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `mac.identity: null`, no Windows
  certificate), so the release workflow needs no secret beyond the token
  GitHub gives it.
- The warnings are documented where a user meets them: README's install
  section and the release notes say what SmartScreen and Gatekeeper will do
  and how to proceed.
- A release is a **draft** until a person publishes it. The workflow builds
  and attaches; publishing is a click, after the checklist in docs/release.md.
- The smoke test runs against the packaged binary before it is attached, on
  the OSes whose unpacked layout it can spawn (Windows, Linux); the macOS
  bundle is attached on the strength of the build and the dev-electron smoke
  that ci.yml already ran there.

## Considered options

- **Buy certificates now.** Rejected for this entry: not a decision code can
  make, and an OV certificate's price is the owner's to weigh against a
  pre-1.0 audience of developers who already run unsigned tooling.
- **Sign macOS only.** Rejected: half the users still meet a warning, and the
  notarization step needs the same account either way.
- **No packaged release; clone and `npm run dev`.** Rejected: it is what the
  README said for five minor versions, and the audit that produced entries
  058–066 found the app ready to be run by someone who did not build it.

## What changes this

Any one of: an Apple Developer ID and a Windows certificate in the
repository's secrets; a report that an unsigned build was blocked outright
(not warned) on a supported OS; or a first release whose downloads show the
warning is costing users. Then: sign and notarize in the workflow (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
are electron-builder's own names), drop the README warnings, and mark this
ADR superseded.

## Consequences

- `npm run package` produces the same artifacts locally, unsigned, for a
  smoke check before a tag is pushed.
- Nothing about the app changes between a signed and an unsigned build; only
  the installer's reception does.
