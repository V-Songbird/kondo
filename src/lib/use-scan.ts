import { useCallback, useEffect, useRef, useState } from 'react'
import type { KondoApi, Scan } from '../../shared/contract'

export interface ScanState<T> {
  scan: Scan<T> | null
  loading: boolean
  /** Transport-level failure (bridge missing, invoke rejected). */
  failure: string | null
  reload: () => void
}

/**
 * Load one Scan<T> through the bridge. Every view consumes this shape and
 * renders the error half too (ADR-0005) — see <Problems />.
 */
export function useScan<T>(
  load: (api: KondoApi) => Promise<Scan<T>>,
  deps: ReadonlyArray<unknown> = []
): ScanState<T> {
  const [scan, setScan] = useState<Scan<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)
  const depsKey = JSON.stringify(deps)

  // A different subject (new deps) must not show the previous subject's data
  // while loading; a same-subject reload keeps it to avoid flicker.
  useEffect(() => {
    setScan(null)
  }, [depsKey])

  useEffect(() => {
    const current = ++generation.current
    const api = window.kondo
    if (!api) {
      setFailure('The kondo bridge is unavailable — run inside Electron (npm run dev).')
      setLoading(false)
      return
    }
    setLoading(true)
    load(api)
      .then((result) => {
        if (generation.current !== current) return
        setScan(result)
        setFailure(null)
      })
      .catch((cause: unknown) => {
        if (generation.current !== current) return
        setFailure(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (generation.current === current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, depsKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { scan, loading, failure, reload }
}
