import type { ProjectRow } from '../../../shared/contract'

/**
 * The reading half of the projects list: which rows show, in what order, and
 * what is folded away. Kept out of the component so it can be tested without
 * a DOM (kondo has no jsdom).
 *
 * A real store has thousands of rows and most of them are runs Claude did
 * for itself in a temp directory, or projects whose directory is gone
 * (ADR-0009): nothing to open there, and Clean up already lists both. So
 * those fold behind one count unless asked for, and the rows that do show are
 * handed out a page at a time so eleven thousand buttons never mount at once.
 */

/** Whether a row is folded away by default: nothing worth opening behind it. */
export function isFolded(row: ProjectRow): boolean {
  return !row.global && (row.location === 'gone' || row.throwaway)
}

export const PAGE = 200

export interface ListView {
  /** The rows to render, the global row first, at most `limit` of the rest. */
  shown: ProjectRow[]
  /** How many rows matched the filter but are past `limit`. */
  more: number
  /** How many matching rows were folded away as throwaway or gone from disk. */
  hidden: number
  /** Whether any non-global row matched the filter at all. */
  matched: boolean
}

export function listView(
  rows: readonly ProjectRow[],
  options: { query: string; showFolded: boolean; limit: number }
): ListView {
  const needle = options.query.trim().toLowerCase()
  const global = rows.filter((row) => row.global)
  // The filter reads the whole label, so a parent directory matches too.
  const matching = rows.filter(
    (row) => !row.global && (needle === '' || row.label.toLowerCase().includes(needle))
  )
  const kept = options.showFolded ? matching : matching.filter((row) => !isFolded(row))
  const limit = Math.max(0, options.limit)
  return {
    shown: [...global, ...kept.slice(0, limit)],
    more: Math.max(0, kept.length - limit),
    hidden: matching.length - kept.length,
    matched: matching.length > 0
  }
}
