# jig plan 697fd2b5d9c3

Every cell below is computed from each detector's own metadata and from the changes
this plan writes. Nothing here is hand-written prose about coverage.

- provenance: `elicited`
- mode: `armed` — the default; `--observe` is how you ask for the other one. Each cell below says what that row can refuse and where, because the answer is the lever's and this repository's together; a GAP cell installs nothing to refuse with
- editions read: `javascript-typescript`

## Coverage by actor

| class | provenance | human-editor | human-ci | claude-session | codex-session |
| --- | --- | --- | --- | --- | --- |

These artifacts are written but cannot be read back by jig, so their correctness is
nobody's guarantee:

- `.jig/activation.md`

## Consent

Approve in one go — these only ever report:

- `activation-wired-7d53dc2c` → `.jig/activation.md` — reports only, and refuses nothing

Approve one at a time — each of these can refuse something:

- nothing in this plan can refuse anything

## Backlog

30 classes were not selected. They are written to `.jig/backlog.json` so a later run resumes from them:

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
- `javascript-typescript/test-count-dropped` (PROB) — not selected
- `javascript-typescript/unimplemented-stub-shipped` (PROB) — not selected
- `javascript-typescript/sleep-based-test-synchronisation` (PROB) — not selected
- `javascript-typescript/test-config-loosened` (DET) — not selected
- `javascript-typescript/snapshot-updated-wholesale` (DET) — not selected

