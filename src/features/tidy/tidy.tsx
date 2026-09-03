import { useState } from 'react'
import type { JournalEntryInfo, TidyCategory } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { formatBytes, formatCount } from '../../lib/format'

/**
 * The tidy sweep, preview first. The table is a dry run — main computed it
 * without moving a byte — and nothing happens until a category is picked and
 * the confirmation answered. The sweep itself is one journal entry, so undo
 * restores it whole (ADR-0001).
 */

/** Plain words for the row, not kondo's internal name for the category. */
const LABEL: Record<TidyCategory, string> = {
  'scratch-projects': 'Throwaway folders',
  'dead-projects': 'Projects that are gone',
  'stale-sessions': 'Old conversations',
  'empty-transcripts': 'Empty conversations',
  'orphan-sidecars': 'Leftover session files',
  'orphan-session-env': 'Leftover session snapshots',
  'reclaimable-caches': 'Caches Claude rebuilds',
  'superseded-plugin-versions': 'Old plugin versions',
  'orphan-plugin-residue': 'Leftovers from removed plugins',
  'unarmed-hook-scripts': 'Hook scripts nothing runs'
}

function hintFor(category: TidyCategory, staleAfterDays: number): string {
  switch (category) {
    case 'scratch-projects':
      return 'Work Claude did in a temp folder, a worktree or a job. The whole folder goes.'
    case 'dead-projects':
      return 'Claude still records these, but the folder is no longer on disk. The whole folder goes.'
    case 'stale-sessions':
      return `Nothing said in them for over ${staleAfterDays} days. Their side files go too.`
    case 'empty-transcripts':
      return 'Conversations that recorded nothing at all.'
    case 'orphan-sidecars':
      return 'Side files left behind after their conversation was removed.'
    case 'orphan-session-env':
      return 'Saved settings for conversations Claude no longer has a record of.'
    case 'reclaimable-caches':
      return 'Claude builds these again the next time it runs.'
    case 'superseded-plugin-versions':
      return 'Older copies of plugins you still have. The version in use stays.'
    case 'orphan-plugin-residue':
      return 'Data and install records for plugins that are no longer installed.'
    case 'unarmed-hook-scripts':
      return 'Scripts in your hooks folder that no settings file actually runs.'
  }
}

export function Tidy() {
  const state = useScan((api) => api.tidyPreview())
  const [selected, setSelected] = useState<TidyCategory[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const { reload } = state

  const pick = (category: TidyCategory): void => {
    setConfirming(false)
    setSelected((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    )
  }

  const sweep = async (): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setConfirming(false)
    setProblem(null)
    setOutcome(null)
    setChange(null)
    try {
      const done = await api.tidySweep(selected)
      setProblem(done.errors[0]?.message ?? null)
      if (done.errors.length === 0) {
        // A sweep that moved something is a change with a way back, so it
        // goes to the banner; a tidy store has nothing to undo and just says
        // so (ADR-0001 — the entry is what the undo hangs on).
        setChange(done.data)
        if (done.data === null) setOutcome('Nothing left to sweep — the store is already tidy.')
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      setSelected([])
      // ADR-0006: the store is the state. The sweep changed the very tree the
      // preview described, so nothing is patched here — the numbers come back
      // from a fresh read.
      reload()
    }
  }

  return (
    <div className="space-y-4">
      {problem !== null && <div className="card border-bad/50 text-bad">{problem}</div>}
      {outcome !== null && <div className="card border-ok/50 text-ok">{outcome}</div>}
      {/* The way back, offered where the sweep was run rather than in
          History. Keyed on the entry so a second sweep starts a fresh one. */}
      <LastChange key={change?.id} entry={change} onUndone={reload} />

      <AsyncView state={state}>
        {(scan) => {
          const chosen = scan.data.categories.filter((entry) =>
            selected.includes(entry.category)
          )
          const count = chosen.reduce((sum, entry) => sum + entry.count, 0)
          const bytes = chosen.reduce((sum, entry) => sum + entry.bytes, 0)

          return (
            <div className="space-y-4">
              <div className="card">
                <h2 className="mb-1 font-semibold">Dry run — nothing has moved</h2>
                <p className="max-w-2xl text-mut">
                  These counts are a scan, not a change. Pick what to reclaim; the sweep
                  displaces every chosen item into kondo&rsquo;s trash as a single journal
                  entry, never a delete.
                </p>
              </div>

              <table className="tbl">
                <thead>
                  <tr>
                    <th />
                    <th>Category</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Reclaims</th>
                    <th>For example</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.data.categories.map((entry) => (
                    <tr key={entry.category} className={entry.count === 0 ? 'opacity-50' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          className="cursor-pointer disabled:cursor-not-allowed"
                          disabled={entry.count === 0 || busy}
                          checked={selected.includes(entry.category)}
                          onChange={() => pick(entry.category)}
                        />
                      </td>
                      <td>
                        <div>{LABEL[entry.category]}</div>
                        <div className="text-xs text-mut">
                          {hintFor(entry.category, scan.data.staleAfterDays)}
                        </div>
                      </td>
                      <td className="text-right">
                        {entry.count === 0 ? '—' : entry.count.toLocaleString()}
                      </td>
                      <td className="text-right">{formatBytes(entry.bytes)}</td>
                      <td className="max-w-md font-mono text-xs text-mut">
                        {entry.examples.map((example) => (
                          <div key={example} className="truncate" title={example}>
                            {example}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td />
                    <td className="text-mut">Everything kondo can reclaim</td>
                    <td className="text-right">
                      {scan.data.totalCount.toLocaleString()}
                    </td>
                    <td className="text-right">{formatBytes(scan.data.totalBytes)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>

              {confirming ? (
                <div className="card flex flex-wrap items-center gap-3 border-warn/50">
                  <span>
                    Move {formatCount(count, 'item')} ({formatBytes(bytes)}) into
                    kondo&rsquo;s trash?
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-warn/60 px-3 py-1 text-warn hover:bg-inset"
                    onClick={() => void sweep()}
                  >
                    Sweep
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
                  disabled={count === 0 || busy}
                  className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setConfirming(true)}
                >
                  {count === 0
                    ? 'Select what to sweep'
                    : `Sweep ${formatCount(count, 'item')} · ${formatBytes(bytes)}`}
                </button>
              )}
            </div>
          )
        }}
      </AsyncView>
    </div>
  )
}
