# Releasing

This is the policy releases follow, written before the first one so packaging
decisions did not accrete by accident. The first tag is the owner's to push.

## Versioning

Semantic versioning. Pre-1.0: minor bumps may break, patch bumps never do.
Every release gets a CHANGELOG section and a git tag `v<version>`.

## Security maintenance and publication gate

Before the first publication, confirm the approved private reporting contact
and identify the exact supported version under the owner-approved policy in
[SECURITY.md](../SECURITY.md).
These are publication gates even when packaging and CI pass. An unavailable
reporting form, a source package version, or a draft release does not satisfy
this gate. No published releases or tags were returned by the authenticated
API on 2026-09-08.

The approved contact is [songbird@tuta.com](mailto:songbird@tuta.com). The owner
confirmed control and monitoring on 2026-09-08; this is an owner attestation, not
a delivery test. No test email was sent or authorized.

**Maintenance policy — approved by the owner on 2026-09-08:** maintain only the
latest published non-draft, non-prerelease version. Security fixes target that
release line or its successor; older versions receive no guaranteed backports,
and development builds and prereleases are unsupported. Users of older builds
would need to upgrade. There is no response or fix deadline. On each publication,
update SECURITY.md with the exact supported version and the superseded range;
record security fixes and affected/fixed versions in the changelog and release
notes when disclosure is approved. The policy applies when a stable release is
published; no supported release range is active today.

On 2026-09-08, the owner chose manual review with the documented remote
enforcement limitation, keeping the repository private without purchasing a
plan. A later compatible plan or ruleset/protection configuration requires
separate authorization and review. Making the repository public is a separate
publication decision. Neither plan changes nor visibility changes happen as an
implicit release step.

### Recheck GitHub capabilities

Use authenticated read-only requests in the repository owner's authorized
checkout. Record the date, commit, response status and relevant fields without
credentials or private report contents:

```sh
gh api repos/V-Songbird/kondo
gh api repos/V-Songbird/kondo/private-vulnerability-reporting
gh api repos/V-Songbird/kondo/actions/permissions/workflow
gh api repos/V-Songbird/kondo/branches/main/protection
gh api repos/V-Songbird/kondo/rulesets
gh api repos/V-Songbird/kondo/releases --paginate
gh api repos/V-Songbird/kondo/tags --paginate
```

A 403 with a plan restriction is different from a token-permission failure;
a 404 is not proof that a feature is disabled. Resolve access/availability before
claiming a control is enabled. If the owner later authorizes GitHub private
reporting on an eligible public repository, verify `enabled: true` and that the
private form opens from a reporter's account without submitting a report.
Verify the designated recipient's access and notifications. For an email contact,
record the owner's confirmation of control and monitoring separately from any
receipt test. Sending a harmless test requires explicit authorization; none has
been authorized for the current contact. Update SECURITY.md and the issue chooser
together when the contact changes. A reachable form or owner attestation does not
independently prove delivery.

Workflow permissions already follow least privilege: `ci.yml` and `release.yml`
default to `contents: read`; only `release.yml`'s `publish` job requests
`contents: write` to create the draft and upload assets. The repository returned
`default_workflow_permissions: read` and
`can_approve_pull_request_reviews: false` on 2026-09-08. The read default is not
a blanket prohibition on an explicit job grant. Keep the write grant scoped to
publication; do not broaden the repository default or enable bot PR approvals.
See [GitHub's permissions reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

Hosted checks gate shared PR integration and acceptance of a public or release
candidate. Reviewed local development integration can proceed with the required
local checks in [CONTRIBUTING.md](../CONTRIBUTING.md#merge-checks-and-remote-enforcement);
it does not satisfy release acceptance or authorize publication.

Check runs and classic commit statuses are separate API surfaces. For the exact
PR or public/release candidate SHA, inspect
`repos/V-Songbird/kondo/commits/<sha>/check-runs` and
`repos/V-Songbird/kondo/commits/<sha>/status`. Require the six `verify` / `smoke`
OS results, not a previous commit's results. An empty classic status list does
not mean Actions checks are absent. If protection becomes available, configure
and re-read the six exact observed check names from GitHub Actions, the target
branch, enforcement/bypass behavior and force-push/deletion restrictions before
claiming them enforced. The owner must approve that remote configuration first.

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
- `build.extraResources` ships `THIRD-PARTY-NOTICES.md` and the unchanged
  IBM Plex OFL at `licenses/IBM-Plex/OFL.txt` inside app resources. After
  packaging, run `node scripts/verify-packaged-notices.mjs <resources-directory>`:
  use `release/win-unpacked/resources` on Windows,
  `release/mac-arm64/Kondo.app/Contents/Resources` on macOS, or
  `release/linux-unpacked/resources` on Linux. The verifier compares both
  shipped files byte-for-byte with their repository originals and fails on
  missing or changed content. Repeat for each platform's build.

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
