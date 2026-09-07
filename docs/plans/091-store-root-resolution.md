# Plan: Store config and temporary roots

Status: **done — implementation verified; awaiting acceptance (Foreman 091)**

Task 091 centralizes Linux desktop config and temporary-root discovery in
the locator. Cleanup and project badges must use the same temporary spellings.

## Scope

- Honor absolute Linux `XDG_CONFIG_HOME`; use `~/.config` for unset, empty or
  relative values, preserving explicit overrides and other platform defaults.
- Resolve the temporary root once in `createLocator`, with injectable root and
  synchronous realpath resolver. Retain the lexical spelling if realpath fails.
- Pass lexical and canonical spellings to all scratch classifiers. Use existing
  resolved project paths for segment-aware containment; retain the flattened
  worktree/job markers, but do not infer temp origin for unresolved historical
  names, whose separators are lost.
- Extend fixture setup and tests as needed; update domain, architecture,
  user path guidance and changelog without changing access permissions.

## Out of scope

Project identity changes, new filesystem permissions, renderer/bridge changes,
store migration and live Linux/macOS validation.

## Decisions

| Decision | Rationale |
|---|---|
| Ignore relative XDG values | Required by the [XDG specification](https://specifications.freedesktop.org/basedir/latest/). |
| Realpath only the temp root, once | Recognizes aliases without scanning projects or changing the synchronous locator API. |
| Root aliases are classification data | They never become allowed store or mutation roots. |
| Require an existing resolved project path for temp containment | Flattening loses separators; the request's sibling-safety requirement rules out classifying unknown paths by prefix alone. |

## Seam changes

None. Locator fields and analysis inputs stay in the main process.

## Acceptance checklist

- [x] `npm test -- test/locator.test.ts test/safety.test.ts test/tidy.test.ts`:
  XDG fallback/override, lexical/canonical temp paths, negative prefixes,
  resolver failure, and structural confinement pass with synthetic inputs.
- [x] `npm test`: all fixture suites pass; five existing file-symlink cases skipped (Windows EPERM).
- [x] `npm run typecheck`: strict TypeScript passes.
- [x] `npm run lint`: lint passes.
- [x] `git diff --check`: whitespace and boundary/documentation review pass.

## Evidence and scope adjustment

Windows verification: 100 focused tests passed; the full suite passed 520
tests with five existing file-symlink skips (EPERM). Strict typecheck, lint
and whitespace checks passed.
A real disposable directory junction resolved successfully. Linux XDG and macOS
temporary spellings were simulated; no live Linux or macOS desktop was tested.

The request's strict sibling-safety requirement cannot be guaranteed from a
flattened name alone: `/tmp/project` and `/tmp-project` both become
`-tmp-project`. Known paths now use segment-aware containment. Following that
explicit safety constraint, ambiguous unlocated names are no longer classified
as temporary from their prefix alone. Worktree/job markers and the separate
empty-unlocated-directory rule retain their existing behavior. Tests pin both
the ambiguity and consistent conservative behavior in list, detail and cleanup.

## Done when

Linux config resolution honors XDG and both temporary-root spellings drive
project badges and reversible cleanup consistently. Evidence distinguishes
simulated platform cases from live platform behavior.
