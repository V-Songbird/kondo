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

/** Neither direction is permitted, for the same reason. */
function neither(reason: string): Capabilities {
  return { enable: deny(reason), disable: deny(reason) }
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

/**
 * The matrix itself. Second key is the entity's scope — the middle segment
 * of its id (ADR-0008), which is `user` / `project` / `plugin` for skills,
 * the settings layer for hooks and plugins, and the store for sessions.
 */
const MATRIX: Record<EntityKind, Record<string, Capabilities>> = {
  // ~/.claude/skills ⇄ ~/.claude/skills.disabled, and the project-scoped
  // equivalent (domain.md).
  skill: {
    user: { enable: deny(ALREADY_ENABLED), disable: ALLOW },
    'user-disabled': { enable: ALLOW, disable: deny(ALREADY_DISABLED) },
    plugin: neither(PLUGIN_OWNED),
    project: { enable: deny(ALREADY_ENABLED), disable: ALLOW },
    'project-disabled': { enable: ALLOW, disable: deny(ALREADY_DISABLED) }
  },
  // `enabledPlugins` in the settings layer for the scope (domain.md).
  plugin: {
    user: { enable: ALLOW, disable: ALLOW },
    project: { enable: ALLOW, disable: ALLOW },
    local: { enable: ALLOW, disable: ALLOW }
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
  }
}

/**
 * The matrix row for one kind in one scope. An unrecognized scope refuses
 * both operations rather than throwing (ADR-0005) — a store that grew a
 * scope kondo has not learned yet is read-only until domain.md catches up.
 */
export function capabilitiesFor(kind: EntityKind, scope: string): Capabilities {
  return (
    MATRIX[kind][scope] ??
    neither(`kondo does not recognize the ${kind} scope "${scope}"; refusing to write.`)
  )
}

/** The scopes the matrix knows for a kind — the registry publishes these. */
export function scopesFor(kind: EntityKind): readonly string[] {
  return Object.keys(MATRIX[kind])
}
