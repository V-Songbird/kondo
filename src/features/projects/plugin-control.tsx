import { useId, useState } from 'react'
import type {
  ProjectPluginChoice,
  ProjectPluginState,
  PluginScopeState
} from '../../../shared/contract'
import type { Destination } from './projects'
import { MovePicker } from '../../ui/move-picker'
import { Refusal } from '../../ui/refusal'
import { SETTINGS_WRITES_SUSPENDED } from '../../lib/claims'

/**
 * One plugin's three-way control for one scope, plus the layer strip behind a
 * disclosure.
 *
 * The three positions are the whole vocabulary a user needs: on here, off
 * here, or follow whatever the global setting says. Which *file* that writes
 * is policy the main process chose (`targetLayerId`) — the strip below is
 * where the settings files are still visible for anyone who wants them, and
 * it is closed by default because a row of near-identical chips is what made
 * the old plugins view unreadable.
 *
 * Whatever refuses here says so in print. A dark three-way control with the
 * reason hidden in a tooltip reads as a broken app, which is the one thing a
 * refusal must never look like.
 */

/** Nothing stated at this level is "follows global" in a project, and simply
 *  "not set" in the user store, which has nothing above it to follow. */
function inheritLabel(global: boolean): string {
  return global ? 'Not set' : 'Follow shared setting'
}

function positions(global: boolean): Array<{ choice: ProjectPluginChoice; label: string }> {
  return [
    { choice: 'on', label: global ? 'On' : 'On here' },
    { choice: 'off', label: global ? 'Off' : 'Off here' },
    { choice: 'inherit', label: inheritLabel(global) }
  ]
}

function stateLabel(scope: PluginScopeState): string {
  if (scope.enabled === null) return 'not set'
  if (scope.enabled === 'unknown') return 'unrecognized value'
  return scope.enabled ? 'on' : 'off'
}

/**
 * Why the picker is dark. A move is a `false` here and a `true` there
 * (ADR-0006) — two settings edits, and ADR-0010 refuses every plan that
 * writes one, so the suspension is the first answer and the only one a user
 * can act on. The narrower reasons still rank behind it: a scope that never
 * turned the plugin on would have nothing to hand over even if writes were
 * available, and main refuses that case by name.
 */
function moveRefusal(state: ProjectPluginState): string {
  if (!state.capabilities.move.allowed) {
    return state.capabilities.move.reason ?? 'kondo cannot move this plugin.'
  }
  return state.choice === 'on'
    ? SETTINGS_WRITES_SUSPENDED
    : 'Turn this plugin on here before moving its activation to another project.'
}

/**
 * No `busy` prop: every control here is disabled while settings writes are
 * refused, so there is no in-flight state for it to reflect. It comes back
 * with the writes.
 */
export function PluginControl({
  state,
  global,
  destinations,
  onChoose,
  onMove
}: {
  state: ProjectPluginState
  global: boolean
  /** Every scope but this one; ids, never paths (ADR-0008). */
  destinations: Destination[]
  onChoose: (choice: ProjectPluginChoice) => void
  onMove: (destinationId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const layersId = useId()
  const target = state.scopes.find((scope) => scope.layerId === state.targetLayerId)
  const decision = state.capabilities.disable
  const refusal = moveRefusal(state)

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        {/* The three positions as one joined control; the one the plugin
            sits in is inked, and pressing it again is not an action. */}
        <div className="seg" role="group" aria-label={`Settings for ${state.name}`}>
          {positions(global).map((position) => {
            const here = position.choice === state.choice
            return (
              <button
                key={position.choice}
                type="button"
                aria-pressed={here}
                aria-label={`${position.label}: ${state.name}`}
                // The chosen position is drawn in the colour of the state it
                // represents, so the control is its own status chip
                // (DESIGN.md). `unset` also grows a `?`, because nothing
                // stating a value is not the same as stating a negative.
                data-state={
                  position.choice === 'inherit' ? 'unset' : position.choice
                }
                disabled
                // No promise of a write: ADR-0010 refuses the plan that would
                // make one. The file this would land in is still named, since
                // that is where the user goes to make the change by hand.
                title={
                  decision.allowed
                    ? `Would be set in ${target?.path ?? state.targetLayerId}`
                    : undefined
                }
                className="btn btn-quiet btn-sm"
                onClick={() => onChoose(position.choice)}
              >
                {position.label}
              </button>
            )
          })}
        </div>
        {/* Beside the positions because it is the same question they answer —
            where this plugin is on — asked of somewhere else. It writes two
            files, so it is one control rather than a fourth position. */}
        <MovePicker
          name={state.name}
          destinations={destinations}
          disabled
          onMove={onMove}
        />
        {/* What Claude actually honours here, which is not always what this
            scope says: a silent project is answered by the user layer. */}
        <span className="text-xs text-ink-2">
          Configured here:{' '}
          <span className={state.effective ? 'font-medium text-ink' : ''}>
            {state.effective === null ? 'not specified' : state.effective ? 'on' : 'off'}
          </span>
        </span>
      </div>
      {/* No position is pressed when the file says something kondo cannot
          read, and an unpressed control with no reason beside it reads as a
          bug. The value itself never reaches here (ADR-0022) — the file is
          named so the user can go and look. */}
      {state.choice === 'unknown' && (
        <p className="text-xs text-ink-2">
          {target?.path ?? 'This settings file'} states this plugin with a value that is
          neither true nor false, so kondo cannot say whether it is on or off here.
        </p>
      )}
      {/* Both refusals, read rather than hovered for. The toggle's answer and
          the move's answer are different questions, so both get printed. The
          toggle's own answer is the suspension when the matrix allows it,
          because a control that cannot act must say so before it is pressed. */}
      <Refusal reason={decision.allowed ? SETTINGS_WRITES_SUSPENDED : decision.reason} />
      <Refusal reason={refusal} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? layersId : undefined}
        aria-label={`Settings details for ${state.name}`}
        className="disclose"
        onClick={() => setOpen((value) => !value)}
      >
        Settings details
      </button>
      {open && (
        <div id={layersId} className="ml-1 flex flex-col gap-1 border-l border-line pl-3">
          {state.scopes.map((scope) => (
            <div key={scope.layerId} className="flex items-center gap-2 text-xs">
              <span className="stamp">{scope.layer}</span>
              <span className={scope.enabled === true ? 'font-medium text-ink' : 'text-ink-2'}>
                {stateLabel(scope)}
              </span>
              {scope.layerId === state.effectiveLayerId && (
                <span className="stamp-ok" title="This is the file in effect">
                  in effect
                </span>
              )}
              <span className="truncate font-mono text-ink-2" title={scope.path}>
                {scope.path}
                {scope.exists ? '' : ' (not created yet)'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
