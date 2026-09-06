import type { ConfigOrphan, ConfigOrphanKind, ScanError } from '../../../shared/contract'

/**
 * The reading half of Settings leftovers, kept apart from the JSX so it can
 * be asserted directly. Everything here is a pure function of one
 * `Scan<ConfigOrphan[]>`; the component below adds only selection and the
 * two calls across the bridge.
 */

/**
 * The order the groups are shown in, widest member first. It is also the
 * order that makes the covering rule readable: picking a folder Claude still
 * lists already covers the servers declared inside it (ADR-0010), so the
 * folder sits above them.
 */
export const orphanKindOrder = [
  'project-entry',
  'mcp-declaration',
  'enabled-plugin',
  'skill-override'
] as const satisfies readonly ConfigOrphanKind[]

/** Plain words for the group, not kondo's internal name for the kind. */
const LABEL: Record<ConfigOrphanKind, string> = {
  'project-entry': 'Projects Claude still lists',
  'mcp-declaration': 'Connections in those project entries',
  'enabled-plugin': 'Settings for missing plugins',
  'skill-override': 'Settings for skills not found'
}

/** Explain the evidence for each group without claiming every location was read. */
const HINT: Record<ConfigOrphanKind, string> = {
  'project-entry': 'Claude still records these folders, but they are no longer on disk.',
  'mcp-declaration':
    'Connections saved in those project entries. Removing a project entry also removes its saved connections.',
  'enabled-plugin': 'Saved on/off settings with no matching plugin in Claude’s installation records.',
  'skill-override': 'Saved settings for skill names kondo did not find in the locations it checked. Review each reason before removing a setting.'
}

export interface OrphanGroup {
  kind: ConfigOrphanKind
  label: string
  hint: string
  rows: ConfigOrphan[]
}

/**
 * Group the scan's rows by kind, in `orphanKindOrder`, dropping the kinds
 * that found nothing. A heading over an empty table says a kind was checked
 * and told the user nothing; the empty state on the view says that once.
 */
export function groupByKind(orphans: readonly ConfigOrphan[]): OrphanGroup[] {
  return orphanKindOrder
    .map((kind) => ({
      kind,
      label: LABEL[kind],
      hint: HINT[kind],
      rows: orphans.filter((orphan) => orphan.kind === kind)
    }))
    .filter((group) => group.rows.length > 0)
}

/**
 * The ticked rows that are still there, in the order the scan returned them.
 *
 * Selection is held as ids and outlives a re-read on purpose — a stale-file
 * refusal re-reads the list under the user rather than throwing their picks
 * away. An id that no longer resolves against the fresh scan simply drops
 * out here, so nothing dead is ever sent back across the bridge.
 */
export function chosenFrom(
  orphans: readonly ConfigOrphan[],
  selectedIds: readonly string[]
): ConfigOrphan[] {
  return orphans.filter((orphan) => selectedIds.includes(orphan.id))
}

/**
 * What went wrong, split the way the user has to act on it.
 *
 * `stale-file` is not a failure — it is ADR-0010 working. Claude rewrote
 * `~/.claude.json` between the preview and the Remove, so kondo wrote
 * nothing rather than write over it, and the only thing to do is read again.
 * That is a different sentence and a different tone from "kondo could not do
 * this", so it comes back as its own field.
 */
export interface Refusal {
  /** ADR-0010's expected refusal: nothing was written, re-read and retry. */
  stale: string | null
  /** Everything else, joined — a real problem. */
  failure: string | null
}

export function refusalFrom(errors: readonly ScanError[]): Refusal {
  const stale = errors.filter((error) => error.code === 'stale-file')
  const rest = errors.filter((error) => error.code !== 'stale-file')
  return {
    stale:
      stale.length === 0
        ? null
        : 'The file moved on while you were looking at it — nothing was written and nothing was lost. This list has been read again; check what is still ticked and remove it once more.',
    failure: rest.length === 0 ? null : rest.map((error) => error.message).join(' · ')
  }
}
