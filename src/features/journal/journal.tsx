import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { JournalEntryInfo, JournalOp } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { Problems } from '../../ui/problems'
import { Refusal } from '../../ui/refusal'
import { useConfirmationFocus } from '../../ui/use-confirmation-focus'
import { formatAgo, formatBytes, formatCount, joinErrors } from '../../lib/format'

/**
 * The journal and kondo's trash, made visible. ADR-0001 promises every
 * mutation can be undone; this is where that promise stops being invisible —
 * newest first, each row saying what it did and offering to reverse it.
 *
 * Below it sits the one destructive act kondo has. Emptying is its own
 * button on its own channel, confirmed on its own, and it is never a step of
 * anything else on this screen or off it.
 *
 * Every label here is built in the main process (ADR-0002): a summary and an
 * ADR-0008 id, never a line of a transcript or a byte of a project file.
 */

const OP_LABEL: Record<JournalOp, string> = {
  move: 'move',
  'settings-edit': 'settings',
  trash: 'trash'
}

/** Why undo is not on offer for this row, or null when it is. */
function blockedReason(entry: JournalEntryInfo): string | null {
  if (entry.isUndo) return 'An undo cannot itself be undone.'
  if (entry.undoneBy !== null) return 'This entry has already been undone.'
  return null
}

export function Journal() {
  const journal = useScan((api) => api.journalList())
  const trash = useScan((api) => api.trashSize())
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const emptyButtonId = useId()
  const questionId = useId()
  const confirmation = useConfirmationFocus(confirming, () => setConfirming(false))
  const reloadJournal = journal.reload
  const reloadTrash = trash.reload
  const resultRef = useRef<HTMLDivElement>(null)
  const focusResult = useRef(false)

  useLayoutEffect(() => {
    if (busy === null && focusResult.current) {
      resultRef.current?.focus()
      focusResult.current = false
    }
  })

  /**
   * ADR-0006: the store is the state, and so is kondo's trash. An undo moves
   * files back and an empty removes them for good, so neither list is patched
   * here — both come back from a fresh read.
   */
  const refresh = (): void => {
    reloadJournal()
    reloadTrash()
  }

  const begin = (key: string): void => {
    setBusy(key)
    setConfirming(false)
    setProblem(null)
    setOutcome(null)
  }

  const undo = async (entry: JournalEntryInfo): Promise<void> => {
    const api = window.kondo
    if (!api) return
    begin(entry.id)
    try {
      const done = await api.journalUndo(entry.id)
      setProblem(joinErrors(done.errors))
      if (done.data?.isUndo && !done.data.failed) setOutcome(done.data.summary)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
      setBusy(null)
      refresh()
    }
  }

  const empty = async (): Promise<void> => {
    const api = window.kondo
    if (!api) return
    begin('trash')
    try {
      const done = await api.trashEmpty()
      setProblem(joinErrors(done.errors))
      if (done.errors.length === 0) {
        setOutcome(
          done.data.bytes === 0
            ? 'The trash was already empty — nothing was removed.'
            : `Emptied the trash: ${formatBytes(done.data.bytes)} from ` +
              `${formatCount(done.data.entryCount, 'restore point')} gone for good.`
        )
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
      setBusy(null)
      refresh()
    }
  }

  const report = trash.scan?.data
  const held = report?.bytes ?? 0
  const points = report?.entryCount ?? 0

  const trashSection = (
      <section className="sheet" data-tone="coral">
        <div className="sheet-head">
          <h2>Kondo&rsquo;s trash</h2>
          <span className="count">
            {report ? `${formatBytes(held)} · ${formatCount(points, 'restore point')}` : '—'}
          </span>
        </div>
        <div role="status" className="busy">{trash.loading ? 'Reading trash…' : ''}</div>
        {trash.failure !== null && <div role="alert" className="band band-pencil">{trash.failure}</div>}
        {trash.scan && <Problems scan={trash.scan} />}
        <p className="max-w-2xl text-ink-2">
          Files moved out of the way are kept here so you can restore them. They still
          use disk space until you empty the trash. Nothing expires on its own.
        </p>
        {report && (
          <details className="technical-details mt-3">
            <summary>Trash location</summary>
            <p className="mt-2 break-all font-mono text-xs text-ink-2">{report.root}</p>
          </details>
        )}

        <div className="mt-3">
          {confirming ? (
            <div className="band band-pencil flex-col items-start gap-2" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
              <div id={questionId} className="text-pencil">
                Permanently delete {formatBytes(held)} from{' '}
                {formatCount(points, 'restore point')}?
              </div>
              <div className="text-ink-2">
                History will keep its record, but the files needed to restore these
                changes will be deleted. Kondo cannot undo this.
              </div>
              <div className="flex flex-wrap gap-3">
                {/* Cancel comes first and takes the focus: the destructive
                    choice is never the default one (ADR-0001). */}
                <button
                  ref={confirmation.cancelRef}
                  type="button"
                  className="btn btn-go btn-sm"
                  onClick={confirmation.cancel}
                >
                  Keep the trash
                </button>
                <button
                  type="button"
                  disabled={busy !== null || trash.loading || trash.failure !== null || held === 0}
                  className="btn btn-fill btn-sm"
                  onClick={() => void empty()}
                >
                  Empty it permanently
                </button>
              </div>
            </div>
          ) : (
            <button
              id={emptyButtonId}
              type="button"
              disabled={held === 0 || busy !== null || trash.loading || trash.failure !== null}
              className="btn btn-pencil btn-sm"
              onClick={() => {
                confirmation.rememberFocus(emptyButtonId)
                setConfirming(true)
              }}
            >
              {trash.failure !== null
                ? 'Trash unavailable'
                : !report
                  ? 'Reading trash…'
                  : held === 0
                    ? 'Nothing to empty'
                    : `Empty the trash · ${formatBytes(held)}`}
            </button>
          )}
        </div>
      </section>
  )

  return (
    <div>
      <div className="hero">
        <h1>History</h1>
        <p className="mt-2 max-w-2xl">
          Review what kondo changed and restore a change with Undo. Files in the trash
          remain available to restore until you permanently empty it.
        </p>
      </div>
      <div ref={resultRef} tabIndex={-1} aria-label="History result">
        {problem !== null && <div role="alert" className="band band-pencil text-pencil">{problem}</div>}
        {outcome !== null && <div role="status" className="band band-stamp">{outcome}</div>}
      </div>
      <section className="sheet" data-tone="orchid">
        <div className="sheet-head">
          <h2>Recent changes</h2>
          {journal.scan && <span className="count">{journal.scan.data.length}</span>}
        </div>
        <AsyncView
          state={journal}
          empty="No changes yet. After you move, disable or remove something in kondo, its history and Undo action appear here."
        >
          {(scan) => (
            <table className="ledger">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What changed</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scan.data.map((entry) => {
                  const blocked = blockedReason(entry)
                  return (
                    <tr key={entry.id} data-force={blocked === null ? undefined : 'off'}>
                      <td className="whitespace-nowrap text-ink-2" title={entry.at}>
                        {formatAgo(Date.parse(entry.at))}
                      </td>
                      <td className="max-w-lg">
                        <div>{entry.summary}</div>
                        <Refusal reason={entry.failed ? 'A step of this change failed. Undo restores the steps that were applied.' : null} />
                        <details className="technical-details mt-2">
                          <summary>Technical details</summary>
                          <dl className="mt-2 text-xs text-ink-2">
                            <div className="line"><dt>When</dt><dd>{entry.at}</dd></div>
                            <div className="line"><dt>Kind</dt><dd>{entry.kind} · {OP_LABEL[entry.op]}</dd></div>
                            <div className="line"><dt>Steps</dt><dd>{entry.stepCount}</dd></div>
                            <div className="line"><dt>Item</dt><dd className="break-all">{entry.entityId}</dd></div>
                          </dl>
                        </details>
                      </td>
                      <td className="space-x-1 whitespace-nowrap">
                        {entry.undoneBy !== null && <span className="stamp-off" data-sigil="undone">undone</span>}
                        {entry.failed && (
                          <span className="stamp-bad">
                            partly applied
                          </span>
                        )}
                        {!entry.failed && entry.undoneBy === null && (
                          <span className="stamp-ok">{entry.isUndo ? 'restored' : 'applied'}</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          aria-label={`Undo ${entry.summary}`}
                          disabled={blocked !== null || busy !== null}
                          className="btn btn-quiet btn-sm"
                          onClick={() => void undo(entry)}
                        >
                          {busy === entry.id ? 'Undoing…' : 'Undo'}
                        </button>
                        {/* The reason is worth more than the dark button, so
                            it is read rather than hovered for. */}
                        <Refusal reason={blocked} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </AsyncView>
      </section>
      {trashSection}
    </div>
  )
}
