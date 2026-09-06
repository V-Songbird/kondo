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
   CHANGELOG's `[Unreleased]` items under the new version; commit. This is not
   optional bookkeeping: `publish` reads that section for the release notes and
   fails the run when the tag has none, or an empty one.
2. CI green on all three OSes (`verify` and `smoke` jobs).
3. Rehearse. Run the `release` workflow from the Actions tab — it takes a
   `workflow_dispatch` — against `main`. All three installers build and the
   smoke test drives them; the `publish` job is skipped, because a rehearsal
   has no tag to attach anything to. A red leg here is a blocker the tag
   would have hit anyway, found without burning a version number.
4. `git tag v<version> && git push --tags`. The `package` job builds the NSIS
   installer, the DMG and the AppImage, runs the end-to-end smoke against the
   packaged binary on Windows and Linux, and uploads each installer as a
   workflow artifact. `publish` waits on all three and attaches them to one
   **draft** GitHub Release, alongside a `SHA256SUMS` asset covering all three
   — the only integrity signal an unsigned build has. The draft's notes are the
   CHANGELOG section for that version, above README's unsigned-install warning.
   An OS that fails yields no draft rather than an incomplete one, and the run
   stops before building if the tag does not name the version in `package.json`.
5. Download one artifact per OS, check it against the `SHA256SUMS` asset
   attached to the same draft, and run it against a fixture store
   (`.claude/skills/run-kondo/fixture.mjs` prints the three env values); a
   blank window or any network request is a blocker.
6. Publish the draft. `npm run package` builds the same artifacts locally,
   unsigned, when a check is wanted before the tag.
