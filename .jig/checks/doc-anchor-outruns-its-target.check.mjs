// jig:owned — authored for kondo.
//
// docs/status.md cites source locations as `file:line` anchors, and every landing
// moves them: 147 found 11 of 24 wrong after a single batch, and 157 moved four
// contract.ts anchors and dropped two more. A stale anchor sends the next session
// to the wrong line and says nothing while it does it.
//
// This is the one check that has to open the file the doc is pointing at, so it
// declares the driver's `anchor` kind rather than a pattern. It asks five
// questions and no others: is the target there, is the line inside it, does the
// link text name the file the path names, is the backticked identifier sitting
// against the anchor anywhere near the cited line, and does a `finding N`
// cross-reference land inside the Open findings list.
//
// Everything looser was measured against docs/status.md and rejected for firing
// on correct anchors. A symbol is read only where a backticked plain identifier
// touches the anchor — `plan` two words before capabilities.ts:15 is prose, and
// `Scan.errors` is not an identifier the target carries literally. An anchor with
// nothing against it is checked for existence and range alone, which is the
// direction that adds no finding.

export const id = "doc-anchor-outruns-its-target"
export const title = "A documentation anchor pointing at a line that moved"
export const severity = "hygiene"
export const confidence = "deterministic"

export const deny = {
  "reason": "A `file:line` anchor no longer points at what it names. docs/status.md is written for a session that starts without context, so an anchor that lands on the wrong line is worse than no anchor at all.",
  "alternative": "Open the target, find where the thing actually lives now, and correct the anchor in the same commit that moved it.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review."
}

// Every tracked markdown file the driver's walk can reach, and no wider.
// `.claude/**` is deliberately not one glob: SKIP_DIRS does not exclude
// `.claude/worktrees/`, so a run from the main checkout while a worktree exists
// would read that worktree's docs as well as its own. `docs/**/*.md` leads
// because the selftest derives the fixture's name from the first glob, and the
// fixture's targets are written relative to `docs/`.
const params = {
  kind: "anchor",
  paths: ["docs/**/*.md", "*.md", ".github/**/*.md", ".claude/rules/*.md", ".claude/skills/**/*.md"],
  symbolWindow: 2,
  findingsHeading: "Open findings"
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params }
]

// The doc, then the files it points at. Five wrong things in the violation — a
// line past the end, a text naming another file, a missing target, a symbol the
// window does not hold, a cross-reference past the list — and the same five
// right in the near miss.
export const fixtures = {
  violation: "# Fixture\n\n## Notes\n\n- A line past the end: [sample.ts:99](sample.ts).\n- A text naming another file: [other.ts:2](sample.ts).\n- A target that is not there: [gone.ts:1](gone.ts).\n- A symbol the window does not hold: `widget` ([sample.ts:1](sample.ts)).\n- A cross-reference past the list: finding 12.\n\n## Open findings\n\n1. **The first.** Unassigned.\n2. **The second.** Unassigned.\n\n--- targets\n=== docs/sample.ts\nconst alpha = 1\nconst beta = 2\nconst gamma = 3\n",
  nearMiss: "# Fixture\n\n## Notes\n\n- A line inside the file: [sample.ts:3](sample.ts).\n- A text naming its own file: [sample.ts:2](sample.ts).\n- A target that is there: [helper.ts:1](helper.ts).\n- A symbol the window holds: `widget` ([helper.ts:1](helper.ts)).\n- A cross-reference inside the list: finding 2.\n\n## Open findings\n\n1. **The first.** Unassigned.\n2. **The second.** Unassigned.\n\n--- targets\n=== docs/sample.ts\nconst alpha = 1\nconst beta = 2\nconst gamma = 3\n=== docs/helper.ts\nexport const widget = 1\n"
}
