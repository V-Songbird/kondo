import type { ReactNode } from 'react'
import type { Scan } from '../../shared/contract'
import type { ScanState } from '../lib/use-scan'
import { Problems } from './problems'

/** Loading / transport-failure / data shell shared by every view. */
export function AsyncView<T>({
  state,
  children
}: {
  state: ScanState<T>
  children: (scan: Scan<T>) => ReactNode
}) {
  if (state.failure) {
    return <div className="card border-bad/50 text-bad">{state.failure}</div>
  }
  if (state.loading && !state.scan) {
    return <div className="p-8 text-center text-mut">Scanning…</div>
  }
  if (!state.scan) return null
  return (
    <>
      <Problems scan={state.scan} />
      {children(state.scan)}
    </>
  )
}
