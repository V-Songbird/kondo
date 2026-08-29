import { useState } from 'react'
import type { CapabilityDecision, CapabilityOperation, SkillInfo, SkillScope } from '../../../shared/contract'
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
  operation: CapabilityOperation
  decision: CapabilityDecision
} {
  return skill.capabilities.disable.allowed
    ? { operation: 'disable', decision: skill.capabilities.disable }
    : { operation: 'enable', decision: skill.capabilities.enable }
}

export function Skills() {
  const state = useScan((api) => api.skillsList())
  const [busy, setBusy] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const { reload } = state

  const toggle = async (skill: SkillInfo): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(skill.id)
    setRefusal(null)
    try {
      const result = await api.skillToggle(skill.id, toggleFor(skill).operation)
      setRefusal(result.errors[0]?.message ?? null)
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      // ADR-0006: the store is the state. The move changes the skill's id, so
      // nothing is patched here — the list comes back from a fresh read.
      reload()
    }
  }

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
