# Plan: a complete, approachable management workflow

Status: **in progress**

Keep the existing Flat File visual identity while making discovery, project
management, cleanup and recovery understandable without knowing Claude Code's
storage formats. This follows the usability review; its pending roadmap
acceptance and backend release blockers remain separate.

## Scope

- Renderer: start in Library; four primary destinations with purpose labels.
  Put settings leftovers and duplicate skills inside Clean up.
- Library: explain categories, show meaningful locations before technical
  metadata, place management links near the item heading, and return to the
  same item/filter after managing it in a project.
- Projects: an overview followed by focused Skills, Plugins, Connections,
  Tools, Conversations and Technical details sections. Explain global vs
  project scope; reset pending operations when switching projects.
- Cleanup: choose, review, move to trash, then undo. Explain that moving bytes
  to trash does not release disk space until the trash is emptied. Keep every
  selection explicit and the irreversible trash operation separate.
- Layout and interaction: at the minimum 900 x 600 window, show a usable
  browser or detail pane instead of squeezing three columns. Preserve native
  keyboard behavior and move focus when its originating control disappears.
- Documentation: update DESIGN, vocabulary, user-facing navigation references,
  architecture notes and the changelog with the implemented workflow.

## Out of scope

New store adapters, permissions or mutation capabilities; release-blocking
backend findings recorded in the previous review; real-store mutation;
rebranding, localization, onboarding accounts or network services.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Library is the initial destination. | Find a named skill or plugin without first knowing its project. |
| 2 | Four destinations: Library, Projects, Clean up, History. | Reflect user goals; cleanup subviews distinguish the different operations. |
| 3 | Keep warm surfaces, Plex fonts, flat rules and established status colors. | Preserve the identity the owner likes while changing hierarchy and flow. |
| 4 | Use native buttons, select controls and details disclosures. | Avoid introducing incomplete custom tab or menu keyboard patterns. |
| 5 | Paths, hashes and raw settings are optional detail; errors remain visible. | Reduce reading burden without hiding uncertainty or refusals. |
| 6 | Project and Library selection live in App; confirmations belong to their mounted scope. | Returning should preserve context; changing scope must never carry a stale confirmation. |
| 7 | Explain configured state separately from runtime availability. | Kondo reads local data and cannot establish that a server is connected. |

## Seam changes

None. Continue using the typed bridge and opaque entity/project IDs. All
development and test writes target synthetic fixture roots only.

## Tests

- Launch Electron with all fixture root overrides. Assert Library starts
  selected and exactly four destinations are present.
- Browse a skill, open the matching project section, return, and verify the
  selection and search survive; verify meaningful focus after transitions.
- At 900 x 600, inspect browser/detail/confirmation geometry and screenshots;
  assert no horizontal document overflow and usable visible controls.
- Exercise native keyboard navigation/disclosures and confirmation Escape.
  Cancellation must leave journal/settings bytes unchanged.
- Apply one fixture-backed change through visible controls, undo it, and
  verify restoration and accessible result feedback.
- Check all cleanup subviews, partial-read feedback and separate permanent
  deletion confirmation. Run unit tests, typecheck, lint, guards and build.

## Done when

A person can find a skill, understand where it is available, manage it in the
correct project, undo the change and return to the same Library item. Cleanup
has an explicit review step and understandable consequences. The workflow is
usable with keyboard and at the minimum window size, with fixture evidence.
