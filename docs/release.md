# Releasing

No release has shipped yet; this is the policy releases will follow, written
now so packaging decisions do not accrete by accident.

## Versioning

Semantic versioning. Pre-1.0: minor bumps may break, patch bumps never do.
Every release gets a CHANGELOG section and a git tag `v<version>`.

## Packaging

- `electron-builder` produces per-OS artifacts: NSIS installer (Windows),
  DMG (macOS), AppImage (Linux).
- Artifacts are published as GitHub Releases from CI, never from a developer
  machine.
- The app must run fully offline; a release build making any network request
  is a release blocker (SECURITY.md).

## Signing — decide before v0.2

Unsigned builds scare users on both Windows (SmartScreen) and macOS
(Gatekeeper; unnotarized apps need a Privacy & Security override — skilldex's
README documents that pain well). Options, to be resolved in an ADR when
releases begin: buy certificates (macOS Developer ID + notarization; Windows
OV/EV), ship unsigned with honest install docs, or Windows-unsigned +
macOS-notarized. Until then, `npm run build` artifacts are for local use.

## Release steps

1. `npm version <bump>` on a clean `main`; CHANGELOG section finalized.
2. CI green on all three OSes.
3. Tag push triggers the packaging workflow; artifacts attach to a draft
   GitHub Release.
4. Smoke-test one artifact per OS against a fixture store, then publish.
