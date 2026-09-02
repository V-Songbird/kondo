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
- Revisited 2026-09-02: Claude has *two* per-skill conventions, and kondo
  speaks one. `skills.disabled/` was observed in the wild and is what the
  toggle writes. `skillOverrides` in a settings layer (`'off'`,
  `'user-invocable-only'`) is the documented one, reaches plugin-shipped
  skills, and applies per layer — and kondo does not read it, so a skill
  switched off that way shows as enabled. Reading it is entry 029; the same
  entry decides which convention each scope writes and records the answer
  here, so the two cannot diverge silently.
