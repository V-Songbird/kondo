import os from 'node:os'
import path from 'node:path'
import {
  tidyCategories,
  type TidyCategory,
  type TidyCategoryPreview,
  type TidyPreview
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import type { MutationPlan, PlannedStep } from './mutations'
import { isScratchProjectName, isStale, STALE_AFTER_DAYS } from './analysis'
import { tildify } from './display'
import { directorySize, mapPool, safeReaddir, type Collector } from './scan'
import type { SessionInventory } from './sessions'

/**
 * The tidy sweep: what a bloated store would get back, and the single
 * reversible operation that takes it back.
 *
 * Two halves that have to agree. The preview is a pure scan — it moves
 * nothing — and the plan is built from the *same* candidate set, so what the
 * user confirmed is exactly what moves. Both read the cached tier-1
 * inventory rather than walking the store afresh (ADR-0007): 8,921 project
 * directories must answer "what would this free?" without opening one
 * transcript.
 *
 * Everything the sweep touches goes through kondo's trash as one journal
 * entry (ADR-0001 decision 2) — undo restores a sweep whole or not at all.
 */

/** One thing the sweep displaces; a session carries its sidecar with it. */
interface Candidate {
  /** Store-relative and `/`-separated, the way a mutation step wants it. */
  paths: string[]
  bytes: number
  /** Tildified, for the preview's examples. */
  display: string
}

export type TidyCandidates = Record<TidyCategory, Candidate[]>

/**
 * The user-store directories domain.md marks as caches and support state;
 * Claude rebuilds each on demand. A fixed allowlist and never a heuristic on
 * size or age: `backups/` and `file-history/` grow exactly the same way and
 * look just as reclaimable, but they back checkpoint and rewind, so kondo
 * does not offer them.
 */
const RECLAIMABLE = [
  'cache',
  'paste-cache',
  'debug',
  'downloads',
  'shell-snapshots',
  'telemetry'
] as const

/** Display paths shown per category, so a count is inspectable, not a claim. */
const EXAMPLES = 5

const relativeTo = (root: string, target: string): string =>
  path.relative(root, target).split(path.sep).join('/')

/**
 * Every candidate, by category. Reads only: the whole point of the preview
 * is that this function is what produces it and it writes nothing.
 */
export async function scanTidyCandidates(
  locator: StoreLocator,
  inventory: SessionInventory,
  nowMs: number,
  c: Collector
): Promise<TidyCandidates> {
  const root = locator.userRoot
  const candidates: TidyCandidates = {
    'scratch-projects': [],
    'dead-projects': [],
    'stale-sessions': [],
    'empty-transcripts': [],
    'orphan-sidecars': [],
    'reclaimable-caches': []
  }

  // The two whole-tree categories go first and claim their directories, so
  // the per-file pass below has only to skip what they took. That is the
  // whole of the exclusivity rule: a transcript queued inside a directory
  // that is itself moving would make the second trash step of the pair fail.
  //
  // Name and inventory only — no project tree is walked to decide a category
  // (ADR-0007), which is what lets this answer for 9,171 directories.
  const tmpRoot = os.tmpdir()
  const trees = new Map<string, TidyCategory>()
  for (const project of inventory.projects) {
    // Only a directory under `projects/` can be trashed as a tree. A project
    // the registry names and `projects/` does not has nothing here to move,
    // however dead its path is.
    if (!project.sources.includes('transcripts')) continue
    if (isScratchProjectName(project.dirName, tmpRoot) || project.sessions.length === 0) {
      // Transcript-less covers the memory-only directory too: whatever else
      // is in there, no conversation was ever recorded against it.
      trees.set(project.dirName, 'scratch-projects')
    } else if (project.location === 'gone') {
      // `gone` and never `unlocated` — a name kondo could not reverse is not
      // evidence of anything (ADR-0009).
      trees.set(project.dirName, 'dead-projects')
    }
  }

  const orphans: string[] = []
  for (const project of inventory.projects) {
    // Skipped whole: every path inside a claimed directory is already
    // covered by the one step that moves the directory.
    if (trees.has(project.dirName)) continue
    for (const session of project.sessions) {
      // The sidecar rides with its transcript. Leaving it behind would only
      // make it tomorrow's orphan, and it is state for a session that is
      // going anyway.
      const paths = [relativeTo(root, session.file)]
      if (session.sidecar !== null) {
        paths.push(relativeTo(root, path.join(project.absPath, session.sidecar)))
      }
      const item: Candidate = {
        paths,
        bytes: session.bytes,
        display: tildify(session.file, locator.home)
      }
      // A zero-byte transcript is empty whatever its age, so that category
      // claims it — no path is ever queued under two categories, which is
      // what would make the second trash step of a pair fail.
      if (session.bytes === 0) candidates['empty-transcripts'].push(item)
      else if (isStale(session.mtimeMs, nowMs)) candidates['stale-sessions'].push(item)
    }
    for (const name of project.orphanDirs) orphans.push(path.join(project.absPath, name))
  }

  // An orphan's whole value is its directory, so unlike a transcript it has
  // to be measured. Bounded, and only over the directories the inventory
  // already proved orphaned — never the projects tree at large.
  candidates['orphan-sidecars'] = await mapPool(orphans, 16, async (absPath) => {
    const display = tildify(absPath, locator.home)
    return {
      paths: [relativeTo(root, absPath)],
      bytes: await directorySize(absPath, display, c),
      display
    }
  })

  // A project directory is offered whole, as one path — its size is the
  // point of offering it, and one trash step over the tree is what makes the
  // undo put it back in one (ADR-0001 decision 2).
  const claimed = inventory.projects.filter((project) => trees.has(project.dirName))
  const measured = await mapPool(claimed, 16, async (project) => {
    const display = tildify(project.absPath, locator.home)
    return {
      category: trees.get(project.dirName) as TidyCategory,
      candidate: {
        paths: [relativeTo(root, project.absPath)],
        bytes: await directorySize(project.absPath, display, c),
        display
      }
    }
  })
  for (const entry of measured) candidates[entry.category].push(entry.candidate)

  const rootDisplay = tildify(root, locator.home)
  const present = new Set(
    (await safeReaddir(root, rootDisplay, c))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  )
  for (const name of RECLAIMABLE) {
    if (!present.has(name)) continue
    const display = `${rootDisplay}/${name}`
    const bytes = await directorySize(path.join(root, name), display, c)
    // An empty cache directory reclaims nothing, and moving one would be
    // journal noise for a directory Claude recreates on its next run.
    if (bytes > 0) candidates['reclaimable-caches'].push({ paths: [name], bytes, display })
  }

  return candidates
}

/** The dry run itself: counts and bytes per category, and nothing moved. */
export function toTidyPreview(candidates: TidyCandidates): TidyPreview {
  const categories: TidyCategoryPreview[] = tidyCategories.map((category) => {
    const items = candidates[category]
    return {
      category,
      count: items.length,
      bytes: items.reduce((sum, item) => sum + item.bytes, 0),
      examples: items.slice(0, EXAMPLES).map((item) => item.display)
    }
  })
  return {
    categories,
    totalCount: categories.reduce((sum, entry) => sum + entry.count, 0),
    totalBytes: categories.reduce((sum, entry) => sum + entry.bytes, 0),
    staleAfterDays: STALE_AFTER_DAYS
  }
}

/** Both forms spelled out — "cache directorys" is not a plural. */
const LABEL: Record<TidyCategory, readonly [one: string, many: string]> = {
  'scratch-projects': ['throwaway project folder', 'throwaway project folders'],
  'dead-projects': ['deleted project', 'deleted projects'],
  'stale-sessions': ['stale session', 'stale sessions'],
  'empty-transcripts': ['empty transcript', 'empty transcripts'],
  'orphan-sidecars': ['orphaned sidecar', 'orphaned sidecars'],
  'reclaimable-caches': ['cache directory', 'cache directories']
}

/**
 * The one entry the whole sweep is. Every item of every chosen category
 * becomes a `trash` step in a single plan, so `undo` puts the sweep back
 * together rather than file by file (ADR-0001 decision 2). Null when the
 * chosen categories hold nothing — a tidy store writes no journal entry at
 * all, which is what makes a sweep over it a true no-op.
 */
export function tidyPlan(
  candidates: TidyCandidates,
  chosen: readonly TidyCategory[]
): MutationPlan | null {
  const categories = tidyCategories.filter((category) => chosen.includes(category))
  const steps: PlannedStep[] = categories.flatMap((category) =>
    candidates[category].flatMap((item) =>
      item.paths.map((from) => ({ type: 'trash' as const, store: 'user', from }))
    )
  )
  if (steps.length === 0) return null

  const parts = categories
    .map((category) => ({ category, count: candidates[category].length }))
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${LABEL[part.category][part.count === 1 ? 0 : 1]}`)

  return {
    op: 'trash',
    // A sweep spans transcripts, sidecar state and cache directories, so no
    // single entity below the store is the thing it changed (ADR-0008).
    kind: 'store',
    entityId: 'store:user',
    summary: `Tidy sweep: ${parts.join(', ')} into kondo's trash`,
    steps
  }
}

/** The categories in a renderer-supplied list; null when it is malformed. */
export function readCategories(value: unknown): TidyCategory[] | null {
  if (!Array.isArray(value)) return null
  const chosen: TidyCategory[] = []
  for (const entry of value as unknown[]) {
    const known = tidyCategories.find((category) => category === entry)
    if (known === undefined) return null
    chosen.push(known)
  }
  return chosen
}
