import { useState } from 'react'
import type { JournalEntryInfo } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { Refusal } from '../../ui/refusal'
import { joinErrors } from '../../lib/format'
import { keepReason, shortDigest, verdictFor } from './duplicate-rows'

/**
 * The same skill kept twice across scopes. Sits under the sweep on Clean up
 * because it is the same job — bytes on disk nothing needs — with a
 * different unit: one skill directory at a time, each its own journal entry,
 * so the undo is for exactly the copy that went (ADR-0001).
 *
 * The trash control is gated on the group verdict, never on the name alone:
 * two skills that merely share a name are two skills.
 */
export function SkillDuplicates() {
  const state = useScan((api) => api.skillDuplicates())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const { reload } = state

  const trash = async (skillId: string): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setProblem(null)
    setChange(null)
    try {
      const done = await api.entityMutate(skillId, { op: 'trash' })
      setProblem(joinErrors(done.errors))
      if (done.errors.length === 0) setChange(done.data)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      // ADR-0006: the store is the state. A group with one member left is no
      // longer a group, and the fresh read is what says so.
      reload()
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">Skills kept twice</h2>
        <p className="max-w-2xl text-xs text-mut">
          The same skill name in more than one place. Copies with identical contents can
          lose all but one; copies that differ are two skills and stay.
        </p>
      </div>
      {problem !== null && <div className="card border-bad/50 text-bad">{problem}</div>}
      <LastChange key={change?.id} entry={change} onUndone={reload} />

      <AsyncView state={state} empty="No skill name is kept twice across your scopes.">
        {(scan) => (
          <div className="space-y-3">
            {scan.data.map((group) => {
              const verdict = verdictFor(group)
              return (
                <div key={group.name} className="card space-y-2">
                  <h3 className="font-mono">
                    {group.name}
                    <span className={`pill ml-2 ${verdict.tone}`}>{verdict.label}</span>
                  </h3>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Where</th>
                        <th>Path</th>
                        <th>Contents</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {group.members.map((member) => {
                        const reason = keepReason(group, member)
                        return (
                          <tr key={member.skill.id}>
                            <td>{member.skill.scope}</td>
                            <td className="max-w-md font-mono text-xs text-mut">
                              <div className="truncate" title={member.skill.origin}>
                                {member.skill.origin}
                              </div>
                            </td>
                            <td className="font-mono text-xs text-mut">
                              {shortDigest(member.digest)}
                            </td>
                            <td className="text-right">
                              <button
                                type="button"
                                disabled={reason !== null || busy}
                                className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => void trash(member.skill.id)}
                              >
                                Move this copy to trash
                              </button>
                              <Refusal reason={reason} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </AsyncView>
    </div>
  )
}
