# Releasing

This is the policy releases follow, written before the first one so packaging
decisions did not accrete by accident. The first tag is the owner's to push.

## Versioning

Semantic versioning. Pre-1.0: minor bumps may break, patch bumps never do.
Every release gets a CHANGELOG section and a git tag `v<version>`.

## Packaging

- `package.json` explicitly selects one architecture per target using
  [electron-builder target configuration](https://www.electron.build/v26/docs/cli/):
  x64 NSIS (Windows), arm64 DMG (Apple silicon macOS), x64 AppImage (Linux).
  Intel Macs and Windows/Linux ARM builds are not included.
- Default filenames remain `Kondo Setup <version>.exe`,
  `Kondo-<version>-arm64.dmg` and `Kondo-<version>.AppImage`; architecture need
  not appear in a filename. Keep the README table in sync with these defaults.
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
   `workflow_dispatch` — against `main`. All three installers build. Before
   upload, Windows installs the NSIS package silently to a unique runner temp
   directory and smokes its installed `Kondo.exe`; Linux smokes the AppImage
   with `--appimage-extract-and-run` under xvfb; macOS smokes the executable
   inside the generated `Kondo.app` bundle. Each smoke uses synthetic stores
   and an isolated Electron profile. The macOS check does not mount/install
   the DMG or establish Gatekeeper behavior. The `publish` job is skipped,
   because a rehearsal has no tag to attach anything to. A red leg here is a blocker the tag
   would have hit anyway, found without burning a version number.
4. `git tag v<version> && git push --tags`. The `package` job builds the x64 NSIS
   installer, the arm64 DMG and the x64 AppImage, runs the end-to-end smoke against the
   same platform artifacts described in step 3, and uploads each installer as a
   workflow artifact. `publish` waits on all three and attaches them to one
   **draft** GitHub Release, alongside a `SHA256SUMS` asset covering all three
   — the only integrity signal an unsigned build has. The draft's notes are the
   CHANGELOG section for that version, above the architecture, support and
   unsigned-install guidance. Keep the following statement identical in the
   README and generated release body, updating all three when new evidence lands:

   Platform coverage: Windows x64 has recorded local fixture validation of the UI and installed NSIS app. macOS arm64 and Linux x64 have no recorded manual validation. Release CI requires packaged smoke checks before upload; a green run verifies the installed Windows app, Linux AppImage in extract-and-run mode, and macOS app bundle. DMG installation, Gatekeeper, and Linux FUSE mounting remain unverified.

   Local evidence: [Windows UI](plans/2026-09-06-ux-workflow.md#validation-2026-09-06)
   and [installed NSIS smoke](plans/080-release-artifact-smoke.md#observed-verification).
   These records do not establish a successful hosted release run; retain the
   rehearsal/run link when validating a release. Follow [README installation
   instructions](../README.md#install), including per-app quarantine handling
   and distribution-specific FUSE libraries. The Linux smoke bypasses FUSE.

   An OS that fails yields no draft rather than an incomplete one, and the run
   stops before building if the tag does not name the version in `package.json`.
5. Download one artifact per OS, check it against the `SHA256SUMS` asset
   attached to the same draft, and run it against a fixture store
   (`.claude/skills/run-kondo/fixture.mjs` prints the three env values); a
   blank window or any network request is a blocker.
6. Publish the draft. `npm run package` builds the same artifacts locally,
   unsigned, when a check is wanted before the tag.

For a local packaged smoke, set `KONDO_E2E_BINARY` to the installed Windows
executable, the `.AppImage`, or the macOS app-bundle executable and run
`npm run test:e2e` (under xvfb on a headless Linux host). The harness creates
all fixture roots itself. AppImage paths automatically enable extract-and-run.
The NSIS CI command uses `/S /currentuser /D=<temp>` with `/D` last and
unquoted, even when the path contains spaces. It runs on a disposable hosted
runner: **a temporary `/D` does not isolate NSIS upgrade behavior**. For local
installation, first verify there is no existing Kondo install registration,
running application, shortcut or updater cache that the installer could replace;
otherwise use a disposable Windows account or VM. Uninstall only the verified
temporary installation afterward. Never launch the package against real stores
to validate this workflow.
