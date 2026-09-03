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
    return <div className="card border-bad/50 text-bad">{state.failure}</div>
  }
  if (state.loading && !state.scan) {
    return <div className="p-8 text-center text-mut">Scanning…</div>
  }
  if (!state.scan) return null
  const scan = state.scan
  const nothing =
    empty !== undefined && Array.isArray(scan.data) && scan.data.length === 0
  return (
    <>
      <Problems scan={scan} />
      {/* A re-read over data already on screen keeps the data — flicker is
          worse than a stale second — so the pill is what says it is stale. */}
      {state.loading && (
        <div className="mb-2">
          <span className="pill">Refreshing…</span>
        </div>
      )}
      {nothing ? <div className="card text-mut">{empty}</div> : children(scan)}
    </>
  )
}
