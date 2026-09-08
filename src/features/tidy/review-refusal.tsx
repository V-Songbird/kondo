import { useLayoutEffect, useRef } from 'react'

/** A refused review has no retry-to-delete action; selection starts again. */
export function ReviewRefusal({ reason, selection, onReview }: {
  reason: string
  selection: string
  onReview: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { ref.current?.focus() }, [])
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="band band-pencil flex-col items-start gap-3 text-pencil">
      <h3>Review changed — nothing moved</h3>
      <p className="break-words">{selection}</p>
      <p className="break-words">{reason}</p>
      <button type="button" className="btn btn-quiet btn-sm" onClick={onReview}>
        Return to review
      </button>
    </div>
  )
}
