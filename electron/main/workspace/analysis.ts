import { flattenProjectPath } from './projects'

/** Pure session analysis; thresholds live here so tests and UI copy agree. */

export const STALE_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function isStale(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs > STALE_AFTER_DAYS * DAY_MS
}

/**
 * Directory names Claude Code only ever makes for throwaway work: a git
 * worktree it checked out for a run, and a background job's sandbox. Both
 * flatten with the leading `.` of the dot-directory intact, so the doubled
 * dash is part of the marker rather than noise.
 */
const SCRATCH_MARKERS = ['--claude-worktrees', '--claude-jobs'] as const

/**
 * Was this project directory only ever scratch? Judged from the flattened
 * name and the temp root alone — no stat, because the directories worth
 * asking about are exactly the ones whose real path is long gone (ADR-0007),
 * and on the owner's machine that is 9,031 of 9,171.
 *
 * `tmpRoot` is flattened the same way Claude Code named the directory, so the
 * test is a prefix on the one spelling both sides share.
 */
export function isScratchProjectName(dirName: string, tmpRoot: string): boolean {
  if (SCRATCH_MARKERS.some((marker) => dirName.includes(marker))) return true
  const flat = flattenProjectPath(tmpRoot)
  return dirName === flat || dirName.startsWith(`${flat}-`)
}
