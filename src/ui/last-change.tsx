import { useState } from 'react'
import type { JournalEntryInfo } from '../../shared/contract'

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

  const undo = async (): Promise<void> => {
    const api = window.kondo
    if (!api || entry === null) return
    setBusy(true)
    setProblem(null)
    try {
      const done = await api.journalUndo(entry.id)
      const failure = done.errors[0]?.message ?? null
      setProblem(failure)
      if (failure === null) setUndone(true)
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

  return (
    <div className="card flex flex-wrap items-center gap-3 border-ok/40 py-2">
      <span className={undone ? 'text-mut' : 'text-ok'}>
        {undone ? `Undone — ${entry.summary}` : entry.summary}
      </span>
      {entry.failed && (
        <span
          className="pill text-warn"
          title="A step of this operation failed; the store never got all of it. Undo puts back whatever did happen."
        >
          partly applied
        </span>
      )}
      {problem !== null && <span className="text-bad">{problem}</span>}
      {!undone && (
        <button
          type="button"
          disabled={busy}
          className="ml-auto cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void undo()}
        >
          {busy ? 'Undoing…' : 'Undo'}
        </button>
      )}
    </div>
  )
}
