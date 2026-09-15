# Unsigned releases, for now

## Context

Signing needs what no build pipeline can supply — the owner's money, an Apple
developer account, and secrets in the repository's settings: an Apple
Developer ID plus notarization, and a Windows OV or EV certificate.

Unsigned builds cost the user a warning: Windows SmartScreen interrupts the
installer, and macOS Gatekeeper can block an unidentified developer's app.
The current per-app opening instructions and verification limits live in
[README, Install](../../README.md#install); OS policy can prevent an override.

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
- The smoke test gates upload of every platform artifact: it drives the
  installed Windows executable, the Linux AppImage in extract-and-run mode, and
  the macOS app bundle. It does not verify DMG installation, Gatekeeper or
  Linux FUSE mounting. Configured gates are distinct from recorded successful
  runs; [release.md](../release.md) describes the evidence required before
  publishing.

## Considered options

- **Buy certificates now.** Rejected: not a decision code can make, and a
  certificate's price is the owner's to weigh against a pre-1.0 audience of
  developers who already run unsigned tooling.
- **Sign macOS only.** Rejected: half the users still meet a warning, and the
  notarization step needs the same account either way.
- **No packaged release; clone and `npm run dev`.** Rejected: the app is ready
  to be run by someone who did not build it.

## What changes this

Any one of: an Apple Developer ID and a Windows certificate in the
repository's secrets; a report that an unsigned build was blocked outright
(not warned) on a supported OS; or a first release whose downloads show the
warning is costing users. Then: sign and notarize in the workflow (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
are electron-builder's own names), drop the README warnings, and replace this
decision.

## Consequences

- `npm run package` produces the same artifacts locally, unsigned, for a
  smoke check before a tag is pushed.
- Nothing about the app changes between a signed and an unsigned build; only
  the installer's reception does.
