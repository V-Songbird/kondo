# Releasing

This is the policy releases follow, written before the first one so packaging
decisions did not accrete by accident. The first tag is the owner's to push.

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

## Signing — decided

Unsigned for now: [ADR-0011](adr/0011-unsigned-releases-for-now.md). The
workflow looks up no identity and reads no certificate, README tells users
what SmartScreen and Gatekeeper will say, and the ADR names what changes the
decision.

## Release steps

1. `npm version <bump> --no-git-tag-version` on a clean `main`; move the
   CHANGELOG's `[Unreleased]` items under the new version; commit.
2. CI green on all three OSes (`verify` and `smoke` jobs).
3. `git tag v<version> && git push --tags`. The `release` workflow builds the
   NSIS installer, the DMG and the AppImage, runs the end-to-end smoke against
   the packaged binary on Windows and Linux, and attaches everything to a
   **draft** GitHub Release.
4. Download one artifact per OS and run it against a fixture store
   (`.claude/skills/run-kondo/fixture.mjs` prints the three env values); a
   blank window or any network request is a blocker.
5. Publish the draft. `npm run package` builds the same artifacts locally,
   unsigned, when a check is wanted before the tag.
