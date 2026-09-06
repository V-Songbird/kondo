import { useState } from 'react'
import type { JournalEntryInfo, TidyCategory } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { formatBytes, formatCount, joinErrors } from '../../lib/format'
import { SkillDuplicates } from './duplicates'

/**
 * The tidy sweep, preview first. The table is computed by main without moving
 * a byte, and nothing happens until a category is picked and the confirmation
 * answered. The sweep itself is one journal entry, so undo restores it whole
 * (ADR-0001).
 *
 * Every word on this screen is the UI column of docs/glossary.md — "clean
 * up", "preview", "session folder" — while the categories keep their internal
 * names in the contract. The two vocabularies do not have to match; the
 * mapping does.
 */

/** Plain words for the row, not kondo's internal name for the category. */
const LABEL: Record<TidyCategory, string> = {
  'scratch-projects': 'Throwaway folders',
  'dead-projects': 'Projects that are gone',
  'stale-sessions': 'Old conversations',
  'empty-transcripts': 'Empty conversations',
  'desktop-released-sessions': 'Conversations deleted in the desktop app',
  'orphan-sidecars': 'Leftover session folders',
  'orphan-session-env': 'Leftover session snapshots',
  'reclaimable-caches': 'Caches Claude rebuilds',
  'desktop-caches': 'Caches the desktop app rebuilds',
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
      return `Untouched for over ${staleAfterDays} days. Their session folders go too.`
    case 'empty-transcripts':
      return 'Conversations that recorded nothing at all.'
    case 'desktop-released-sessions':
      return 'The desktop app deleted these on its side; the transcript is still here. Their session folders go too.'
    case 'orphan-sidecars':
      return 'Session folders left behind after their conversation was removed.'
    case 'orphan-session-env':
      return 'Saved settings for conversations Claude no longer has a record of.'
    case 'reclaimable-caches':
      return 'Claude builds these again the next time it runs.'
    case 'desktop-caches':
      return 'Browser caches inside the Claude desktop app’s data folder. The app builds them again on its next launch.'
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
      setProblem(joinErrors(done.errors))
      if (done.errors.length === 0) {
        // A clean-up that moved something is a change with a way back, so
        // it goes to the banner; a tidy store has nothing to undo and just
        // says so (ADR-0001 — the entry is what the undo hangs on).
        setChange(done.data)
        if (done.data === null) {
          setOutcome('Nothing left to clean up — everything here is already tidy.')
        }
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
    <div>
      {problem !== null && <div className="band band-pencil text-pencil">{problem}</div>}
      {outcome !== null && <div className="band band-stamp">{outcome}</div>}
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
            <section className="sheet">
              <div className="mb-5">
                <h2>Preview — nothing has moved</h2>
                <p className="mt-1 max-w-2xl text-ink-2">
                  These counts are a look, not a change. Pick what to reclaim; cleaning
                  up moves every chosen item into kondo&rsquo;s trash in one step you can
                  undo. Nothing is deleted.
                </p>
              </div>

              <table className="ledger mb-5">
                <thead>
                  <tr>
                    <th />
                    <th>Category</th>
                    <th className="num">Items</th>
                    <th className="num">Reclaims</th>
                    <th>For example</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.data.categories.map((entry) => (
                    <tr key={entry.category} data-force={entry.count === 0 ? 'off' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={entry.count === 0 || entry.blocked !== null || busy}
                          checked={selected.includes(entry.category)}
                          onChange={() => pick(entry.category)}
                        />
                      </td>
                      <td>
                        <div className="font-medium">{LABEL[entry.category]}</div>
                        <p className="text-xs">
                          {hintFor(entry.category, scan.data.staleAfterDays)}
                        </p>
                        {/* Why it cannot be swept right now, on screen and not
                            in a tooltip: a dark checkbox with no reason reads
                            as a broken app. */}
                        {entry.blocked !== null && (
                          <p className="text-xs text-note">{entry.blocked}</p>
                        )}
                      </td>
                      <td className="num">
                        {entry.count === 0 ? '—' : entry.count.toLocaleString()}
                      </td>
                      <td className="num">{formatBytes(entry.bytes)}</td>
                      <td className="max-w-md font-mono text-xs text-ink-2">
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
                    <td>Everything kondo can reclaim</td>
                    <td className="num">{scan.data.totalCount.toLocaleString()}</td>
                    <td className="num">{formatBytes(scan.data.totalBytes)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>

              {confirming ? (
                <div className="band band-pencil">
                  <span>
                    Move {formatCount(count, 'item')} ({formatBytes(bytes)}) into
                    kondo&rsquo;s trash?
                  </span>
                  <button type="button" className="btn btn-pencil btn-sm" onClick={() => void sweep()}>
                    Move to trash
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={count === 0 || busy}
                  className="btn btn-go"
                  onClick={() => setConfirming(true)}
                >
                  {count === 0
                    ? 'Pick what to clean up'
                    : `Clean up ${formatCount(count, 'item')} · ${formatBytes(bytes)}`}
                </button>
              )}
            </section>
          )
        }}
      </AsyncView>

      {/* Its own read and its own undo: a skill copy goes one at a time, not
          as a category of the sweep above. */}
      <SkillDuplicates />
    </div>
  )
}
