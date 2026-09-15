# Keep hook declarations read-only until semantics are proven

Status: **accepted by the owner — decision 109**

Keep hook declarations read-only in Kondo. Inventory and limited script
diagnostics have shipped; layer moves, individual enable/disable and declaration
removal have not. Correct the public shipped claims to match the refusing
capability matrix and planner. This supersedes only ADR-0006's 2026-09-03 hook
amendment, whose two-splice proposal does not establish semantic preservation
or all-or-nothing recovery.

`HookInfo` is a display projection: it flattens groups and truncates commands.
The script recognizer neither parses shell semantics nor executes or reads a
script. A stable path cannot establish unchanged working directory, environment,
event inputs, layer interaction or applicability. Copying the same bytes into
another layer therefore cannot certify an equivalent hook. The
[decision package](../plans/109-hook-layer-boundary.md) records the source
evidence, cases and conditions for reconsideration.

## Considered options

- **Retain read-only declarations and correct claims (chosen).** Matches the
  shipped behavior and preserves unknown configuration without asserting
  equivalence the current inventory cannot prove.
- **Commission a bounded move now.** Potentially useful, including between
  project and local settings, but there is no fixture-proven semantic subset
  or recovery contract to release. A separate owner-approved plan must first
  establish these; this decision does not commission it.
- **Treat any group transfer as two reversible edits.** Rejected: preserving
  bytes and having a journal do not preserve referents, applicable contexts,
  group behavior or recovery under partial failure.
- **Invent a hook disable state or rewrite paths to make moves work.** Rejected:
  no verified native per-hook switch is implemented, and ambiguous rewrites
  violate the native-convention and privacy boundaries.

## Consequences

All hook declaration operations remain refused in user, project and local
layers; unknown forms remain read-only. Any future proposal must disclose its
exact scope and refuse changed or ambiguous referents instead of rewriting
semantics. All store I/O stays in main behind the typed bridge, inside approved
roots. The renderer cannot supply paths or reconstructed hook groups.

The existing user-store script cleanup remains a separate capability with its
own safety work (101); this is not approval of its current inference. Likewise,
concurrent writes and partial Undo remain separate work (098/099). The phrase
“not built yet” in the current move refusal reports absence of an implementation,
not a delivery commitment. Product-copy follow-up 110 should use the inventory
and support limits documented here. No code changes or release acceptance are
part of this decision.

## Amendment (117)

`HookInfo` no longer carries command text, matcher patterns or script paths:
only a documented event, handler type, matcher presence and script status
([ADR-0022](0022-project-settings-data-deny-by-default.md)). It still flattens
groups, so it still cannot reconstruct a declaration or authorize a write.
