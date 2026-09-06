# Organize navigation around user tasks

Kondo opens in Library and offers four primary destinations: Library,
Projects, Clean up and History. A named item is the starting point for
discovery; a project is the context for management. Clean up groups file
cleanup, settings leftovers and duplicate skills, with separate selections
and confirmations. History presents changes and Undo before permanent trash
deletion. Preserve the Flat File identity while explaining the purpose of
each destination and disclosing technical metadata only when needed.

The earlier project-first view required users to know an item's location
before finding it. The five-destination view separated closely related
cleanup tasks and placed full project inventories on one long page. At the
minimum desktop width, a sidebar, browser and detail squeezed the actual
management controls. These were obstacles to the owner's goal of making
Kondo useful without detailed knowledge of Claude's storage conventions.

## Considered options

- **A destination for every entity kind.** Requires technical vocabulary and
  spreads one project's management across many screens.
- **A single project page with all controls.** Preserves local context, but
  makes finding an item and distinguishing applicable actions difficult.
- **A dashboard followed by task-oriented views (chosen).** Library explains
  the available kinds and opens the matching project section. Projects offers
  an overview followed by one category at a time. Existing mutation controls
  remain the authority for each capability.

## Consequences

- `App` keeps navigation context; feature components keep pending operations.
  Returning restores item/filter state, while changing or closing a project
  discards its pending confirmation.
- Below 1180px the workspace shows a browser or a detail pane. Back and resize
  transitions must leave keyboard focus on visible content.
- No new bridge methods or store access are needed. Opaque IDs continue to
  select management locations; display paths never become mutation inputs.
- Reading failures and refusals stay visible. A local connection setting does
  not establish runtime connectivity. Findings require review before removal.
- Moving files to trash is reversible while restore data exists and still
  consumes disk space. Permanent deletion remains a separate explicit action.

The [workflow plan](../plans/2026-09-06-ux-workflow.md) and
[design system](../../DESIGN.md) describe the implementation and validation.
