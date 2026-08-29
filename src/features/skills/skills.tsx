import { useState } from 'react'
import type {
  CapabilityDecision,
  SessionProject,
  SkillInfo,
  SkillScope,
  ToggleOperation
} from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'

const SCOPE_LABEL: Record<SkillScope, string> = {
  user: 'global',
  'user-disabled': 'disabled',
  plugin: 'plugin',
  project: 'project',
  'project-disabled': 'project · disabled'
}

/**
 * The matrix decides both the direction and whether the toggle is offered at
 * all (ADR-0006): whichever operation the entity permits is the one on the
 * button, and a row that permits neither carries its refusal as the tooltip.
 */
function toggleFor(skill: SkillInfo): {
  operation: ToggleOperation
  decision: CapabilityDecision
} {
  return skill.capabilities.disable.allowed
    ? { operation: 'disable', decision: skill.capabilities.disable }
    : { operation: 'enable', decision: skill.capabilities.enable }
}

/** A scope a skill can be moved into: the user store, or a project's. */
interface Destination {
  id: string
  label: string
}

/**
 * The scopes kondo can write a skill into. Ids are opaque here (ADR-0008) —
 * `user` and the project ids from the last scan are passed straight back —
 * and the current scope is not filtered out, because main is the one that
 * knows where the skill already lives and says so in its refusal.
 */
function destinationsFrom(projects: SessionProject[] | undefined): Destination[] {
  return [
    { id: 'user', label: 'global (~/.claude)' },
    ...(projects ?? [])
      .filter((project) => project.guessedPath !== null)
      .map((project) => ({ id: project.id, label: project.guessedPath as string }))
  ]
}

export function Skills() {
  const state = useScan((api) => api.skillsList())
  const projects = useScan((api) => api.sessionProjects())
  const [busy, setBusy] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const { reload } = state

  const destinations = destinationsFrom(projects.scan?.data)

  /** Both mutations end the same way: report, then re-read the store. */
  const run = async (
    skill: SkillInfo,
    call: (api: NonNullable<typeof window.kondo>) => Promise<{ errors: Array<{ message: string }> }>
  ): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(skill.id)
    setRefusal(null)
    try {
      setRefusal((await call(api)).errors[0]?.message ?? null)
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      // ADR-0006: the store is the state. Either mutation changes the skill's
      // id, so nothing is patched here — the list comes back from a fresh read.
      reload()
    }
  }

  const toggle = (skill: SkillInfo): Promise<void> =>
    run(skill, (api) => api.skillToggle(skill.id, toggleFor(skill).operation))

  const move = (skill: SkillInfo, destinationId: string): Promise<void> =>
    run(skill, (api) => api.skillMove(skill.id, destinationId))

  return (
    <div className="space-y-4">
      {refusal !== null && <div className="card border-bad/50 text-bad">{refusal}</div>}
      <AsyncView state={state}>
        {(scan) => (
          <table className="tbl">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Scope</th>
                <th>Description</th>
                <th>Location</th>
                <th>Move to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {scan.data.map((skill) => {
                const { operation, decision } = toggleFor(skill)
                return (
                  <tr key={skill.id} className={skill.enabled ? '' : 'opacity-60'}>
                    <td className="font-mono">{skill.name}</td>
                    <td>
                      <span className={`pill ${skill.enabled ? '' : 'text-warn'}`}>
                        {SCOPE_LABEL[skill.scope]}
                      </span>
                    </td>
                    <td className="max-w-lg text-mut">{skill.description ?? '—'}</td>
                    <td
                      className="max-w-xs truncate font-mono text-xs text-mut"
                      title={skill.origin}
                    >
                      {skill.origin}
                    </td>
                    <td>
                      <select
                        value=""
                        disabled={!skill.capabilities.move.allowed || busy !== null}
                        title={skill.capabilities.move.reason ?? undefined}
                        className="max-w-xs cursor-pointer rounded-md border border-edge bg-transparent px-2 py-0.5 text-xs text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        onChange={(event) => {
                          const destinationId = event.target.value
                          if (destinationId !== '') void move(skill, destinationId)
                        }}
                      >
                        <option value="">Move to…</option>
                        {destinations.map((destination) => (
                          <option key={destination.id} value={destination.id}>
                            {destination.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        disabled={!decision.allowed || busy !== null}
                        title={decision.reason ?? undefined}
                        className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void toggle(skill)}
                      >
                        {operation === 'disable' ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </AsyncView>
    </div>
  )
}
