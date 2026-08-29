/** Pure session analysis; thresholds live here so tests and UI copy agree. */

export const STALE_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function isStale(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs > STALE_AFTER_DAYS * DAY_MS
}
