import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { JournalEntryInfo, SkillScope } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { Refusal } from '../../ui/refusal'
import { useConfirmationFocus } from '../../ui/use-confirmation-focus'
import { joinErrors } from '../../lib/format'
import { keepReason, shortDigest, verdictFor } from './duplicate-rows'

/**
 * The same skill kept twice across scopes. Its own section on Clean up,
 * with a different unit: one skill directory at a time, each its own journal entry,
 * so the undo is for exactly the copy that went (ADR-0001).
 *
 * The trash control is gated on the group verdict, never on the name alone:
 * two skills that merely share a name are two skills.
 */
const SCOPE_LABEL: Record<SkillScope, string> = {
  user: 'All projects',
  'user-disabled': 'All projects · disabled copy',
  project: 'Project only',
  'project-disabled': 'Project only · disabled copy',
  plugin: 'Managed by a plugin'
}

export function SkillDuplicates() {
  const state = useScan((api) => api.skillDuplicates())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  // Which copy the confirm band is asking about; null when it is asking about
  // none. One click used to be the whole decision (entry 076).
  const [asking, setAsking] = useState<string | null>(null)
  const buttonPrefix = useId()
  const questionId = useId()
  const confirmation = useConfirmationFocus(asking !== null, () => setAsking(null), asking)
  const { reload } = state
  const resultRef = useRef<HTMLDivElement>(null)
  const focusResult = useRef(false)

  useLayoutEffect(() => {
    if (!busy && focusResult.current) {
      resultRef.current?.focus()
      focusResult.current = false
    }
  })

  const trash = async (skillId: string): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setAsking(null)
    setProblem(null)
    setOutcome(null)
    setChange(null)
    try {
      const done = await api.entityMutate(skillId, { op: 'trash' })
      setProblem(joinErrors(done.errors))
      setChange(done.data)
      if (done.errors.length === 0 && done.data === null) {
        setOutcome('This copy no longer needs removing. The list has been refreshed.')
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
      setBusy(false)
      // ADR-0006: the store is the state. A group with one member left is no
      // longer a group, and the fresh read is what says so.
      reload()
    }
  }

  return (
    <section className="sheet" data-tone="mustard">
      <div className="sheet-head">
        <h2>Duplicate skills</h2>
      </div>
      <p className="mb-4 max-w-2xl text-[13px] text-ink-2">
        Compare skills with the same name in different places. Kondo only offers to
        remove a copy when every copy has identical contents.
      </p>
      <p className="mb-5 max-w-2xl">
        Keep a copy wherever you need it: a skill in one project may not be available
        in another. Review the location before moving a copy to trash. You can undo the move.
      </p>
      <div ref={resultRef} tabIndex={-1} aria-label="Duplicate cleanup result">
        {problem !== null && <div role="alert" className="band band-pencil text-pencil">{problem}</div>}
        {outcome !== null && <div role="status" className="band band-stamp">{outcome}</div>}
        <LastChange key={change?.id} entry={change} onUndone={reload} />
      </div>

      <AsyncView state={state} empty="No repeated skill names found in the locations kondo could read.">
        {(scan) => (
          <div className="space-y-5">
            {scan.data.map((group) => {
              const verdict = verdictFor(group)
              return (
                <div key={group.name}>
                  <h3 className="mb-1">
                    {group.name}
                    <span className={`${verdict.tone} ml-2`}>{verdict.label}</span>
                  </h3>
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Where this copy is kept</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {group.members.map((member) => {
                        const reason = keepReason(group, member)
                        return (
                          <tr key={member.skill.id}>
                            <td className="max-w-md">
                              <div>{SCOPE_LABEL[member.skill.scope]}</div>
                              <div className="mt-1 break-all font-mono text-xs text-ink-2">
                                {member.skill.origin}
                              </div>
                              <details className="technical-details mt-2">
                                <summary>Content fingerprint</summary>
                                <p className="mt-2 font-mono text-xs text-ink-2">{shortDigest(member.digest)}</p>
                              </details>
                            </td>
                            <td className="text-right">
                              {asking === member.skill.id ? (
                                <div className="band band-pencil flex-col items-start gap-2 text-left" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
                                  <span id={questionId}>Move this copy of {group.name} to trash?</span>
                                  <p className="break-all text-xs">{member.skill.origin}</p>
                                  <p>This copy will no longer be available from this location.</p>
                                  <button
                                    type="button"
                                    disabled={busy || reason !== null || state.loading}
                                    aria-label={`Move to trash: ${group.name} from ${member.skill.origin}`}
                                    className="btn btn-pencil btn-sm"
                                    onClick={() => void trash(member.skill.id)}
                                  >
                                    Move to trash
                                  </button>
                                  <button
                                    ref={confirmation.cancelRef}
                                    type="button"
                                    className="btn btn-quiet btn-sm"
                                    onClick={confirmation.cancel}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  id={`${buttonPrefix}-${member.skill.id}`}
                                  type="button"
                                  aria-label={`Move this copy to trash: ${group.name} from ${member.skill.origin}`}
                                  disabled={reason !== null || busy || state.loading}
                                  className="btn btn-pencil btn-sm"
                                  onClick={() => {
                                    confirmation.rememberFocus(`${buttonPrefix}-${member.skill.id}`)
                                    setAsking(member.skill.id)
                                  }}
                                >
                                  Move this copy to trash
                                </button>
                              )}
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
    </section>
  )
}
