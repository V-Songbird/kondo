import { useId, useState } from 'react'
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
      if (done.errors.length === 0) {
        setChange(done.data)
        if (done.data === null) {
          setOutcome('Nothing came out — these entries were already gone.')
        }
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
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
      {problem !== null && <div role="alert" className="band band-pencil text-pencil">{problem}</div>}
      {stale !== null && <div role="status" className="band band-note text-note">{stale}</div>}
      {outcome !== null && <div role="status" className="band band-stamp">{outcome}</div>}
      <LastChange key={change?.id} entry={change} onUndone={reload} />

      <AsyncView
        state={state}
        empty="Nothing is left over — every project entry, MCP server, plugin switch and skill setting in your configuration still has something behind it."
      >
        {(scan) => {
          const chosen: ConfigOrphan[] = chosenFrom(scan.data, selected)

          return (
            <div>
              <section className="sheet hero">
                <h2>Preview — nothing has changed</h2>
                <p className="mt-1 max-w-2xl text-ink-2">
                  Claude still reads every line below, and nothing stands behind any of
                  them any more. Removing takes only those lines out of the files that
                  hold them; every other setting keeps its bytes, and one undo puts the
                  whole removal back.
                </p>
              </section>

              {groupByKind(scan.data).map((group) => (
                <section key={group.kind} className="sheet" data-tone="coral">
                  <div className="sheet-head">
                    <h2>{group.label}</h2>
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
                          <th>In</th>
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
                            <td className="max-w-md font-mono text-xs">
                              <div className="truncate" title={orphan.name}>
                                {orphan.name}
                              </div>
                            </td>
                            <td className="font-mono text-xs text-ink-2">{orphan.source}</td>
                            <td className="max-w-md text-ink-2">{orphan.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              {confirming ? (
                <div className="band band-pencil" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
                  <span id={questionId}>
                    Take {formatCount(chosen.length, 'leftover')} out of Claude&rsquo;s
                    configuration?
                  </span>
                  <button
                    type="button"
                    disabled={busy || chosen.length === 0}
                    className="btn btn-pencil btn-sm"
                    onClick={() => void remove(chosen.map((orphan) => orphan.id))}
                  >
                    Remove
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
                  id={removeButtonId}
                  type="button"
                  disabled={chosen.length === 0 || busy}
                  className="btn btn-go"
                  onClick={() => {
                    confirmation.rememberFocus(removeButtonId)
                    setConfirming(true)
                  }}
                >
                  {chosen.length === 0
                    ? 'Pick what to remove'
                    : `Remove ${formatCount(chosen.length, 'leftover')}`}
                </button>
              )}
            </div>
          )
        }}
      </AsyncView>
    </div>
  )
}
