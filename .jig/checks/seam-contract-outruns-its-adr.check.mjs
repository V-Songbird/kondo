// jig:owned — authored for kondo.
//
// shared/contract.ts is the whole seam between the renderer and the main process.
// Two ADRs govern it: 0004 fixes the context-isolated bridge as the only crossing,
// and 0008 fixes composite identity ids as what may cross. Change the contract and
// leave both untouched and the ADRs now describe a seam the code abandoned, while
// .claude/rules/jig-governance.md still orders every session to read them first.
//
// This reads the git index, so it speaks only at commit time and reports itself
// skipped anywhere nothing is staged, CI included. Any touch under docs/adr/
// satisfies it, including a new ADR superseding an old one.

export const id = "seam-contract-outruns-its-adr"
export const title = "The IPC contract changed without an ADR"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "shared/contract.ts changed and no ADR under docs/adr/ moved with it. ADR 0004 and ADR 0008 govern this seam, and jig-governance.md makes every session read them as current.",
  "alternative": "Stage the ADR edit in this commit, or add a new ADR superseding the one this change contradicts.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review."
}

const params = {
  paths: ["shared/contract.ts"],
  pairedWith: ["docs/adr/**/*.md"]
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params }
]

export const fixtures = {
  "violation": "shared/contract.ts\nelectron/main/workspace/workspace.ts\n",
  "nearMiss": "shared/contract.ts\ndocs/adr/0008-composite-identity-ids-across-the-seam.md\n"
}
