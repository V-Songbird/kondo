import { useState } from 'react'
import type { ConfigOrphan, JournalEntryInfo } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
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
    <div className="space-y-4">
      {problem !== null && <div className="card border-bad/50 text-bad">{problem}</div>}
      {stale !== null && <div className="card border-warn/50 text-warn">{stale}</div>}
      {outcome !== null && <div className="card border-ok/50 text-ok">{outcome}</div>}
      <LastChange key={change?.id} entry={change} onUndone={reload} />

      <AsyncView
        state={state}
        empty="Nothing is left over — every project entry, MCP server, plugin switch and skill setting in your configuration still has something behind it."
      >
        {(scan) => {
          const chosen: ConfigOrphan[] = chosenFrom(scan.data, selected)

          return (
            <div className="space-y-4">
              <div className="card">
                <h2 className="mb-1 font-semibold">Preview — nothing has changed</h2>
                <p className="max-w-2xl text-mut">
                  Claude still reads every line below, and nothing stands behind any of
                  them any more. Removing takes only those lines out of the files that
                  hold them; every other setting keeps its bytes, and one undo puts the
                  whole removal back.
                </p>
              </div>

              {groupByKind(scan.data).map((group) => (
                <div key={group.kind} className="space-y-1">
                  <div>
                    <h3 className="font-semibold">{group.label}</h3>
                    <div className="text-xs text-mut">{group.hint}</div>
                  </div>
                  {/* A project entry's name is a full path and its source is
                      another one, so the table scrolls inside its own box
                      rather than pushing the page sideways. */}
                  <div className="overflow-x-auto">
                    <table className="tbl">
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
                                className="cursor-pointer disabled:cursor-not-allowed"
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
                            <td className="font-mono text-xs text-mut">{orphan.source}</td>
                            <td className="max-w-md text-mut">{orphan.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {confirming ? (
                <div className="card flex flex-wrap items-center gap-3 border-warn/50">
                  <span>
                    Take {formatCount(chosen.length, 'leftover')} out of Claude&rsquo;s
                    configuration?
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-warn/60 px-3 py-1 text-warn hover:bg-inset"
                    onClick={() => void remove(chosen.map((orphan) => orphan.id))}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-edge px-3 py-1 text-mut hover:text-ink"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={chosen.length === 0 || busy}
                  className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setConfirming(true)}
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
