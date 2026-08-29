# jig plan 56fc3ff5978c

Every cell below is computed from each detector's own metadata and from the changes
this plan writes. Nothing here is hand-written prose about coverage.

- provenance: `elicited`
- mode: `armed` — every check below fired on its own violation and stayed silent on its near miss, so it blocks from install
- editions read: `javascript-typescript`

## Coverage by actor

| class | provenance | human-editor | human-ci | claude-session | codex-session |
| --- | --- | --- | --- | --- | --- |
| `outbound-network-call` | elicited | DET .jig/checks/outbound-network-call.check.mjs | GAP — no detector on this class names human-ci | DET outbound-network-call-edit-observe-guard-1 [proven by its fixture pair] | GAP — no detector on this class names codex-session |
| `raw-path-across-the-seam` | elicited | DET .jig/checks/raw-path-across-the-seam.check.mjs | GAP — no detector on this class names human-ci | DET raw-path-across-the-seam-edit-observe-guard-1 [proven by its fixture pair] | GAP — no detector on this class names codex-session |
| `renderer-reaches-past-the-bridge` | elicited | DET .jig/checks/renderer-reaches-past-the-bridge.check.mjs | GAP — no detector on this class names human-ci | DET renderer-reaches-past-the-bridge-edit-observe-guard-1 [proven by its fixture pair] | GAP — no detector on this class names codex-session |
| `test-touches-a-real-store` | elicited | DET .jig/checks/test-touches-a-real-store.check.mjs | GAP — no detector on this class names human-ci | DET test-touches-a-real-store-edit-observe-guard-1 [proven by its fixture pair] | GAP — no detector on this class names codex-session |

These artifacts are written but cannot be read back by jig, so their correctness is
nobody's guarantee:

- `.jig/activation.md`
- `.jig/hooks/pre-commit`

## Consent

Approve in one go — these only ever report:

- `activation-7f3cad96` → `.jig/activation.md` — reports only, and refuses nothing
- `check-driver-75f25362` → `.jig/checks/run.mjs` — reports only, and refuses nothing
- `hook-shim-a2b08288` → `.jig/hooks/pre-commit` — reports only, and refuses nothing

Approve one at a time — each of these can refuse something:

- `check-outbound-network-call-2f0d94a1` → `.jig/checks/outbound-network-call.check.mjs` — installs a check the driver and CI both run, so it can fail a build
- `check-raw-path-across-the-seam-1ea43f03` → `.jig/checks/raw-path-across-the-seam.check.mjs` — installs a check the driver and CI both run, so it can fail a build
- `check-renderer-reaches-past-the-bridge-3453234c` → `.jig/checks/renderer-reaches-past-the-bridge.check.mjs` — installs a check the driver and CI both run, so it can fail a build
- `check-test-touches-a-real-store-fc323178` → `.jig/checks/test-touches-a-real-store.check.mjs` — installs a check the driver and CI both run, so it can fail a build
- `config-61328b28` → `.jig/config.json` — wires 4 guards into a hook that can refuse a tool call

## Backlog

25 classes were not selected. They are written to `.jig/backlog.json` so a later run resumes from them:

- `javascript-typescript/softened-assertion` (PROB) — not selected
- `javascript-typescript/emptied-test-body` (DET) — not selected
- `javascript-typescript/focused-test` (DET) — not selected
- `javascript-typescript/skipped-test` (DET) — not selected
- `javascript-typescript/commented-out-test` (DET) — not selected
- `javascript-typescript/test-without-assertion` (DET) — not selected
- `javascript-typescript/swallowed-exception` (DET) — not selected
- `javascript-typescript/type-widened-to-any` (DET) — not selected
- `javascript-typescript/double-cast-through-unknown` (DET) — not selected
- `javascript-typescript/non-null-assertion` (DET) — not selected
- `javascript-typescript/blanket-type-suppression` (DET) — not selected
- `javascript-typescript/blanket-lint-suppression` (DET) — not selected
- `javascript-typescript/relaxed-tsconfig-strictness` (DET) — not selected
- `javascript-typescript/lint-rule-turned-off` (PROB) — not selected
- `javascript-typescript/unawaited-async-call` (DET) — not selected
- `javascript-typescript/invented-import-or-api` (DET) — not selected
- `javascript-typescript/phantom-dependency` (DET) — not selected
- `javascript-typescript/hardcoded-secret` (PROB) — not selected
- `javascript-typescript/hardcoded-config-value` (PROB) — not selected
- `javascript-typescript/debug-artifact-left-behind` (DET) — not selected
- `javascript-typescript/toothless-test-command` (DET) — not selected
- `javascript-typescript/ci-step-allowed-to-fail` (DET) — not selected
- `javascript-typescript/dynamic-code-execution` (DET) — not selected
- `javascript-typescript/unchecked-index-access` (DET) — not selected
- `javascript-typescript/loose-equality-coercion` (DET) — not selected

