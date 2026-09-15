# Releasing

This is the policy releases follow. The first tag is the owner's to push.

## Versioning

Semantic versioning. Pre-1.0: minor bumps may break, patch bumps never do.
Every release gets a CHANGELOG section and a git tag `v<version>`.

## Security maintenance and publication gate

Before the first publication, confirm the private reporting contact and name
the exact supported version under the maintenance policy in
[SECURITY.md](../SECURITY.md#supported-versions). These are publication gates
even when packaging and CI pass: an unavailable reporting form, a source
package version or a draft release does not satisfy them. There are no
published releases or tags yet.

On each publication, update SECURITY.md with the exact supported version and
the superseded range, and record security fixes with affected and fixed
versions in the changelog and release notes when disclosure is approved.

Remote branch protection is not configured and review stays manual
([CONTRIBUTING.md](../CONTRIBUTING.md#merge-checks-and-remote-enforcement)).
Buying a plan, configuring rulesets or protection, and making the repository
public each need separate owner authorization; none happens as an implicit
release step.

### Public Git history

Before any first-publication tag, push or visibility change, resolve the
[public-history decision](plans/111-public-history-decision.md) and obtain owner
approval of the exact candidate SHA and selected refs. The owner chose strategy
A, a separate public repository with a new root commit that preserves the
private source; the public identity and destination remain open. The current
tree's ancestors retain private working records and messages, and ignore rules
do not sanitize that history. Personal context still in the tree is open work
(entry 123 in [ROADMAP.md](../ROADMAP.md)). Repeat the privacy and secret review
on the final publication SHA, as that package and the final candidate review
(entry 114) require. Passing the release steps below does not authorize
publishing the existing source ancestry or changing visibility.

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

The last recorded check, on 2026-09-08, found a private repository with
default branch `main`; private-reporting status HTTP 404; default workflow
permissions `read` with pull-request review approval off; Actions enabled with
all actions allowed and SHA pinning not required; branch protection and
rulesets both HTTP 403 with an upgrade-or-public restriction; no releases or
tags; and zero classic commit statuses (combined state `pending`), which does
not contradict successful check runs.

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

Workflow permissions follow least privilege: `ci.yml` and `release.yml`
default to `contents: read`; only `release.yml`'s `publish` job requests
`contents: write` to create the draft and upload assets. The repository's read
default is not a blanket prohibition on an explicit job grant. Keep the write grant scoped to
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
  IBM Plex OFL at `licenses/IBM-Plex/OFL.txt` inside app resources. The release
  workflow does not run the notice verifier; after a local `npm run package`,
  run `node scripts/verify-packaged-notices.mjs <resources-directory>`:
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

## Tag provenance

The reviewed candidate is the tip of `main` that release steps 1–3 review and
the owner approves by exact SHA. Before any installer is built, the `release`
workflow's `provenance` job runs `scripts/verify-release-provenance.mjs`. The
script fetches `main` and the pushed tag from `origin` itself, deepening the
runner's shallow checkout, and trusts no ref already in that checkout. On a tag
push it passes only when the tag on `origin`, annotated or lightweight, points
at the commit the run builds and that commit is `origin/main`'s tip. Otherwise
the run fails before packaging, and the log names the tag commit, the candidate
commit and the reason: not reachable from `origin/main`, on `origin/main` but
not its tip, or a tag that no longer points at the run's commit. A rehearsal
logs the same comparison for its own commit and never fails on it.

A passing check does not establish:

- **That main's tip was reviewed.** It reads no CI result and no approval;
  steps 2 and 3 and the owner's SHA approval stay manual.
- **That `main` holds only reviewed commits.** Nothing server-side protects
  `main` (see the publication gate above).
- **Anything about a tag whose commit changes the check.** A tag push runs
  `release.yml` and the script from the tagged commit, so a branch that edits
  or removes either can still build a draft. Step 6's comparison, made outside
  the workflow, is the control that remains.
- **Anything from a version match.** The version gate proves only that the tag
  names the `package.json` version.

The comparison uses main's tip when the job runs. A push to `main` before then
fails the run, and so does "Re-run all jobs" once `main` has moved; "Re-run
failed jobs" keeps a provenance result that already passed. Push nothing to
`main` until the draft exists.

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
   because a rehearsal is not a tag push, even when dispatched on a tag ref.
   The `provenance` job logs whether a tag on the rehearsed commit would pass.
   A red leg here is a blocker the tag
   would have hit anyway, found without burning a version number.
4. Tag the approved candidate and push only that tag: `git fetch origin main`,
   confirm `git rev-parse origin/main` prints the approved SHA, then
   `git tag v<version> <sha> && git push origin v<version>`. The `provenance`
   job rejects the tag unless it is `origin/main`'s tip
   ([Tag provenance](#tag-provenance)). The `package` job builds the x64 NSIS
   installer, the arm64 DMG and the x64 AppImage, runs the end-to-end smoke against the
   same platform artifacts described in step 3, and uploads each installer as a
   workflow artifact. `publish` waits on all three and attaches them to one
   **draft** GitHub Release, alongside a `SHA256SUMS` asset covering all three
   — the only integrity signal an unsigned build has. The draft's notes are the
   CHANGELOG section for that version, above the architecture, support and
   unsigned-install guidance. Keep the following statement identical in the
   README and generated release body, updating all three when new evidence lands:

   Platform coverage: Windows x64 has recorded local fixture validation of the UI and installed NSIS app. macOS arm64 and Linux x64 have no recorded manual validation. Release CI requires packaged smoke checks before upload; a green run verifies the installed Windows app, Linux AppImage in extract-and-run mode, and macOS app bundle. DMG installation, Gatekeeper, and Linux FUSE mounting remain unverified.

   Local evidence, 2026-09-06, on Windows: the task workflow at `36d3de9`
   passed 364 unit tests and 13/13 built-app scenarios, including keyboard
   routes and 900×600 geometry; the NSIS package built at `d293540` installed
   into a temporary path containing spaces, passed all 17 fixture smoke checks
   and was removed afterwards. These records do not establish a successful
   hosted release run; retain the
   rehearsal/run link when validating a release. Follow [README installation
   instructions](../README.md#install), including per-app quarantine handling
   and distribution-specific FUSE libraries. The Linux smoke bypasses FUSE.

   An OS that fails yields no draft rather than an incomplete one, and the run
   stops before building if the tag is not `origin/main`'s tip or does not name
   the version in `package.json`.
5. Download one artifact per OS, check it against the `SHA256SUMS` asset
   attached to the same draft, and run it against a fixture store
   (`node .claude/skills/run-kondo/fixture.mjs <new-disposable-directory>`
   recreates that directory and prints the three env values); a blank window
   or any network request is a blocker.
6. Confirm the tag still names the approved commit, outside the workflow:
   `git fetch --force origin refs/tags/v<version>:refs/tags/v<version>`, then
   `git rev-parse v<version>^{commit}` must print the approved SHA, and the
   run's `provenance` log must name that SHA as tag and candidate commit.
   Publish the draft. `npm run package` builds the same artifacts locally,
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
