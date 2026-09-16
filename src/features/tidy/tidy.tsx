import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { JournalEntryInfo, TidyCategory, TidyCategoryPreview } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { useConfirmationFocus } from '../../ui/use-confirmation-focus'
import { formatBytes, formatCount, joinErrors } from '../../lib/format'
import { ReviewRefusal } from './review-refusal'
import { SkillDuplicates } from './duplicates'
import { Orphans } from '../orphans/orphans'

export type CleanupSection = 'files' | 'settings' | 'duplicates'

const SECTIONS: { key: CleanupSection; label: string }[] = [
  { key: 'files', label: 'Files and caches' },
  { key: 'settings', label: 'Settings leftovers' },
  { key: 'duplicates', label: 'Duplicate skills' }
]

export function Tidy({
  section,
  onSection,
  onOpenHistory
}: {
  section: CleanupSection
  onSection: (section: CleanupSection) => void
  onOpenHistory: () => void
}) {
  return (
    <div>
      <div className="hero">
        <h1>Clean up</h1>
        <p className="mt-2 max-w-2xl">
          Choose what to tidy, review the changes, then apply them. Nothing is selected for you.
        </p>
        <button type="button" className="btn btn-quiet btn-sm mt-3" onClick={onOpenHistory}>
          Open History and trash
        </button>
      </div>
      <nav className="section-nav" aria-label="Cleanup sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={section === entry.key ? 'page' : undefined}
            className="btn btn-quiet"
            onClick={() => onSection(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      {/* Each scope owns its pending confirmation. Switching sections drops
          the old question, while the persistent navigation retains focus. */}
      {section === 'files' && <FileCleanup />}
      {section === 'settings' && <Orphans />}
      {section === 'duplicates' && <SkillDuplicates />}
    </div>
  )
}

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
  'desktop-released-sessions': 'Conversations with a desktop released marker',
  'orphan-sidecars': 'Leftover session folders',
  'orphan-session-env': 'Leftover session snapshots',
  'reclaimable-caches': 'Caches Claude rebuilds',
  'desktop-caches': 'Caches the desktop app rebuilds',
  'superseded-plugin-versions': 'Old plugin versions',
  'orphan-plugin-residue': 'Leftovers from removed plugins',
  'unarmed-hook-scripts': 'Hook scripts kondo keeps'
}

function hintFor(category: TidyCategory, staleAfterDays: number): string {
  switch (category) {
    case 'scratch-projects':
      return 'Saved Claude data for temporary folders, worktrees or jobs with no memory and no recent activity. A throwaway name alone never makes a folder removable. The project’s own files stay.'
    case 'dead-projects':
      return 'Saved Claude data for project folders that are no longer on disk.'
    case 'stale-sessions':
      return `Untouched for over ${staleAfterDays} days. Old does not mean useless — kondo measures the last activity, not the worth. Their session folders go too.`
    case 'empty-transcripts':
      return 'Conversations that recorded nothing at all.'
    case 'desktop-released-sessions':
      return 'The desktop app left a marker beside these transcripts. The marker is a filename kondo recognizes, not proof the app removed its own records. Their session folders go too.'
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
      return 'Kondo keeps every hook script. It cannot establish that one is unused, so it offers none here.'
  }
}

/**
 * What a move costs, in the three figures it actually has: bytes leave the
 * store, kondo's trash grows by the same amount, and the disk gets nothing
 * back until the trash is emptied. One number would read as the third.
 *
 * `movingBytes` counts every file that moves, a conversation's sidecar folder
 * and released marker included, so the trash grows by exactly this.
 */
function MoveFigures({ movingBytes, trashBytesBefore, incomplete }: {
  movingBytes: number
  trashBytesBefore: number
  incomplete: boolean
}) {
  const after = trashBytesBefore + movingBytes
  return (
    <ul className="space-y-1">
      <li>Moves to trash: {formatBytes(movingBytes)}</li>
      <li>Trash holds after this: {formatBytes(after)}</li>
      <li>Freed only if you empty the trash: {formatBytes(after)}</li>
      {incomplete && (
        <li className="text-note">
          Some files could not be read, so these are a minimum, not a total.
        </li>
      )}
    </ul>
  )
}

function FileCleanup() {
  const state = useScan((api) => api.tidyPreview())
  const [selected, setSelected] = useState<TidyCategory[]>([])
  const [review, setReview] = useState<{ token: string; chosen: TidyCategoryPreview[] } | null>(null)
  const [stale, setStale] = useState<{ reason: string; selection: string } | null>(null)
  const choiceId = useId()
  const confirming = review !== null
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const sweepButtonId = useId()
  const questionId = useId()
  const confirmation = useConfirmationFocus(confirming, () => setReview(null))
  const { reload } = state
  const resultRef = useRef<HTMLDivElement>(null)
  const focusResult = useRef(false)

  useLayoutEffect(() => {
    if (!busy && focusResult.current) {
      if (stale === null) resultRef.current?.focus()
      focusResult.current = false
    }
  })

  const pick = (category: TidyCategory): void => {
    setReview(null)
    setSelected((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    )
  }

  const sweep = async (): Promise<void> => {
    if (review === null) return
    const categories = review.chosen.map((entry) => entry.category)
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setReview(null)
    setProblem(null)
    setStale(null)
    setOutcome(null)
    setChange(null)
    try {
      const done = await api.tidySweep(categories, review.token)
      if (done.errors.some((error) => error.code === 'stale-plan')) {
        setStale({
          reason: joinErrors(done.errors) ?? 'The selected files changed. Select them again after reviewing the current list.',
          selection: review.chosen.map((entry) => `${LABEL[entry.category]} · ${formatCount(entry.count, 'item')}`).join('; ')
        })
      } else setProblem(joinErrors(done.errors))
      setChange(done.data)
      if (done.errors.length === 0) {
        // A clean-up that moved something is a change with a way back, so
        // it goes to the banner; a tidy store has nothing to undo and just
        // says so (ADR-0001 — the entry is what the undo hangs on).
        if (done.data === null) {
          setOutcome('Nothing left to clean up — everything here is already tidy.')
        }
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
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
      <div className="sheet-head">
        <h2>Files and caches</h2>
      </div>
      <p className="mb-3 max-w-2xl">
        Move saved conversations, old plugin copies and rebuildable caches to kondo&rsquo;s
        trash. You can undo the move here or in History.
      </p>
      <p className="mb-5 max-w-2xl">
        Sizes count every file that moves, including a conversation&rsquo;s saved
        supporting files. Moving to trash does not free disk space. Space is freed
        only when you permanently empty the trash in History.
      </p>
      {stale !== null && <ReviewRefusal {...stale} onReview={() => {
        setStale(null)
        document.getElementById(choiceId)?.focus()
      }} />}
      <div ref={resultRef} tabIndex={-1} aria-label="Cleanup result">
        {problem !== null && <div role="alert" className="band band-pencil text-pencil">{problem}</div>}
        {outcome !== null && <div role="status" className="band band-stamp">{outcome}</div>}
        <LastChange key={change?.id} entry={change} onUndone={reload} />
      </div>

      <AsyncView state={state}>
        {(scan) => {
          const chosen = scan.data.categories.filter((entry) =>
            selected.includes(entry.category) && entry.count > 0 && entry.blocked === null
          )
          const available = scan.data.categories.filter((entry) => entry.count > 0 || entry.blocked !== null)
          const empty = scan.data.categories.filter((entry) => entry.count === 0 && entry.blocked === null)
          const reviewed = review?.chosen ?? chosen
          const count = reviewed.reduce((sum, entry) => sum + entry.count, 0)
          const bytes = reviewed.reduce((sum, entry) => sum + entry.bytes, 0)

          return (
            <section className="sheet">
              <div className="mb-5">
                <h3 id={choiceId} tabIndex={-1}>1. Choose what to clean up</h3>
                <p className="mt-1 max-w-2xl text-ink-2">
                  {scan.data.totalCount === 0
                    ? 'No files need cleaning up in the categories kondo checked.'
                    : `${formatCount(scan.data.totalCount, 'item')} found. Select a category to include every item in it; review your selection before anything moves.`}
                </p>
              </div>

              {scan.data.withheldScratchCount > 0 && (
                <p className="mb-4 text-ink-2">
                  {formatCount(scan.data.withheldScratchCount, 'temporary or worktree folder')} kept:
                  {' '}they contain memory, activity within {scan.data.staleAfterDays} days, or could not be checked safely.
                  These folders are not included in cleanup.
                </p>
              )}
              {scan.data.reviewToken === null && (
                <div className="band band-note flex-col items-start gap-3">
                  <p>This preview could not be checked completely. Nothing can move until a new review is available.</p>
                  <button type="button" disabled={busy || state.loading} className="btn btn-quiet btn-sm" onClick={() => {
                    setReview(null)
                    setSelected([])
                    reload()
                  }}>Refresh preview</button>
                </div>
              )}

              {available.length > 0 && <table className="ledger mb-5">
                <thead>
                  <tr>
                    <th />
                    <th>Category</th>
                    <th className="num">Items</th>
                    <th className="num">Size estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {available.map((entry) => (
                    <tr key={entry.category} data-force={entry.count === 0 ? 'off' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${LABEL[entry.category]}`}
                          aria-describedby={`${questionId}-${entry.category}`}
                          disabled={entry.count === 0 || entry.blocked !== null || busy || scan.data.reviewToken === null || stale !== null}
                          checked={chosen.some((chosenEntry) => chosenEntry.category === entry.category)}
                          onChange={() => pick(entry.category)}
                        />
                      </td>
                      <td>
                        <div className="font-medium">{LABEL[entry.category]}</div>
                        <p id={`${questionId}-${entry.category}`} className="text-xs">
                          {hintFor(entry.category, scan.data.staleAfterDays)}
                        </p>
                        {/* Why it cannot be swept right now, on screen and not
                            in a tooltip: a dark checkbox with no reason reads
                            as a broken app. */}
                        {entry.blocked !== null && (
                          <p className="text-xs text-note">{entry.blocked}</p>
                        )}
                        {entry.examples.length > 0 && (
                          <details className="technical-details mt-2">
                            <summary>See example paths</summary>
                            <ul className="mt-2 space-y-1 font-mono text-xs text-ink-2">
                              {entry.examples.map((example) => (
                                <li key={example} className="break-all">{example}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="num">
                        {entry.count === 0 ? '—' : entry.count.toLocaleString()}
                      </td>
                      <td className="num">{formatBytes(entry.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td />
                    <td>
                      Total found
                      {scan.data.estimate.incomplete && (
                        <p className="text-xs text-note">
                          Some files could not be read, so the sizes are a minimum.
                        </p>
                      )}
                    </td>
                    <td className="num">{scan.data.totalCount.toLocaleString()}</td>
                    <td className="num">{formatBytes(scan.data.totalBytes)}</td>
                  </tr>
                </tfoot>
              </table>}

              {empty.length > 0 && (
                <details className="technical-details mb-5">
                  <summary>{empty.length} {empty.length === 1 ? 'category' : 'categories'} with nothing to clean up</summary>
                  <ul className="mt-2 space-y-1">
                    {empty.map((entry) => <li key={entry.category}>{LABEL[entry.category]}</li>)}
                  </ul>
                </details>
              )}

              {confirming ? (
                <div className="band band-pencil flex-col items-start gap-3" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
                  <h3 id={questionId}>2. Review before moving anything</h3>
                  <p>Move {formatCount(count, 'item')} into kondo&rsquo;s trash?</p>
                  <ul className="space-y-1">
                    {reviewed.map((entry) => (
                      <li key={entry.category}>
                        {LABEL[entry.category]} · {formatCount(entry.count, 'item')} · {formatBytes(entry.bytes)}
                      </li>
                    ))}
                  </ul>
                  <MoveFigures
                    movingBytes={bytes}
                    trashBytesBefore={scan.data.estimate.trashBytesBefore}
                    incomplete={scan.data.estimate.incomplete}
                  />
                  <p>Only the reviewed items will move together. If they change, review again. One Undo restores the move.</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      ref={confirmation.cancelRef}
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={confirmation.cancel}
                    >
                      Cancel
                    </button>
                    <button type="button" disabled={busy || count === 0 || state.loading} className="btn btn-pencil btn-sm" onClick={() => void sweep()}>
                      Move to trash
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3" role="status">
                    <p>
                      {busy ? 'Moving selected files to trash…' : count === 0
                        ? 'No categories selected.'
                        : `${formatCount(count, 'item')} selected.`}
                    </p>
                    {!busy && count > 0 && (
                      <MoveFigures
                        movingBytes={bytes}
                        trashBytesBefore={scan.data.estimate.trashBytesBefore}
                        incomplete={scan.data.estimate.incomplete}
                      />
                    )}
                  </div>
                  <button
                    id={sweepButtonId}
                    type="button"
                    disabled={count === 0 || busy || state.loading || !scan.data.reviewToken || stale !== null}
                    className="btn btn-go"
                    onClick={() => {
                      confirmation.rememberFocus(sweepButtonId)
                      if (scan.data.reviewToken) setReview({ token: scan.data.reviewToken, chosen })
                    }}
                  >
                    Review selected items
                  </button>
                </div>
              )}
            </section>
          )
        }}
      </AsyncView>
    </div>
  )
}
