import path from 'node:path'

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
 * Scratch markers or containment in either temporary-root spelling, using
 * existing inventory paths only (ADR-0007). Registry paths survive deletion,
 * so no new stat is needed. A flattened name alone cannot distinguish
 * `/tmp/project` from `/tmp-project`; unknown paths cannot prove temp origin.
 */
export function isScratchProjectName(
  dirName: string,
  tmpRoots: readonly (string | null)[],
  projectPath: string | null
): boolean {
  if (SCRATCH_MARKERS.some((marker) => dirName.includes(marker))) return true
  if (projectPath === null) return false
  return tmpRoots.some((root) => {
    if (!root) return false
    const paths = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(root) ? path.win32 : path.posix
    if (!paths.isAbsolute(root)) return false
    if (!paths.isAbsolute(projectPath)) return false
    const relative = paths.relative(root, projectPath)
    return relative === '' || (
      relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative)
    )
  })
}
