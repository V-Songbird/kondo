import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JournalEntryInfo } from '../../shared/contract'
import { joinErrors } from '../lib/format'
import { Refusal } from './refusal'

/** Shared language for History and the result beside the initiating control. */
export function changeStatus(entry: JournalEntryInfo): string {
  if (entry.undoneBy !== null) return 'undone'
  if (entry.recovery === 'partial') return 'Undo incomplete'
  if (entry.recovery === 'uncertain') return 'recovery uncertain'
  if (entry.outcome === 'none') return 'no changes applied'
  if (entry.outcome === 'uncertain') return 'result uncertain'
  if (entry.outcome === 'partial') return entry.isUndo ? 'Undo incomplete' : 'partly applied'
  return entry.isUndo ? 'restored' : 'applied'
}

export function changeReason(entry: JournalEntryInfo): string | null {
  if (entry.undoneBy !== null) return null
  if (entry.recovery === 'partial' || (entry.isUndo && entry.outcome === 'partial')) {
    return 'Undo stopped before finishing. Retry continues from the remaining actions.'
  }
  if (entry.outcome === 'uncertain' || entry.recovery === 'uncertain') {
    return 'Kondo could not confirm every effect. Remaining bytes were kept for recovery.'
  }
  if (entry.outcome === 'none') return 'This attempt did not apply any file changes.'
  if (entry.outcome === 'partial') return 'Some changes were applied before a step failed. Undo restores those changes.'
  return null
}

/** Pass key={entry?.id} so another operation starts a fresh result. */
export function LastChange({
  entry,
  onUndone
}: {
  entry: JournalEntryInfo | null
  onUndone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [hasAttempt, setHasAttempt] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [undone, setUndone] = useState(false)
  const [attempt, setAttempt] = useState<JournalEntryInfo | null>(null)
  const focusResult = useRef(false)
  const status = useRef<HTMLSpanElement>(null)

  // Applying or undoing can remove the originating control. Give keyboard
  // users the result, followed by the next available action in tab order.
  useEffect(() => {
    if (entry !== null) status.current?.focus()
  }, [entry?.id, undone])

  useLayoutEffect(() => {
    if (!busy && focusResult.current) {
      status.current?.focus()
      focusResult.current = false
    }
  })

  const undo = async (): Promise<void> => {
    const api = window.kondo
    if (!api || entry === null) return
    setBusy(true)
    setHasAttempt(true)
    setProblem(null)
    try {
      const done = await api.journalUndo(entry.id)
      const failure = joinErrors(done.errors)
      setAttempt(done.data)
      setProblem(failure ?? (done.data === null ? 'Undo did not confirm a result. Check History before retrying.' : null))
      if (done.data?.isUndo && done.data.outcome === 'complete') setUndone(true)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      focusResult.current = true
      setBusy(false)
      // The store is the state (ADR-0006): whether the undo landed or not,
      // what the view is showing came from before it, so it is re-read.
      onUndone()
    }
  }

  if (entry === null) return null

  const label = attempt ? changeStatus(attempt) : changeStatus(entry)
  const reason = attempt ? changeReason(attempt) : changeReason(entry)
  const warning = label !== 'applied' && label !== 'restored'
  return (
    <div className="band band-stamp">
      <span ref={status} tabIndex={-1} role="status"
        className={undone ? 'stamp-off' : warning ? 'stamp-bad' : 'stamp-ok'}
        data-sigil={undone ? 'undone' : undefined}>
        {undone ? `Undone — ${entry.summary}` : `${label.charAt(0).toUpperCase() + label.slice(1)} — ${entry.summary}`}
      </span>
      {!undone && <Refusal reason={reason} />}
      {problem !== null && <span role="alert" className="text-pencil">{problem}</span>}
      {!undone && (
        <>
          <button
            type="button"
            aria-label={`Undo ${entry.summary}`}
            disabled={busy || entry.undoBlockedReason !== null}
            className="btn btn-quiet btn-sm ml-auto"
            onClick={() => void undo()}
          >
            {busy ? 'Undoing…' : hasAttempt || entry.recovery === 'partial' || entry.recovery === 'uncertain' ? 'Retry Undo' : 'Undo'}
          </button>
          <Refusal reason={entry.undoBlockedReason} />
        </>
      )}
    </div>
  )
}
