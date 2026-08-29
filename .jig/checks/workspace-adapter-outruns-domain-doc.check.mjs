// jig:owned — authored for kondo.
//
// CLAUDE.md sends every store-adapter change through docs/domain.md, and
// electron/main/workspace/ is where those adapters live: kinds, scan, display and
// the store readers themselves. The doc describes the shape they return. When one
// moves and the doc does not, the next session starts from a map of a place that
// no longer exists — and it is the one file CLAUDE.md tells it to trust.
//
// This reads the git index, so it speaks only at commit time and reports itself
// skipped anywhere nothing is staged, CI included. Any touch of docs/domain.md in
// the same commit satisfies it.

export const id = "workspace-adapter-outruns-domain-doc"
export const title = "A store adapter changed without docs/domain.md"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "A store adapter under electron/main/workspace/ changed and docs/domain.md did not. CLAUDE.md makes that doc the starting point for adapter work, so a stale one misleads every session that obeys it.",
  "alternative": "Stage the matching edit to docs/domain.md in this commit, or split the adapter change into its own commit once the doc is right.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review."
}

const params = {
  paths: ["electron/main/workspace/**"],
  pairedWith: ["docs/domain.md"]
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params }
]

export const fixtures = {
  "violation": "electron/main/workspace/kinds.ts\nelectron/main/workspace/scan.ts\n",
  "nearMiss": "electron/main/workspace/kinds.ts\ndocs/domain.md\n"
}
