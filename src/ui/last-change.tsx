import { useEffect, useRef, useState } from 'react'
import type { JournalEntryInfo } from '../../shared/contract'
import { joinErrors } from '../lib/format'
import { Refusal } from './refusal'

/**
 * What just changed, and the way back — offered where the change was made.
 * ADR-0001 promises every mutation is reversible; a promise you have to
 * navigate to History to collect is one the user does not feel, so the undo
 * sits next to the control that caused it.
 *
 * `entry` is whatever the mutation returned, and null when the call refused
 * or changed nothing — the banner is absent then rather than empty. Give the
 * element `key={entry?.id}` so a second change starts a fresh banner instead
 * of inheriting the first one's "undone".
 */
export function LastChange({
  entry,
  onUndone
}: {
  entry: JournalEntryInfo | null
  onUndone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [undone, setUndone] = useState(false)
  const status = useRef<HTMLSpanElement>(null)

  // Applying or undoing can remove the originating control. Give keyboard
  // users the result, followed by the next available action in tab order.
  useEffect(() => {
    if (entry !== null) status.current?.focus()
  }, [entry?.id, undone])

  const undo = async (): Promise<void> => {
    const api = window.kondo
    if (!api || entry === null) return
    setBusy(true)
    setProblem(null)
    try {
      const done = await api.journalUndo(entry.id)
      const failure = joinErrors(done.errors)
      setProblem(failure)
      if (done.data?.isUndo && !done.data.failed) setUndone(true)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      // The store is the state (ADR-0006): whether the undo landed or not,
      // what the view is showing came from before it, so it is re-read.
      onUndone()
    }
  }

  if (entry === null) return null

  // A green-ruled band is the ledger's "posted" stamp: the change is on the
  // books, and the way back sits at the end of the same line.
  return (
    <div className="band band-stamp">
      {/* A change is an addition to the journal, so the band's gutter mark is
          `+`; undone is aged-out rather than broken, so it becomes the amber
          `~`. The sigil is what separates the two, not the hue. */}
      <span ref={status} tabIndex={-1} role="status" className={undone ? 'stamp-off' : 'stamp-ok'} data-sigil={undone ? 'undone' : undefined}>
        {undone ? `Undone — ${entry.summary}` : entry.summary}
      </span>
      {entry.failed && (
        <span className="stamp-bad">
          partly applied
        </span>
      )}
      <Refusal reason={entry.failed && !undone ? 'A step of this change failed. Undo restores the steps that were applied.' : null} />
      {problem !== null && <span role="alert" className="text-pencil">{problem}</span>}
      {!undone && (
        <button
          type="button"
          aria-label={`Undo ${entry.summary}`}
          disabled={busy}
          className="btn btn-quiet btn-sm ml-auto"
          onClick={() => void undo()}
        >
          {busy ? 'Undoing…' : 'Undo'}
        </button>
      )}
    </div>
  )
}
