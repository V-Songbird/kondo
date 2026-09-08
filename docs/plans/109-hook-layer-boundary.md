# Plan: Hook layer boundary and accurate claims

Status: **awaiting owner acceptance — decision only; no behavior changes**

## Decision

Retain read-only hook declarations and correct the shipped move claim.
Kondo lists hooks from the user settings file and the project/local settings
files of verified projects, with limited script diagnostics. It does not move,
enable, disable or trash those declarations. This wins over commissioning a
move now because reversible configuration bytes do not establish preserved
hook behavior. [ADR-0017](../adr/0017-hook-layer-boundary.md) records the boundary.

This package neither authorizes a future implementation nor accepts a release.
The existing user-store script cleanup is a separate operation; read-only
declarations do not mean that Kondo never moves a script file.

## Evidence and claim inventory

Source baseline: `b1f999f282dd9c7c70848c2b4d1beb19b57fffff`.

| Surface | Observed evidence | Disposition |
|---|---|---|
| `ROADMAP.md`, product direction and v0.4 heading | “everything movable” / “move everything” include unsupported kinds | Qualify moves as supported by kind and scope. |
| `ROADMAP.md`, entry 036 | Explicitly calls hook moves shipped | Retain project attribution and diagnostics; state declarations remain read-only. |
| `CHANGELOG.md`, 0.5.0 introduction | Repeats “v0.4 move everything” | Correct the historical summary and record the correction under Unreleased. |
| `README.md`, Hooks | “every hook that will fire” exceeds the reader's coverage | Name the settings layers inventoried, diagnostic limits and refused operations. |
| ADR-0006, hook amendment | Treats a group transfer as two splices with all-or-nothing Undo | Mark that hook amendment superseded by this decision; do not treat it as implementation evidence. |
| `capabilities.ts`, `hook()` and `MATRIX.hook` | All four operations denied for user, project and local; move says “not built yet” | Preserve code. That refusal is not a roadmap commitment or proof that two edits suffice. |
| `kinds.ts`, `hook.plan` | Returns `matrixRefusal` for every operation | There is no hook move builder. The audit's “hook plan” means this refusing planner; no dedicated 036 plan exists under `docs/plans/`. |
| `user-store.ts`, `readSettingsLayers`, `rawHooks`, `hooksFromLayers` | Reads three layer kinds; flattens groups into event/matcher/command rows, uses positional IDs, truncates displayed commands to 200 characters | A `HookInfo` row cannot round-trip the original group or establish effective runtime behavior. |
| `user-store.ts`, `scriptToken`, `resolveScript`, `hookScript` | Recognizes the first script-like token; does not expand variables or execute/read scripts; only stats allowed paths | Present/missing/unverifiable are limited scan signals, not semantic verification. |
| `src/features/library/library.tsx`, `HookPage` | Read-only detail and a per-hook toggle refusal; no move action | No unsupported action to remove. Runtime-wide wording and unknown-form presentation belong to product-copy follow-up 110. |
| `src/features/projects/projects.tsx`, Hooks section | Event, matcher, command, script and settings-file table; no move picker | Keep the existing read-only surface. Its empty-state claim needs the same inventory qualification in 110. |

The search covered tracked Markdown and TypeScript/TSX for hook/move claims,
plus the release audit's hook finding. General “manage hooks” language means
inventory here, not an additional mutation capability. Historical statements
about which hooks fire also need the narrower inventory wording in follow-up
110; this package does not prove all Claude hook sources are discovered.

## Supported operations

| Operation | Current support and limit |
|---|---|
| Inventory and attribution | User `settings.json`; verified projects' `.claude/settings.json` and `.claude/settings.local.json`, grouped by project. No complete effective-hook inventory is claimed. |
| Inspect | Event, matcher, command display and source layer. Non-command entries can appear as `(not a command)`; unknown fields/types are not a writable model. |
| Script signal | One recognized token, stat only within approved roots. Null means no recognized script, not proof that the command uses no file. |
| Enable / disable / move / trash declaration | Refused in all three known layers and in unknown scopes. No verified native per-hook toggle is implemented. |
| Clean up script files | Existing `unarmed-hook-scripts` category covers the user store only. It does not transfer hook declarations; unresolved active-command safety is separately tracked in 101. |

## Semantic assessment

These are conservative design conclusions from Kondo's reader limits, not
claims of newly verified Claude runtime semantics. No hook is executed.

| Case | Why a byte-preserving move is insufficient | Decision |
|---|---|---|
| Scope variables, including `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `$HOME` or `%USERPROFILE%` | Kondo does not resolve them; their referent cannot be certified across contexts | Refuse; never substitute or expand them to manufacture equivalence. |
| Relative references, quoted paths or compound shell commands | The recognizer is not a shell parser. Its project-relative resolution can point to another file after a cross-project move; user-layer relative paths are unverifiable | Refuse any changed or ambiguous referent, including dependencies hidden inside scripts. |
| Absolute path or inline command | A stable script path does not fix working directory, inputs, environment, applicable projects or command side effects | These are not automatically safe exceptions. A `present` script signal is insufficient. |
| Groups, matchers and multiple hooks | The listing loses group boundaries, hook type and other fields; regrouping, ordering or deduplicating can change behavior | Do not reconstruct a group from a displayed row or silently move sibling hooks. |
| Project ↔ local within one project | Sharing a project directory does not prove identical applicability, sharing/ownership or interaction with other layers | No blanket safe lane; retain refusal until independently verified. |
| User ↔ project or project ↔ project | Changes the set of contexts that can run the hook even if the command text is identical | A scope change must be explicit; any changed referent is unsafe. No implicit promotion. |
| Native disable conventions or unknown forms | Kondo implements no verified per-hook switch; moving/removing a group is not evidence of a faithful toggle | Keep read-only; invent no disabled directory, private shadow state or destructive toggle. |
| Two-file apply and Undo | One journal entry alone does not prove atomic application or recovery through external edits and partial failures | Do not repeat the old all-or-nothing guarantee. Existing recovery work remains separate. |

## Conditions for reconsideration

No hook-move implementation task is commissioned. A future owner-approved
proposal needs a bounded plan and fixture proof before changing capabilities:

- Define the unit (whole group or selected member), exact source/destination,
  applicability change and all affected siblings. Preserve unknown bytes and
  refuse unknown semantics, collisions and ambiguous transformations.
- Prove unchanged referents and behavior within the disclosed destination
  scope; abstain when Kondo's privacy boundary prevents that proof. Do not read
  project code or run hooks to classify them.
- Keep I/O and fresh group resolution in main. Pass opaque IDs and reviewed
  intent through the typed bridge, never renderer-authored paths or splices;
  positional scan IDs and truncated display text cannot authorize a write.
- Require fresh source/destination preflight, byte-preserving edits, explicit
  absent-layer creation review, and recovery evidence for both edits, failed
  second steps, concurrent writers, occupied restores and partial/refused Undo.
  Tasks 098 and 099 are relevant prerequisites, not guarantees this task earns.
- Use synthetic fixtures for each variable/path case, same-project and
  cross-project scope, multi-hook groups, matchers, unknown types/fields,
  malformed layers, collisions, stale reviews and recovery failures. Add UI
  review/confirmation evidence only after a bounded workflow is authorized.

Follow-up 110 already depends on this decision and owns remaining in-app
claim reconciliation. It should describe inventoried declarations, say
“Kondo does not support switching individual hooks” rather than make a
universal Claude claim, and describe a null script as “No script recognized.”
Task 101 owns conservative script cleanup. Neither follow-up is implemented
or accepted by this package.

## Seam and implementation changes

None. Only public documentation, this decision record and local Foreman
evidence change. No capability, planner, renderer or test source is modified.

## Observed diagnostic evidence

A disposable probe using `makeWorld`, `registerProjects` and `createWorkspace`
created one command and one unknown-form hook in each of user, project and
local settings. All 24 `entityMutate` requests (six hooks times four operations)
returned `not-permitted` with the matrix's reason. All three settings files
remained byte-identical, `journalList` stayed empty, and an unknown hook scope
denied every operation. This probe ran through the installed `vite-node`
runner; its source and JSON result are retained in local Foreman evidence.
No hook commands ran and no real stores were used.

## Verification checklist

Run these acceptance rows in order; diagnostics do not authorize source fixes.

| Check | Expected | Result |
|---|---|---|
| `npm test` | Existing fixture suite passes | Passed: 40 files; 604 passed, 14 skipped |
| `npm run typecheck` | TypeScript project passes | Passed |
| `npm run lint` | Linted source passes | Passed |
| `git diff --check` | No whitespace errors | Passed; staged diff checked again before commit |

`npm run guards` passed with no findings; paired-change guards are also checked
on the staged documentation before commit. The 14 skipped tests are in the
boundary (13) and mutation (1) suites, which conditionally skip unavailable
fixture symlink creation. They do not establish those cases on this host.
The final diff contains documentation only. Existing `test/hooks.test.ts`
covers script recognition, project grouping and no outside-boundary stat;
`test/kinds.test.ts` and `test/plugin-move.test.ts` pin the refusal behavior.
These establish Kondo behavior, not safe hook relocation or native Claude
execution semantics. Owner acceptance of the decision remains separate.
