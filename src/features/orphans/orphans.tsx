import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ConfigOrphan, JournalEntryInfo } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { useConfirmationFocus } from '../../ui/use-confirmation-focus'
import { formatCount } from '../../lib/format'
import { chosenFrom, groupByKind, refusalFrom } from './orphan-rows'

/**
 * Leftovers in Claude's configuration files — members Claude still reads and
 * nothing stands behind any more (ADR-0010). The preview moves nothing; the
 * chosen members come out as one journal entry, so a single undo puts them
 * all back (ADR-0001).
 *
 * The word on screen is the glossary's: kondo calls these orphans
 * internally, the user is shown leftovers.
 */
export function Orphans() {
  const state = useScan((api) => api.configOrphansPreview())
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const removeButtonId = useId()
  const questionId = useId()
  const confirmation = useConfirmationFocus(confirming, () => setConfirming(false))
  const { reload } = state
  const resultRef = useRef<HTMLDivElement>(null)
  const focusResult = useRef(false)

  useLayoutEffect(() => {
    if (!busy && focusResult.current) {
      resultRef.current?.focus()
      focusResult.current = false
    }
  })

  const pick = (id: string): void => {
    setConfirming(false)
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )
  }

  const remove = async (ids: string[]): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setConfirming(false)
    setProblem(null)
    setStale(null)
    setOutcome(null)
    setChange(null)
    try {
      const done = await api.configOrphansRemove(ids)
      const refusal = refusalFrom(done.errors)
      setProblem(refusal.failure)
      setStale(refusal.stale)
      setChange(done.data)
      if (done.errors.length === 0) {
        if (done.data === null) {
          setOutcome('Nothing came out — these entries were already gone.')
        }
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
      setBusy(false)
      // ADR-0006: the store is the state. A refusal is as good a reason to
      // re-read as a removal — a stale file means these rows described bytes
      // that have already moved on. Selection survives the read and is
      // intersected with what comes back, so ids that no longer resolve just
      // stop being ticked.
      reload()
    }
  }

  return (
    <div>
      <div className="sheet-head">
        <h2>Settings leftovers</h2>
      </div>
      <p className="mb-3 max-w-2xl">
        Remove saved settings for projects, connections, plugins or skills that no
        longer exist. Review each reason before selecting a setting.
      </p>
      <p className="mb-5 max-w-2xl">
        Only the selected settings are removed. This tidies Claude&rsquo;s configuration;
        it does not delete project files. One Undo restores the selected settings.
      </p>
      <div ref={resultRef} tabIndex={-1} aria-label="Settings cleanup result">
        {problem !== null && <div role="alert" className="band band-pencil text-pencil">{problem}</div>}
        {stale !== null && <div role="status" className="band band-note text-note">{stale}</div>}
        {outcome !== null && <div role="status" className="band band-stamp">{outcome}</div>}
        <LastChange key={change?.id} entry={change} onUndone={reload} />
      </div>

      <AsyncView
        state={state}
        empty="No settings leftovers found in the files kondo could read. There is nothing to select here."
      >
        {(scan) => {
          const chosen: ConfigOrphan[] = chosenFrom(scan.data, selected)

          return (
            <div>
              <h3 className="mb-5">1. Choose settings to remove</h3>

              {groupByKind(scan.data).map((group) => (
                <section key={group.kind} className="sheet" data-tone="coral">
                  <div className="sheet-head">
                    <h3>{group.label}</h3>
                    <span className="count">{group.rows.length}</span>
                  </div>
                  <p className="mb-3">{group.hint}</p>
                  {/* A project entry's name is a full path and its source is
                      another one, so the table scrolls inside its own box
                      rather than pushing the page sideways. */}
                  <div className="overflow-x-auto">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th className="w-8" />
                          <th>Name</th>
                          <th>Why it is a leftover</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((orphan) => (
                          <tr key={orphan.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${orphan.name} from ${orphan.source}`}
                                disabled={busy}
                                checked={selected.includes(orphan.id)}
                                onChange={() => pick(orphan.id)}
                              />
                            </td>
                            <td className="max-w-md">
                              <div className="break-all">
                                {orphan.name}
                              </div>
                              <details className="technical-details mt-2">
                                <summary>Settings file</summary>
                                <p className="mt-2 break-all font-mono text-xs text-ink-2">{orphan.source}</p>
                              </details>
                            </td>
                            <td className="max-w-md text-ink-2">{orphan.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              {confirming ? (
                <div className="band band-pencil flex-col items-start gap-3" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
                  <h3 id={questionId}>2. Review settings to remove</h3>
                  <p>Remove {formatCount(chosen.length, 'setting')} from Claude&rsquo;s configuration?</p>
                  <ul className="space-y-2">
                    {chosen.map((orphan) => <li key={orphan.id} className="break-all">{orphan.name}</li>)}
                  </ul>
                  {chosen.some((orphan) => orphan.kind === 'project-entry') && (
                    <p>Removing a project entry also removes the connections saved inside it.</p>
                  )}
                  <p>One Undo restores this change.</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      ref={confirmation.cancelRef}
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={confirmation.cancel}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy || chosen.length === 0 || state.loading}
                      className="btn btn-pencil btn-sm"
                      onClick={() => void remove(chosen.map((orphan) => orphan.id))}
                    >
                      Remove selected settings
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-3" role="status">
                    {busy ? 'Removing selected settings…' : chosen.length === 0
                      ? 'No settings selected.'
                      : `${formatCount(chosen.length, 'setting')} selected.`}
                  </p>
                  <button
                    id={removeButtonId}
                    type="button"
                    disabled={chosen.length === 0 || busy || state.loading}
                    className="btn btn-go"
                    onClick={() => {
                      confirmation.rememberFocus(removeButtonId)
                      setConfirming(true)
                    }}
                  >
                    Review selected settings
                  </button>
                </div>
              )}
            </div>
          )
        }}
      </AsyncView>
    </div>
  )
}
