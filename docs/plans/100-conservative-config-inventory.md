# Plan: Conservative configuration inventory

Status: **awaiting acceptance**

Configuration cleanup must distinguish a proved absence from a source Kondo
cannot enumerate. Audit A3/A4 exposed directory-plugin disable preferences,
bundled skill overrides and failed plugin reads being treated as leftovers.

## Scope

- Carry completeness alongside installed-plugin inventory; retain readable
  entries and itemized problems when a manifest is partial or unsupported.
- Infer missing marketplace plugins only from a complete supported manifest
  and a recognized marketplace. Preserve directory, inline, synced and unknown
  plugin sources.
- Preserve every skill override: the local listing cannot completely enumerate
  bundled, managed, additional-directory and command sources.
- Re-stat registered project roots for preview and planning; keep proved dead
  entries and their MCP declarations independently of unrelated plugin errors.
- Explain this limit in Settings leftovers and exercise the built fixture app.

## Out of scope

No new plugin loader, skill catalog, IPC surface, store roots or network access.
Policy 098 continues to refuse every write/splice plan and historical Undo
containing either before effects and journal changes. Foreman lifecycle,
integration and acceptance belong to the coordinating task.

## Decisions

| Decision | Rationale |
|---|---|
| Completeness is explicit data | Empty rows after a failed read cannot establish absence. |
| Marketplace identity needs evidence | A new or reserved source may load without installation records. |
| Keep all skill overrides | A fixed list of bundled names would age into unsafe cleanup. |
| Withhold uncertain rows before selection | A visible error alone does not prevent destructive planning. |
| Retain healthy siblings | A partial manifest must not erase readable installed-plugin rows. |

## Seam changes

None. Internal inventory evidence feeds the existing candidate-only response.
Uncertain preferences remain in their original settings files; partial-scan
errors continue through the existing Scan envelope.

## Tests

Synthetic regressions cover directory-plugin and doctor preferences, commands,
unknown skills, invalid/missing/unreadable manifests, unsupported schemas,
partial entries, complete empty inventory, source identity, mixed selection,
and re-reading after preview, including recreated registered project roots.
Candidate/planner behavior is distinct from the mandatory 098 execution refusal. The Electron smoke checks absent unsafe
checkboxes, retained healthy candidates, visible errors, keyboard review/cancel
and unchanged fixture settings/history.

Required: npm test, typecheck, lint, guards (also with owned files staged), build,
test:e2e, git diff --check. Report actual platform skips and limits.

## Done when

Valid or uncertain preferences never enter Settings leftovers selection, while
proved absences remain reviewable and healthy partial inventory stays visible.

## Implementation and verification

Plugin inventory carries complete/partial/unavailable evidence and retains
healthy records. Only recognized marketplace sources can establish absence;
all skill overrides and non-enumerable plugin preferences are preserved.
Preview and removal use the existing forced inventory context to re-stat
registered project roots, including folders recreated without cache changes.
The planner refuses an entire mixed selection when either proof disappears.
The existing settings execution and historical Undo restrictions are unchanged.

Verified on Windows with synthetic stores: 631 tests passed and 14 existing
symlink tests skipped because this host could not create their links. The full
suite ran with two workers and unchanged timeouts; the recreated-project test
also passed with an unaffected plugin in the same selection. Typecheck, lint,
guards with the owned staged surface, build and whitespace checks passed.
The built Electron smoke passed 23/23 with no skips, including the real bridge,
withheld preference checkboxes, degraded-inventory refusal, focus, unchanged
settings/journal bytes and renderer/outbound-request assertions. Chalk/Carbon
captures at 1360x860 and 900x600 were inspected without changing the visual system.

Execution of settings removal is intentionally unavailable under 098; these
checks establish conservative inventory/planning, not successful settings writes.
Final acceptance and integration remain with the coordinating task and owner.
