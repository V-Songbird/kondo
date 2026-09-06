import { useState } from 'react'
import type { JournalEntryInfo, JournalOp } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { Problems } from '../../ui/problems'
import { Refusal } from '../../ui/refusal'
import { formatAgo, formatBytes, formatCount, joinErrors } from '../../lib/format'

/**
 * The journal and kondo's trash, made visible. ADR-0001 promises every
 * mutation can be undone; this is where that promise stops being invisible —
 * newest first, each row saying what it did and offering to reverse it.
 *
 * Above it sits the one destructive act kondo has. Emptying is its own
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
  const reloadJournal = journal.reload
  const reloadTrash = trash.reload

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
      if (done.errors.length === 0) setOutcome(done.data?.summary ?? 'Undone.')
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
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
      setBusy(null)
      refresh()
    }
  }

  const report = trash.scan?.data
  const held = report?.bytes ?? 0
  const points = report?.entryCount ?? 0

  return (
    <div>
      {problem !== null && <div className="band band-pencil text-pencil">{problem}</div>}
      {outcome !== null && <div className="band band-stamp">{outcome}</div>}

      {trash.scan && <Problems scan={trash.scan} />}

      <section className="sheet" data-tone="coral">
        <div className="sheet-head">
          <h2>Kondo&rsquo;s trash</h2>
          <span className="count">
            {formatBytes(held)} · {formatCount(points, 'restore point')}
          </span>
        </div>
        <p className="max-w-2xl text-ink-2">
          Everything kondo has displaced still sits here, and stays until you empty it.
          Nothing expires on its own.
        </p>
        {report && (
          <div className="mt-1 font-mono text-xs text-ink-2" title={report.root}>
            {report.root}
          </div>
        )}

        <div className="mt-3">
          {confirming ? (
            <div className="band band-pencil flex-col items-start gap-2">
              <div className="text-pencil">
                Permanently delete {formatBytes(held)} from{' '}
                {formatCount(points, 'restore point')}?
              </div>
              <div className="text-ink-2">
                History keeps its record, but the files those entries would put back are
                gone. This is the one thing kondo cannot undo.
              </div>
              <div className="flex flex-wrap gap-3">
                {/* Cancel comes first and takes the focus: the destructive
                    choice is never the default one (ADR-0001). */}
                <button
                  type="button"
                  autoFocus
                  className="btn btn-go btn-sm"
                  onClick={() => setConfirming(false)}
                >
                  Keep the trash
                </button>
                <button
                  type="button"
                  className="btn btn-fill btn-sm"
                  onClick={() => void empty()}
                >
                  Empty it permanently
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={held === 0 || busy !== null}
              className="btn btn-pencil btn-sm"
              onClick={() => setConfirming(true)}
            >
              {held === 0 ? 'Nothing to empty' : `Empty the trash · ${formatBytes(held)}`}
            </button>
          )}
        </div>
      </section>

      <section className="sheet" data-tone="orchid">
        <div className="sheet-head">
          <h2>History</h2>
          {journal.scan && <span className="count">{journal.scan.data.length}</span>}
        </div>
        <AsyncView
          state={journal}
          empty="Nothing yet — kondo has not changed anything on this machine. Every change it makes is listed here, with a way to undo it."
        >
          {(scan) => (
            <table className="ledger">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What it did</th>
                  <th>Kind</th>
                  <th className="num">Steps</th>
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
                        <div
                          className="truncate font-mono text-xs text-ink-2"
                          title={entry.entityId}
                        >
                          {entry.entityId}
                        </div>
                      </td>
                      <td className="space-x-1 whitespace-nowrap">
                        <span className="stamp">{entry.kind}</span>
                        <span className="stamp">{OP_LABEL[entry.op]}</span>
                        {entry.undoneBy !== null && <span className="stamp-off" data-sigil="undone">undone</span>}
                        {entry.failed && (
                          <span
                            className="stamp-bad"
                            title="A step of this change failed; the store never got all of it. Undo puts back whatever did happen."
                          >
                            failed
                          </span>
                        )}
                      </td>
                      <td className="num text-ink-2">{entry.stepCount}</td>
                      <td className="text-right">
                        <button
                          type="button"
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
    </div>
  )
}
