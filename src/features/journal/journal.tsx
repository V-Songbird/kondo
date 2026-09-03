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
    <div className="space-y-4">
      {problem !== null && <div className="card border-bad/50 text-bad">{problem}</div>}
      {outcome !== null && <div className="card border-ok/50 text-ok">{outcome}</div>}

      {trash.scan && <Problems scan={trash.scan} />}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-semibold">Kondo&rsquo;s trash</h2>
            <p className="max-w-2xl text-mut">
              Everything kondo has displaced still sits here, and stays until you empty
              it. Nothing expires on its own.
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg">{formatBytes(held)}</div>
            <div className="text-xs text-mut">
              {formatCount(points, 'restore point')}
            </div>
          </div>
        </div>
        {report && (
          <div className="font-mono text-xs text-mut" title={report.root}>
            {report.root}
          </div>
        )}

        {confirming ? (
          <div className="space-y-3 rounded-md border border-bad/60 bg-inset p-3">
            <div className="text-bad">
              Permanently delete {formatBytes(held)} from{' '}
              {formatCount(points, 'restore point')}?
            </div>
            <div className="text-mut">
              History keeps its record, but the files those entries would put back are
              gone. This is the one thing kondo cannot undo.
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Cancel comes first and takes the focus: the destructive
                  choice is never the default one (ADR-0001). */}
              <button
                type="button"
                autoFocus
                className="cursor-pointer rounded-md border border-edge px-3 py-1 hover:bg-panel"
                onClick={() => setConfirming(false)}
              >
                Keep the trash
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border border-bad/60 px-3 py-1 text-bad hover:bg-bad/10"
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
            className="cursor-pointer rounded-md border border-bad/50 px-3 py-1.5 text-bad hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setConfirming(true)}
          >
            {held === 0 ? 'Nothing to empty' : `Empty the trash · ${formatBytes(held)}`}
          </button>
        )}
      </div>

      <AsyncView
        state={journal}
        empty="Nothing yet — kondo has not changed anything on this machine. Every change it makes is listed here, with a way to undo it."
      >
        {(scan) => (
          <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What it did</th>
                  <th>Kind</th>
                  <th className="text-right">Steps</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {scan.data.map((entry) => {
                  const blocked = blockedReason(entry)
                  return (
                    <tr key={entry.id} className={blocked === null ? '' : 'opacity-60'}>
                      <td className="whitespace-nowrap text-mut" title={entry.at}>
                        {formatAgo(Date.parse(entry.at))}
                      </td>
                      <td className="max-w-lg">
                        <div>{entry.summary}</div>
                        <div
                          className="truncate font-mono text-xs text-mut"
                          title={entry.entityId}
                        >
                          {entry.entityId}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="pill">{entry.kind}</span>{' '}
                        <span className="pill">{OP_LABEL[entry.op]}</span>
                        {entry.undoneBy !== null && (
                          <>
                            {' '}
                            <span className="pill text-warn">undone</span>
                          </>
                        )}
                        {entry.failed && (
                          <>
                            {' '}
                            <span
                              className="pill text-warn"
                              title="A step of this change failed; the store never got all of it. Undo puts back whatever did happen."
                            >
                              failed
                            </span>
                          </>
                        )}
                      </td>
                      <td className="text-right text-mut">{entry.stepCount}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={blocked !== null || busy !== null}
                          className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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
    </div>
  )
}
