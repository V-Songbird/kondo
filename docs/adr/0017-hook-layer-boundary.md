# Keep hook declarations read-only until semantics are proven

Kondo keeps hook declarations read-only: inventory and limited script
diagnostics, but no layer move, individual enable/disable or declaration
removal. The capability matrix refuses all four operations in user, project
and local layers and in unknown scopes, and `kinds.hook.plan` returns that
refusal without building steps.

`HookInfo` is a display projection. It flattens groups and carries only a
documented event, handler type, matcher presence and script status — no command
text, matcher patterns or script paths
([ADR-0022](0022-project-settings-data-deny-by-default.md)) — so it cannot
reconstruct a declaration or authorize a write. The script recognizer neither
parses shell semantics nor executes or reads a script. A stable path cannot
establish unchanged working directory, environment, event inputs, layer
interaction or applicability, so copying the same bytes into another layer
cannot certify an equivalent hook:

| Case | Why a byte-preserving move is insufficient |
|---|---|
| Scope variables (`$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `$HOME`, `%USERPROFILE%`) | Kondo does not resolve them, so their referent cannot be certified across contexts. |
| Relative, quoted or compound commands | The recognizer is not a shell parser; a project-relative reference can point at another file after a cross-project move. |
| Absolute paths and inline commands | A stable path does not fix working directory, inputs, environment or applicable projects. |
| Groups, matchers, multiple hooks | The listing loses group boundaries and fields; regrouping or reordering can change behaviour. |
| Project ↔ local, user ↔ project | Sharing a directory does not prove identical applicability; a scope change alters which contexts run the hook. |
| Two-file apply and Undo | One journal entry does not prove atomic application or recovery through external edits and partial failure. |

## Considered options

- **Retain read-only declarations (chosen).** Matches the implemented
  behaviour and preserves unknown configuration without asserting equivalence
  the inventory cannot prove.
- **Commission a bounded move now.** Potentially useful, including between
  project and local settings, but there is no fixture-proven semantic subset
  or recovery contract to release.
- **Treat any group transfer as two reversible edits.** Rejected: preserving
  bytes and having a journal do not preserve referents, applicable contexts,
  group behaviour or recovery under partial failure.
- **Invent a hook disable state or rewrite paths to make moves work.** Rejected:
  no verified native per-hook switch exists, and ambiguous rewrites violate the
  native-convention and privacy boundaries.

## Consequences

All store I/O stays in main behind the typed bridge, inside approved roots;
the renderer cannot supply paths or reconstructed hook groups. Hook-script
cleanup is a separate capability and retains every script (ADR-0002).

## Reconsidering hook moves

A future owner-approved proposal needs a bounded plan and fixture proof before
any capability changes:

- Define the unit (whole group or selected member), exact source and
  destination, applicability change and affected siblings; preserve unknown
  bytes and refuse unknown semantics, collisions and ambiguous transformations.
- Prove unchanged referents and behaviour within the disclosed destination
  scope, abstaining where the privacy boundary prevents that proof, without
  reading project code or running hooks.
- Keep I/O and fresh group resolution in main and pass opaque ids and reviewed
  intent; positional scan ids and display text cannot authorize a write.
- Require fresh preflight, byte-preserving edits, explicit absent-layer
  creation review, and recovery evidence for both edits, a failed second step,
  concurrent writers, occupied restores and partial or refused Undo — which
  also depends on settings writes being re-enabled (ADR-0010).
- Cover each variable and path case, same- and cross-project scope, multi-hook
  groups, matchers, unknown types and fields, malformed layers, collisions,
  stale reviews and recovery failures with synthetic fixtures.
