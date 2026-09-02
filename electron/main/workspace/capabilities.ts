import type { Capabilities, CapabilityDecision, EntityKind } from '../../../shared/contract'

/**
 * The capability matrix: write permission is a lookup on kind × scope ×
 * operation, never a single flag. The same kind is writable in one scope
 * and refused in another — a user skill can be disabled, a plugin-shipped
 * one cannot — so one boolean per entity could only ever be a lie.
 *
 * A row records what *Claude's own conventions* permit (ADR-0006), which is
 * not the same as what kondo implements. `kinds.ts` holds the `enable` /
 * `disable` seats; a row saying `allowed` is the precondition for filling
 * one in, not a claim that it is filled.
 */

const ALLOW: CapabilityDecision = { allowed: true, reason: null }

function deny(reason: string): CapabilityDecision {
  return { allowed: false, reason }
}

// Only a skill is a self-contained directory the user placed by hand. A
// plugin lives where Claude installed it, a hook is a fragment of a settings
// file, and a session belongs to the project it was recorded in.
const ONLY_SKILLS_MOVE = 'Only skills move between scopes; kondo relocates nothing else.'

/** No operation at all is permitted, all three for the same reason. */
function none(reason: string): Capabilities {
  return { enable: deny(reason), disable: deny(reason), move: deny(reason) }
}

/** Neither toggle direction is permitted, and this kind does not relocate. */
function neither(reason: string): Capabilities {
  return { ...none(reason), move: deny(ONLY_SKILLS_MOVE) }
}

const ALREADY_ENABLED = 'Already enabled.'
const ALREADY_DISABLED = 'Already disabled.'
const PLUGIN_OWNED =
  'Plugin-shipped skills follow their plugin — toggle the plugin instead.'
// ADR-0006: Claude has no per-hook disable convention, so kondo invents none.
// This row changes the day a faithful mechanism exists, and not before.
const HOOK_HAS_NO_CONVENTION =
  'Claude has no convention for disabling one hook; edit the settings layer that arms it.'
const NOT_A_TOGGLE = 'A settings layer is a file, not a toggle.'
const SESSIONS_ARE_SWEPT =
  'Sessions have no enabled state; they are swept through the kondo trash.'
// ADR-0009: an MCP server is declared in `~/.claude.json` or in a project's
// `.mcp.json`, and kondo can write neither safely yet — the registry is
// rewritten by Claude mid-session, so a whole-file write would discard its
// changes. Entry 031 brings the splice step that makes this row movable.
const MCP_IS_READ_ONLY =
  'kondo reads MCP servers but does not write ~/.claude.json or .mcp.json yet.'
// ADR-0006: an agent, command, rule or output style is loaded because its
// file is there. Claude ships no `.disabled` sibling for these directories
// and no settings key that benches one, so kondo has no faithful mechanism
// to offer and invents none. This row changes the day one exists.
const PLACED_HAS_NO_CONVENTION =
  'Claude has no convention for disabling one of these; move the file out of the directory instead.'
// Relocating one is entry 028: it generalises the skill placement table so a
// promotion carries the same collision refusal and the same undo.
const PLACED_MOVE_NOT_YET =
  'kondo does not move agents, commands, rules or output styles between scopes yet.'

/** The row every placed kind gets, in every scope it has. */
function placed(): Capabilities {
  return {
    enable: deny(PLACED_HAS_NO_CONVENTION),
    disable: deny(PLACED_HAS_NO_CONVENTION),
    move: deny(PLACED_MOVE_NOT_YET)
  }
}

const STORE_IS_NOT_A_TOGGLE =
  'A store is not a toggle; the tidy sweep is the only thing that writes at this level.'

/**
 * The matrix itself. Second key is the entity's scope — the middle segment
 * of its id (ADR-0008), which is `user` / `project` / `plugin` for skills,
 * the settings layer for hooks and plugins, and the store for sessions.
 */
const MATRIX: Record<EntityKind, Record<string, Capabilities>> = {
  // ~/.claude/skills ⇄ ~/.claude/skills.disabled, and the project-scoped
  // equivalent (domain.md). Every scope a user placed a skill in by hand can
  // also hand it on, so `move` is allowed wherever the skill is the user's —
  // it is the one operation that reads the *source* row and writes elsewhere.
  skill: {
    user: { enable: deny(ALREADY_ENABLED), disable: ALLOW, move: ALLOW },
    'user-disabled': { enable: ALLOW, disable: deny(ALREADY_DISABLED), move: ALLOW },
    plugin: none(PLUGIN_OWNED),
    project: { enable: deny(ALREADY_ENABLED), disable: ALLOW, move: ALLOW },
    'project-disabled': { enable: ALLOW, disable: deny(ALREADY_DISABLED), move: ALLOW }
  },
  // `enabledPlugins` in the settings layer for the scope (domain.md).
  plugin: {
    user: { enable: ALLOW, disable: ALLOW, move: deny(ONLY_SKILLS_MOVE) },
    project: { enable: ALLOW, disable: ALLOW, move: deny(ONLY_SKILLS_MOVE) },
    local: { enable: ALLOW, disable: ALLOW, move: deny(ONLY_SKILLS_MOVE) }
  },
  hook: {
    user: neither(HOOK_HAS_NO_CONVENTION),
    project: neither(HOOK_HAS_NO_CONVENTION),
    local: neither(HOOK_HAS_NO_CONVENTION)
  },
  settings: {
    user: neither(NOT_A_TOGGLE),
    project: neither(NOT_A_TOGGLE),
    local: neither(NOT_A_TOGGLE)
  },
  session: {
    code: neither(SESSIONS_ARE_SWEPT),
    desktop: neither(SESSIONS_ARE_SWEPT)
  },
  project: {
    code: neither(SESSIONS_ARE_SWEPT)
  },
  // Read-only in every scope, and refused here rather than in a view, so an
  // id from the listing cannot be mutated by whatever gets hold of one.
  mcp: {
    user: neither(MCP_IS_READ_ONLY),
    local: neither(MCP_IS_READ_ONLY),
    project: neither(MCP_IS_READ_ONLY)
  },
  // The four hand-placed kinds (domain.md). Same answer in every scope, and
  // a project store has no `output-styles` directory to give that kind one.
  agent: { user: placed(), project: placed() },
  command: { user: placed(), project: placed() },
  rule: { user: placed(), project: placed() },
  'output-style': { user: placed() },
  // No listing produces a `store:` entity — this row exists so the sweep's
  // journal entry can name what it acted on truthfully, and so that anything
  // later reaching for a store-level toggle is refused rather than invented.
  store: {
    user: neither(STORE_IS_NOT_A_TOGGLE),
    desktop: neither(STORE_IS_NOT_A_TOGGLE)
  }
}

/**
 * The matrix row for one kind in one scope. An unrecognized scope refuses
 * every operation rather than throwing (ADR-0005) — a store that grew a
 * scope kondo has not learned yet is read-only until domain.md catches up.
 */
export function capabilitiesFor(kind: EntityKind, scope: string): Capabilities {
  return (
    MATRIX[kind][scope] ??
    none(`kondo does not recognize the ${kind} scope "${scope}"; refusing to write.`)
  )
}

/** The scopes the matrix knows for a kind — the registry publishes these. */
export function scopesFor(kind: EntityKind): readonly string[] {
  return Object.keys(MATRIX[kind])
}
