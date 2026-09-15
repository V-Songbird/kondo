# Plan: trustworthy inventory and easier Claude Code management

Status: **done — shipped in `0db352f`, accepted 2026-09-06**. Later work
superseded parts of it: Library became the first screen (ADR-0012), the P1
findings below became tasks 074, 097, 098, 099 and 100, all shipped, and the
P2 findings remain open as 103, 104 and 106.

Review Kondo against its current roadmap and Claude Code conventions, keeping
the Flat File visual system. Make missing information visible and give people
a clear route from finding a skill or plugin to managing it.

## Scope

- Roadmap 087: readable label/value rows and inline explanations of partial changes.
- Roadmap 090: named controls, keyboard session details, safe confirmation focus,
  announced outcomes and a skip link.
- Library: report all scan failures alongside partial data, explain the kinds in
  plain language, and open an item's existing Projects management screen.
- Roadmap 095: isolate malformed journal records and steps so healthy history
  stays readable and usable.
- Verify plugin cleanup against installations in multiple scopes; preserve every
  declared installation when deciding which cache versions are leftover.

## Out of scope

Releasing, merging, real-store mutations, a visual rebrand, implementing new
Claude features, and the full release backlog. Broader compatibility gaps and
the remaining atomic-write work (074) get evidence and a next step here.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep Projects as the initial destination and existing navigation labels. | The owner likes the current interface; improve comprehension within it. |
| 2 | Library links to existing project controls. | A second mutation UI would duplicate confirmations and scope semantics. |
| 3 | A failed scan never becomes an empty or healthy verdict. | Partial inventory is useful only when its limits are visible. |
| 4 | Use invented fixtures for every mutation and UI run. | Keep actual Claude data outside development operations. |

## Seam changes

None planned. Navigation carries the existing opaque project ids. Inventory and
mutation changes stay within the existing workspace contracts.

## Tests

- Existing unit suite, typecheck and lint must pass.
- Append malformed valid JSON and malformed step shapes beside valid journal
  records; list and undo must preserve healthy records and report bad lines.
- Multiple installation records must keep all active cache versions out of cleanup.
- Built Electron smoke: keyboard entry into session details; named controls;
  staged moves change nothing until confirmation; Library management navigation;
  errors and unknown entries remain visible beside partial data.
- Inspect screenshots at normal and minimum window widths using synthetic data.

## Done when

People can find an item, understand where it is configured, reach its existing
management controls, and see any incomplete reads or changes. Verification and
remaining release blockers are recorded below before this work is reported.

## Verification and delivered behavior

Validated on Windows with fnm Node 22.22.2: `npm test` **364/364**,
`npm run typecheck`, `npm run lint`, `npm run guards`, `npm run build`, and
the built Electron smoke **10/10**. The initial baseline was 354 unit tests.
Every mutation ran against invented fixtures; no actual Claude store was used.
The unstaged guard run skips the two checks that require a staged diff; the
commit hook checks those with the documentation included.
Foreman's structural check reports zero errors and one existing warning:
`fableEnabled` is not recognized by the installed Codex Foreman. The setting
was preserved; this review does not migrate project tooling configuration.

The new smoke coverage reaches a skill's project from Library, opens session
details with Enter, cancels a staged move with Escape and verifies unchanged
journal bytes, preserves healthy items after a malformed MCP read, and proves
that inline Undo reports success and restores exact settings bytes even when
another journal line is invalid. The native UI retains the Flat File look.
Malformed undo/failure records retain readable references only as conservative
blocks: corrupting a past undo cannot permit a second undo over later edits.
Screenshots were inspected at 1360×860 and 900×600; narrow tables scroll inside
the detail pane. No macOS/Linux or packaged-installer validation was performed.

Library's eleven reads now report their failure/error/unknown states, and its
history and plugin-skill detail reads keep their own diagnostics. Kinds get
plain-language descriptions. Management links use existing project ids, preserve
distinct projects with the same name, and avoid listing every silent project
under a plugin. Per-project MCP management links remain unavailable because
that DTO carries a flattened project name rather than an opaque project id.

## Remaining findings and next work

These findings are review results, not release acceptance. Code locations name
symbols so subsequent edits do not invalidate line numbers. Claude compatibility
sources and the distinction between documented conventions and implemented
readers are in [domain.md](../domain.md#claude-code-compatibility-review--2026-09-06).

| Priority | Evidence and consequence | Next verification |
|---|---|---|
| P1 | `mutations.ts:resolveIn` checks paths lexically. An ancestor junction in a fixture allowed a splice outside its store. Existing task **074**. | Canonical containment for existing ancestors and targets; distinguish editing through a link from moving the link itself. Assert external sentinel bytes remain unchanged. |
| P1 | `replaceAtomically` can leave a partially written `.kondo-*` file and does not sync the temporary file; a final symlink is replaced. Partial-write residue reproduced; final symlink behavior is code evidence because Windows refused creating that test link. **074**. | Exclusive temp creation, sync, finally cleanup, supported link fixtures. |
| P1 | `undoLinks` includes failed undo attempts. A fixture `stale-file` refusal caused the original entry to read as already undone and blocked retry. | Separate failure markers, failed attempts and completed undo; test both zero-effect rejection and a partially applied undo before defining retry behavior. |
| P1 | A fixture write between the splice digest check and rename was overwritten. A second digest check alone cannot prove exclusion from a concurrent Claude process. | Revisit ADR-0010's concurrency guarantee and preserve recoverable bytes; test interleaved writes rather than claiming an absolute guarantee. |
| P1 | Configuration-orphan discovery assumes unlisted plugins and diskless skills are obsolete. `@skills-dir` plugins and built-in skill overrides invalidate that inference; removal can undo a valid disable preference. | Fixtures for directory-discovered plugins and built-in skills; offer removal only when absence is established. |
| P2 | MCP `enabled` does not cover all current approval/disable layers, and a displayed `on` does not establish runtime availability. | Reconcile current settings, per-project disable lists and approvals with a faithful DTO and toggle fixtures. |
| P2 | Plugin inventory still selects its first installation and reads only `<install>/skills/`; custom layouts and command-based skills are missing. The cleanup protection for every installation is fixed separately. | Multiple-scope inventory plus one fixture for each supported plugin layout. |
| P2 | Locator ignores `CLAUDE_CONFIG_DIR`; it can show the default profile instead of Claude's selected profile. | Injected alternate-profile fixtures with explicit Kondo fixture-root precedence. |

The existing queue retains **16 planned tasks**; 087, 090 and 095 are implemented
for acceptance. This review did not perform 071's copied-real-store rehearsal,
installer verification, repository-publication cleanup or a release. Prioritize
the P1 findings before introducing additional cleanup actions.

## Interface direction after review

Keep the current visual identity. The next design pass can put management
actions beside each location and collapse hashes, layer paths and internal ids
under optional details. A separate decision is whether Library should become
the first screen; this implementation preserves Projects. Avoid interpreting
unknown or pending states as disabled, and name Global as applying across projects.
