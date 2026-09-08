# Native conventions over invented state

Kondo could track "disabled" skills and plugins in its own database and
manipulate stores accordingly. But Claude already has conventions:
`~/.claude/skills.disabled/` (a skill moved there stops loading — observed in
the wild), `enabledPlugins` and `skillOverrides` in `settings.json`, hooks
armed by settings entries. State kondo invents would be state Claude ignores
— true in kondo's UI, false in every actual session.

Decision: kondo's mutations speak Claude's own language. Disable a skill =
move it to `skills.disabled` (scoped equivalents for projects). Toggle a
plugin = edit `enabledPlugins` in the target settings layer. Kondo's own data
directory holds only kondo-private things: the journal, trash, UI
preferences, scan cache — never the truth about the user's Claude setup.

## Considered options

- **Kondo-owned toggle database.** Rejected: drifts from reality the moment
  the user edits settings by hand or Claude changes behavior; two sources of
  truth.
- **Symlink tricks** for moves/disables. Rejected: symlinks are second-class
  on Windows (privilege-gated), and Claude's own handling of them is
  unverified.
- **Native conventions (chosen).** The store *is* the state; kondo re-reads
  after every mutation.

## Consequences

- Anything the user does by hand shows up correctly in kondo — it is just a
  reader of the same truth.
- Kondo inherits Claude's convention changes; domain.md tracks them, and an
  unrecognized convention degrades per ADR-0005.
- Some toggles have no native convention yet (e.g. disabling a single hook).
  Those ship only once a faithful mechanism exists, and get their own ADR.
- Agents, commands, rules and output styles have **no** disable convention at
  all: Claude loads them because the file is in the directory, and ships no
  `.disabled` sibling and no settings key that benches one. Kondo lists them
  read-only (entry 024) and the matrix refuses both toggles with that as the
  stated reason, rather than inventing a mechanism that would be true in
  kondo's UI and false in every session.
- Moving one of those four between scopes *is* a native convention, and
  shipped as entry 028. Claude loads an agent because `agents/reviewer.md` is
  in a directory it reads; putting that file in the other scope's `agents/`
  is the whole of what "promote it" means, so kondo does exactly that and
  invents nothing. It is the skill move's plan unchanged — copy, verify,
  trash, one journal entry — because `mutations` verifies a copy by digesting
  the tree and a lone file is a tree of one. One placement table
  (`PLACEMENTS`) now states where every placed kind lives, so skills read
  their own placement from it like the rest. The one refusal that is not a
  collision: an output style has no project destination, because no project
  store has been observed holding `output-styles/` and kondo will not be the
  first to write one.
- Moving a plugin between scopes is not a move at all. Claude installs a
  plugin once and reads `enabledPlugins` per layer, so "on there, off here"
  is two statements in two settings files and nothing on disk changes place.
  Kondo writes exactly those two, in one plan, so ADR-0001's undo restores
  both files or neither.
- Revisited 2026-09-02: Claude has *two* per-skill conventions, and kondo
  speaks one. `skills.disabled/` was observed in the wild and is what the
  toggle writes. `skillOverrides` in a settings layer (`'off'`,
  `'user-invocable-only'`) is the documented one, reaches plugin-shipped
  skills, and applies per layer — and kondo does not read it, so a skill
  switched off that way shows as enabled. Reading it is entry 029; the same
  entry decides which convention each scope writes and records the answer
  here, so the two cannot diverge silently.
- Settled 2026-09-03 (entry 029), against the two Claude Code builds installed
  on the owner's machine (2.1.255 and 2.1.258). **`skills.disabled` is not a
  Claude convention in any scope.** The string does not occur in either
  binary; every `.disabled` hit in them belongs to something else
  (`sandbox.filesystem.disabled`, `install.disabled_by_default`). Claude's own
  in-product line is "Disable in /skills, or remove from .claude/skills.", and
  `/skills` writes `skillOverrides` into the *local* layer. So the answer to
  the question this ADR left open is the same in every scope:

  | Scope | Disable convention Claude honours | What kondo writes (entry 045) |
  |---|---|---|
  | user | `skillOverrides` in `~/.claude/settings.json` | `skillOverrides[<name>] = "off"` in `~/.claude/settings.json` |
  | project | `skillOverrides` in that project's settings layer | the same key in the project layer that already speaks about the skill, else `settings.local.json` |
  | local | `skillOverrides` in `settings.local.json` — where `/skills` writes | the default destination above — kondo and `/skills` write the same file |
  | plugin | none reachable by the user's layers (below) | refused, unchanged |

  The 2026-09-02 entry above is corrected on two further points. Claude pins a
  plugin-shipped skill to `on` *before* consulting `skillOverrides`, so a
  user, project or local layer does **not** reach one — only managed policy
  and CLI flag settings do, and kondo reads neither. And the value set has
  four members, not two: `on`, `name-only`, `user-invocable-only`, `off`.
  Claude's schema describes them as — `name-only` lists the skill without its
  description, `user-invocable-only` hides it from the model but keeps
  `/name`, `off` hides it from both, absent = on. Only `off` is a disabling,
  so only `off` moves kondo's `enabled`.
- Consequence for the toggle kondo ships. Moving a skill out of `skills/` does
  stop Claude loading it — that is the "remove from .claude/skills" half of
  Claude's own advice — so the toggle is not *wrong*; `skills.disabled/` is
  simply kondo's chosen parking spot rather than a bench Claude recognises,
  and this ADR no longer claims otherwise. Entry 029 stopped at reading:
  `SkillInfo` now carries the winning override and an `enabled` that both
  mechanisms have to agree on, and the matrix refuses a toggle that an
  override has already settled, naming the layer. Writing `skillOverrides`
  instead of moving directories is the follow-on, and the splice editor it
  needs already exists — `spliceMember(source, [member, key], literal)` in
  `user-store.ts` takes the member name as a parameter, so `enabledPlugins`
  and `skillOverrides` share one editor and no second one is to be added.
- Written 2026-09-05 (entry 062). A global skill is switched off for one
  project the way Claude's own `/skills` does it from inside that project:
  `skillOverrides[<name>] = "off"` in the project's `settings.local.json`
  (or whichever of its layers already names the skill), and the member
  withdrawn to follow Global again. The project page lists the global skills
  it inherits with exactly that switch; the user layer is never written from
  a project page, so a Global `off` shows as "off in Global" there and is the
  Global page's to change.
- Written 2026-09-05 (entry 061). An MCP server is switched off per project
  the way Claude does it: its name goes into the project's
  `disabledMcpServers` (declared in the registry entry) or
  `disabledMcpjsonServers` (declared in `<project>/.mcp.json`) list in
  `~/.claude.json`, and comes out again to enable. The list is one member,
  so the toggle is one splice of its value and the rest of the registry
  keeps its bytes; the step carries ADR-0010's digest guard because Claude
  rewrites this file during a session. No list exists for the user scope,
  so that row stays refused rather than kondo inventing one, and a
  declaration never moves between files.
- Written 2026-09-05 (entry 045). The skill toggle is now a settings edit in
  Claude's own words: `disable` splices `skillOverrides[<name>] = "off"` into
  a layer of the skill's scope, `enable` takes that member away from every
  layer in the skill's chain that says `off` — one plan, so one undo puts
  every statement back — and nothing new is ever moved into
  `skills.disabled/`. The member is withdrawn rather than set to `"on"`, the
  way the plugin control's "follows global" withdraws a statement instead of
  writing `false`: an absent key is Claude's default, and stating the
  default would be a second convention. The destination file is chosen the
  way the plugin toggle chooses it — the highest-precedence layer of the
  scope that already speaks about the skill, else `settings.local.json`,
  which is where Claude's own `/skills` writes — and a layer not yet on disk
  is asked about first (`needs-confirmation`). A skill still parked in
  `skills.disabled/` keeps its `*-disabled` scope and is offered one thing:
  the way back into `skills/`. If an override also says `off`, the next press
  withdraws it — two honest steps rather than one that does both. The matrix
  reflects the state rather than the directory: a live skill under an `off`
  has `enable` allowed and `disable` refused naming the layer.

## Amendment, 2026-09-03 — a hook does not toggle, but it does move

**Superseded for the proposed 109 boundary by
[ADR-0017](0017-hook-layer-boundary.md), awaiting owner acceptance.** The text
below records the earlier proposal, not shipped behavior. Hook moves are
refused; two splices alone establish neither preserved hook semantics nor
all-or-nothing recovery. Use ADR-0017 and its evidence package for current scope.

Entry 036 splits the hook capability row in two, because one refusal was
covering two different facts.

**Both toggles stay refused, unchanged.** Claude ships no per-hook disable
convention — no `.disabled` sibling, no settings key that benches one — so
kondo invents none. `HOOK_HAS_NO_CONVENTION` still says so, and still names
the settings layer a user would edit instead.

**`move` was refused for the wrong reason.** It carried
`NOTHING_TO_HAND_OVER` — "this kind does not move between scopes" — which is
false. Claude reads a `hooks` object in *every* settings layer, so handing a
hook from one layer to another invents nothing at all: it is remove-the-group
here, insert-the-group there. Two `SpliceEdit`s (ADR-0010, built by entry
031) inside one journal entry, so a single undo puts both files back or
neither. What is missing is the plan, not the mechanism, and the row now says
that: `HOOK_MOVE_NOT_BUILT`.

The plan this ADR licenses, for whoever builds it:

- read both layers in one context, splice the group out of the source and
  into the destination, and journal the pair as one entry (ADR-0001);
- refuse a command naming `$CLAUDE_PROJECT_DIR` or a `.claude/hooks`
  relative path. Both resolve against the layer they sit in, so moving the
  group would silently re-point the script at a different file — the move
  would succeed and the hook would run something else, which is exactly the
  kind of invented state this ADR exists to forbid.
