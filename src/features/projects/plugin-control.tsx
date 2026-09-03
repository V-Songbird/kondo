import { useState } from 'react'
import type {
  ProjectPluginChoice,
  ProjectPluginState,
  PluginScopeState
} from '../../../shared/contract'
import type { Destination } from './projects'

/**
 * One plugin's three-way control for one scope, plus the layer strip behind a
 * disclosure.
 *
 * The three positions are the whole vocabulary a user needs: on here, off
 * here, or follow whatever the global setting says. Which *file* that writes
 * is policy the main process chose (`targetLayerId`) — the strip below is
 * where the layers are still visible for anyone who wants them, and it is
 * closed by default because a row of near-identical chips is what made the
 * old plugins view unreadable.
 */

/** Nothing stated at this level is "follows global" in a project, and simply
 *  "not set" in the user store, which has nothing above it to follow. */
function inheritLabel(global: boolean): string {
  return global ? 'Not set' : 'Follows global'
}

function positions(global: boolean): Array<{ choice: ProjectPluginChoice; label: string }> {
  return [
    { choice: 'on', label: global ? 'On' : 'On here' },
    { choice: 'off', label: global ? 'Off' : 'Off here' },
    { choice: 'inherit', label: inheritLabel(global) }
  ]
}

function stateLabel(scope: PluginScopeState): string {
  if (scope.enabled === null) return 'silent'
  return scope.enabled ? 'on' : 'off'
}

/**
 * Why the picker is dark unless this scope says "on": a move is a `false`
 * here and a `true` there (ADR-0006), so a scope that never turned the plugin
 * on has nothing to hand over. Main refuses the same case by name.
 */
function moveRefusal(state: ProjectPluginState): string | null {
  if (!state.capabilities.move.allowed) {
    return state.capabilities.move.reason ?? 'kondo cannot move this plugin.'
  }
  return state.choice === 'on'
    ? null
    : 'Only a scope that turns the plugin on has one to hand over.'
}

export function PluginControl({
  state,
  global,
  busy,
  destinations,
  onChoose,
  onMove
}: {
  state: ProjectPluginState
  global: boolean
  busy: boolean
  /** Every scope but this one; ids, never paths (ADR-0008). */
  destinations: Destination[]
  onChoose: (choice: ProjectPluginChoice) => void
  onMove: (destinationId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const target = state.scopes.find((scope) => scope.layerId === state.targetLayerId)
  const decision = state.capabilities.disable
  const refusal = moveRefusal(state)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {positions(global).map((position) => {
          const here = position.choice === state.choice
          return (
            <button
              key={position.choice}
              type="button"
              disabled={here || busy || !decision.allowed}
              title={
                decision.allowed
                  ? `Writes ${target?.path ?? state.targetLayerId}`
                  : (decision.reason ?? undefined)
              }
              className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs disabled:cursor-not-allowed ${
                here
                  ? 'border-accent text-ink disabled:opacity-100'
                  : 'border-edge text-mut hover:text-ink disabled:opacity-40'
              }`}
              onClick={() => onChoose(position.choice)}
            >
              {position.label}
            </button>
          )
        })}
        {/* Beside the chips because it is the same question they answer —
            where this plugin is on — asked of somewhere else. It writes two
            files, so it is one control rather than a fourth position. */}
        <select
          value=""
          disabled={busy || refusal !== null || destinations.length === 0}
          title={
            refusal ??
            `Turns it off in ${target?.path ?? state.targetLayerId} and on where it lands`
          }
          className="max-w-[14rem] cursor-pointer rounded-md border border-edge bg-transparent px-2 py-0.5 text-xs text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          onChange={(event) => {
            const destinationId = event.target.value
            if (destinationId !== '') onMove(destinationId)
          }}
        >
          <option value="">Move to…</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.label}
            </option>
          ))}
        </select>
        {/* What Claude actually honours here, which is not always what this
            scope says: a silent project is answered by the user layer. */}
        <span className="ml-1 text-xs text-mut">
          in effect:{' '}
          <span className={state.effective ? 'text-ok' : 'text-mut'}>
            {state.effective === null ? 'nothing says' : state.effective ? 'on' : 'off'}
          </span>
        </span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        className="cursor-pointer text-xs text-mut hover:text-ink"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '▾' : '▸'} layers
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 border-l border-edge pl-2">
          {state.scopes.map((scope) => (
            <div key={scope.layerId} className="flex items-center gap-2 text-xs">
              <span className="pill">{scope.layer}</span>
              <span className={scope.enabled === true ? 'text-ok' : 'text-mut'}>
                {stateLabel(scope)}
              </span>
              {scope.layerId === state.effectiveLayerId && (
                <span className="text-accent" title="The layer whose value stands here">
                  ★
                </span>
              )}
              <span className="truncate font-mono text-mut" title={scope.path}>
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
