import type { ReactNode } from 'react'
import type { Scan } from '../../shared/contract'
import type { ScanState } from '../lib/use-scan'
import { Problems } from './problems'

/** Loading / transport-failure / data shell shared by every view. */
export function AsyncView<T>({
  state,
  empty,
  children
}: {
  state: ScanState<T>
  /**
   * What to say when the scan came back holding no rows. A table header with
   * nothing under it tells a first-time user nothing — not whether the scan
   * found nothing, whether it failed, or whether kondo even looked — so a
   * list view passes the sentence that answers that. Only an array `data` can
   * be empty in this sense; anything else renders `children` as before.
   */
  empty?: ReactNode
  children: (scan: Scan<T>) => ReactNode
}) {
  if (state.failure) {
    return <div className="band band-pencil text-pencil">{state.failure}</div>
  }
  if (state.loading && !state.scan) {
    // Bars where the rows will be, and they do not move: a pulsing skeleton
    // implies progress kondo has no way to measure (DESIGN.md).
    return (
      <div aria-busy="true">
        <p>Scanning…</p>
        <div className="slot">
          <i />
          <i />
          <i />
        </div>
      </div>
    )
  }
  if (!state.scan) return null
  const scan = state.scan
  const nothing =
    empty !== undefined && Array.isArray(scan.data) && scan.data.length === 0
  return (
    <>
      <Problems scan={scan} />
      {/* A re-read over data already on screen keeps the data — flicker is
          worse than a stale second — so a word is what says it is stale. The
          slot is 12ch of reserved mono width whether or not it is filled, so
          the indicator can never shift the rows beneath it (DESIGN.md); only
          a mono grid can actually make that promise. */}
      <div className="busy">{state.loading ? 'Refreshing…' : ''}</div>
      {nothing ? <div className="empty">{empty}</div> : children(scan)}
    </>
  )
}
