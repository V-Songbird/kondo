import type {
  Capabilities,
  CapabilityDecision,
  EntityKind,
  SkillOverrideState
} from '../../../shared/contract'

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
 *
 * `trash` is the exception that proves it: Claude has no convention for
 * removing anything, so that column says what kondo is willing to displace
 * into its own trash (ADR-0001) rather than what Claude permits.
 */

const ALLOW: CapabilityDecision = { allowed: true, reason: null }

function deny(reason: string): CapabilityDecision {
  return { allowed: false, reason }
}

// What is left once skills and plugins are accounted for. A hook is a
// fragment of a settings file, a session belongs to the project it was
// recorded in, and a store is not somewhere else's to be — none of the three
// is a thing one scope can hand to another.
const NOTHING_TO_HAND_OVER = 'This is not something kondo can move somewhere else.'

/**
 * The two things kondo removes on its own: a skill the user placed, once the
 * duplicate listing has shown a copy of it somewhere else, and a Claude Code
 * session the user picked out of a project. Everything else here is either
 * Claude's to install and uninstall or a fragment of a file, so the row
 * denies `trash` rather than offering a displacement nobody asked for. This
 * changes per kind the day one of them earns it, not before.
 */
const NOT_KONDOS_TO_REMOVE =
  'Kondo moves a duplicate skill and a session you picked to its trash; this stays where it is.'

/** No operation at all is permitted, all four for the same reason. */
function none(reason: string): Capabilities {
  return {
    enable: deny(reason),
    disable: deny(reason),
    move: deny(reason),
    trash: deny(reason)
  }
}

/** Neither toggle direction is permitted, and this kind does not relocate. */
function neither(reason: string): Capabilities {
  return {
    ...none(reason),
    move: deny(NOTHING_TO_HAND_OVER),
    trash: deny(NOT_KONDOS_TO_REMOVE)
  }
}

const ALREADY_ENABLED = 'Already enabled.'
const ALREADY_DISABLED = 'Already disabled.'
const PLUGIN_OWNED =
  'Plugin-shipped skills follow their plugin — toggle the plugin instead.'
// ADR-0006: Claude has no per-hook disable convention, so kondo invents none.
// This row changes the day a faithful mechanism exists, and not before.
const HOOK_HAS_NO_CONVENTION =
  'Claude has no way to switch off one hook; edit the settings file that runs it.'
/**
 * Moving a hook is a different question from disabling one, and it gets a
 * different answer. A hook lives in the `hooks` object of one settings
 * layer, and Claude reads that object in every layer, so handing one to
 * another layer invents nothing: it is remove-the-group here, insert-the-
 * group there — two `SpliceEdit`s (entry 031) inside one journal entry, so
 * a single undo puts both files back or neither.
 *
 * What is missing is the plan, not the mechanism, so the row says "not
 * yet" rather than "never" — the old text called a two-layer settings edit
 * impossible, which it is not. When the plan lands it refuses a command
 * naming `$CLAUDE_PROJECT_DIR` or a `.claude/hooks` relative path: both
 * resolve against the layer they sit in, so moving the group would silently
 * re-point the script at a different file.
 */
const HOOK_MOVE_NOT_BUILT =
  'Moving a hook between settings files is two edits kondo has not built yet; edit both files by hand for now.'

/** The row every hook gets, in every layer that can hold one. */
function hook(): Capabilities {
  return {
    enable: deny(HOOK_HAS_NO_CONVENTION),
    disable: deny(HOOK_HAS_NO_CONVENTION),
    move: deny(HOOK_MOVE_NOT_BUILT),
    trash: deny(NOT_KONDOS_TO_REMOVE)
  }
}
const NOT_A_TOGGLE = 'A settings file is a file, not a toggle.'
const SESSIONS_ARE_SWEPT =
  'Sessions are not on or off; Clean up moves them to kondo’s trash.'
// ADR-0009: an MCP server is declared in `~/.claude.json` or in a project's
// `.mcp.json`, and kondo can write neither safely yet — the registry is
// rewritten by Claude mid-session, so a whole-file write would discard its
// changes. Entry 031 brought the splice step and entry 061 wired the toggle
// to it: a project's `disabledMcpServers` / `disabledMcpjsonServers` list in
// `~/.claude.json` is Claude's own per-project switch (domain.md). The user
// scope has no such list, and a declaration is never moved between files.
const MCP_USER_HAS_NO_SWITCH =
  'Claude has no disable list for a user-scope MCP server; remove the declaration from ~/.claude.json to stop it.'
const MCP_STAYS_PUT =
  'An MCP server is declared where Claude reads it; kondo does not move declarations between files.'
const MCP_PROJECT_IS_GONE =
  'The folder this declaration points at is gone; Leftovers removes the whole entry instead.'
// ADR-0006: an agent, command, rule or output style is loaded because its
// file is there. Claude ships no `.disabled` sibling for these directories
// and no settings key that benches one, so kondo has no faithful mechanism
// to offer and invents none. This row changes the day one exists.
const PLACED_HAS_NO_CONVENTION =
  'Claude has no way to switch one of these off; move the file out of the folder instead.'

/**
 * The row every placed kind gets, in every scope it has. Relocating one *is*
 * Claude's own convention (ADR-0006): the file sits in the other scope's
 * directory and Claude loads it there for the same reason it loaded it here,
 * so nothing is invented and `move` is allowed wherever the entry is the
 * user's own. Which destinations exist is a separate question the placement
 * table answers — a project store holds no `output-styles`.
 */
function placed(): Capabilities {
  return {
    enable: deny(PLACED_HAS_NO_CONVENTION),
    disable: deny(PLACED_HAS_NO_CONVENTION),
    move: ALLOW,
    trash: deny(NOT_KONDOS_TO_REMOVE)
  }
}

const STORE_IS_NOT_A_TOGGLE =
  'A store is not a toggle; Clean up is the only thing that writes at this level.'

/**
 * The matrix itself. Second key is the entity's scope — the middle segment
 * of its id (ADR-0008), which is `user` / `project` / `plugin` for skills,
 * the settings layer for hooks and plugins, and the store for sessions.
 */
const MATRIX: Record<EntityKind, Record<string, Capabilities>> = {
  // A live skill toggles through `skillOverrides` in its scope's settings
  // layer (ADR-0006, entry 045): `disable` states `off`, `enable` withdraws
  // it — see `skillCapabilities`, which flips the two once an override is in
  // force. The `*-disabled` rows are skills already parked in
  // `skills.disabled/`, kondo's own bench and not a Claude convention; nothing
  // new goes there, and the one thing offered is the way back into `skills/`.
  // Every scope a user placed a skill in by hand can also hand it on, so
  // `move` is allowed wherever the skill is the user's — it is the one
  // operation that reads the *source* row and writes elsewhere.
  skill: {
    user: { enable: deny(ALREADY_ENABLED), disable: ALLOW, move: ALLOW, trash: ALLOW },
    'user-disabled': {
      enable: ALLOW,
      disable: deny(ALREADY_DISABLED),
      move: ALLOW,
      trash: ALLOW
    },
    plugin: none(PLUGIN_OWNED),
    project: { enable: deny(ALREADY_ENABLED), disable: ALLOW, move: ALLOW, trash: ALLOW },
    'project-disabled': {
      enable: ALLOW,
      disable: deny(ALREADY_DISABLED),
      move: ALLOW,
      trash: ALLOW
    }
  },
  // `enabledPlugins` in the settings layer for the scope (domain.md). A
  // plugin moves as well, and moves nothing on disk while doing it: handing
  // one scope's plugin to another is a `false` here and a `true` there, which
  // is what Claude's own convention says (ADR-0006) and all it says.
  plugin: {
    user: { enable: ALLOW, disable: ALLOW, move: ALLOW, trash: deny(NOT_KONDOS_TO_REMOVE) },
    project: { enable: ALLOW, disable: ALLOW, move: ALLOW, trash: deny(NOT_KONDOS_TO_REMOVE) },
    local: { enable: ALLOW, disable: ALLOW, move: ALLOW, trash: deny(NOT_KONDOS_TO_REMOVE) }
  },
  hook: {
    user: hook(),
    project: hook(),
    local: hook()
  },
  settings: {
    user: neither(NOT_A_TOGGLE),
    project: neither(NOT_A_TOGGLE),
    local: neither(NOT_A_TOGGLE)
  },
  // A session has no enabled state and belongs to the project it was
  // recorded in, so three of the four columns refuse. `trash` is the one
  // kondo owns (ADR-0001): the sweep already displaces sessions by category,
  // and `sessionTrash` is the same displacement for a set picked by hand.
  // Only the Claude Code store — kondo reads the desktop store's sessions
  // and has no plan that writes it.
  session: {
    code: { ...neither(SESSIONS_ARE_SWEPT), trash: ALLOW },
    desktop: neither(SESSIONS_ARE_SWEPT)
  },
  project: {
    code: neither(SESSIONS_ARE_SWEPT)
  },
  // Read-only in every scope, and refused here rather than in a view, so an
  // id from the listing cannot be mutated by whatever gets hold of one.
  mcp: {
    user: neither(MCP_USER_HAS_NO_SWITCH),
    local: {
      enable: deny(ALREADY_ENABLED),
      disable: ALLOW,
      move: deny(MCP_STAYS_PUT),
      trash: deny(NOT_KONDOS_TO_REMOVE)
    },
    project: {
      enable: deny(ALREADY_ENABLED),
      disable: ALLOW,
      move: deny(MCP_STAYS_PUT),
      trash: deny(NOT_KONDOS_TO_REMOVE)
    }
  },
  // The four hand-placed kinds (domain.md). Same answer in every scope, and
  // a project store has no `output-styles` directory to give that kind one —
  // which is also why a promotion out of the user scope is refused for it.
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
    none(`Kondo does not recognize the ${kind} scope "${scope}", so it will not write here.`)
  )
}

/** The scopes the matrix knows for a kind — the registry publishes these. */
export function scopesFor(kind: EntityKind): readonly string[] {
  return Object.keys(MATRIX[kind])
}

/**
 * One skill's matrix row, narrowed by whatever `skillOverrides` says about
 * it. The matrix answers kind × scope, which is what Claude's conventions
 * permit *in general*; an override is a fact about this one skill in this one
 * layer chain, so it narrows the row here rather than becoming a sixth scope
 * the table would have to carry for every kind.
 *
 * Claude has two per-skill mechanisms and they are independent (ADR-0006):
 * the directory a skill sits in, and `skillOverrides` in a settings layer.
 * kondo's toggle writes the first, so when the second already says `off` the
 * toggle has nothing to offer in either direction — moving a skill back into
 * `skills/` does not turn it on while a layer switches it off, and moving it
 * to the bench does not turn off something already off. Both refusals name
 * the layer, because that file is where the state actually lives and editing
 * it is the only thing that would change the answer.
 *
 * Only `off` narrows anything. `name-only` and `user-invocable-only` leave
 * the skill loaded (domain.md), so a bench move still means what it means.
 */
/**
 * The mcp row narrowed by what the project's disable list already says
 * (entry 061): a listed server offers `enable`, an unlisted one `disable`, and
 * a declaration whose project folder is gone offers neither — its whole entry
 * is a configuration orphan, and Leftovers is where that goes (ADR-0010).
 */
export function mcpCapabilities(scope: string, enabled: boolean, orphan: boolean): Capabilities {
  const row = capabilitiesFor('mcp', scope)
  if (scope === 'user') return row
  if (orphan) return { ...row, enable: deny(MCP_PROJECT_IS_GONE), disable: deny(MCP_PROJECT_IS_GONE) }
  return enabled ? row : { ...row, enable: ALLOW, disable: deny(ALREADY_DISABLED) }
}

const PROJECT_SAYS_NOTHING = 'This project does not switch the skill off itself; it follows Global.'
const PROJECT_SAYS_OFF = 'This project already switches the skill off in its own settings.'

/**
 * The per-project toggle of a global skill (entry 062): one direction at a
 * time, decided by what the project's own layers say. Neither direction
 * touches the user layer, and a skill is never moved or trashed from here.
 */
export function inheritedSkillCapabilities(choice: 'off' | 'inherit'): Capabilities {
  return {
    enable: choice === 'off' ? ALLOW : deny(PROJECT_SAYS_NOTHING),
    disable: choice === 'inherit' ? ALLOW : deny(PROJECT_SAYS_OFF),
    move: deny('A global skill is moved from the Global page, not from a project that inherits it.'),
    trash: deny('A global skill is removed from the Global page, not from a project that inherits it.')
  }
}

export function skillCapabilities(
  scope: string,
  override: SkillOverrideState | null
): Capabilities {
  const row = capabilitiesFor('skill', scope)
  if (override === null || override.value !== 'off') return row
  // An `off` in force is the disabled state itself, so the toggle offered is
  // the one that withdraws it (entry 045). For a benched skill that is also
  // switched off, `enable` still means the way back into `skills/` first —
  // the row stays as it is, and the override is dealt with on the next press.
  const benched = scope === 'user-disabled' || scope === 'project-disabled'
  return {
    ...row,
    enable: benched ? row.enable : ALLOW,
    disable: deny(
      `${override.layerPath} already switches this skill off with skillOverrides.`
    )
  }
}
