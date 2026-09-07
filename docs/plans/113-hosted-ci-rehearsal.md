# Plan: hosted CI and release rehearsal

Status: **in progress**

Validate the pushed candidate with GitHub Actions on Windows, macOS and Linux,
including a manual release rehearsal that builds installers without publishing.

## Scope

- Diagnose actual failures from the hosted verify, smoke and packaging jobs.
- Canonicalize disposable fixture roots before constructing registry paths and
  safety expectations. macOS temporary-directory symlinks and Windows short-name
  aliases must identify the same synthetic tree as the application's locator.
- Let Electron shut down its child processes before deleting a smoke fixture;
  retain failures when shutdown cannot be confirmed.
- Preserve security assertions, test counts and synthetic-store isolation.

## Out of scope

Product audit repairs remain separate pending tasks. This rehearsal does not
approve public Git history, change repository visibility, tag or publish a release.

## Seam changes

None. Fixture infrastructure only unless hosted evidence identifies a product bug.

## Verification

Run typecheck, tests, lint, guards, guard self-tests, build and the local Electron
smoke. Repeat hosted CI and manual packaging on the corrected exact commit on
all three platforms; inspect installer artifacts and packaged smoke results.

## Initial evidence

- CI run 34169801057: Linux verify/smoke and macOS smoke passed. macOS and
  Windows write probes compared alias paths against resolved paths. Windows
  smoke also observed duplicate fixture projects and a locked shutdown file.
- Release rehearsal 34169817791: Linux AppImage passed; Windows and macOS
  stopped at the same unit-test path comparisons.

## Windows follow-up

Run 34170285540 passed every unit-test platform but still missed temporary
projects in the Windows smoke. `fs.realpathSync` retains Windows 8.3 names;
`fs.realpathSync.native` expands them. Use the native resolver for the one
OS temporary root and test short-name classification plus neighboring-path
rejection. No extra project reads or mutation permissions are introduced.
Run 34170601164 then passed Windows smoke but exposed a second fixture defect
on macOS: the standalone fixture flattened only separators, while Claude and
the adapter flatten every non-alphanumeric character. Random macOS temp roots
can contain underscores. Correct the fixture rule and include punctuation and
a space in every smoke root, making the existing project-union and cleanup
assertions a deterministic regression on all platforms.