import fs from 'node:fs/promises'
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
import { reviewedBytes } from './reviewed-removals'
import {
  directorySize,
  inspectTree,
  isEnoent,
  relativeTo,
  resolveAllowedPath,
  safeReaddir,
  type Collector
} from './scan'
import type { SessionInventory } from './sessions'
import {
  installKey,
  readInstalledPlugins,
  PLUGIN_CACHE_DIR,
  PLUGIN_DATA_DIR,
  PLUGIN_MANIFEST_DIR,
  PLUGINS_DIR
} from './user-store'

/**
 * The tidy sweep: what a bloated store would get back, and the single
 * reversible operation that takes it back.
 *
 * Two halves that have to agree. The preview is a pure scan — it moves
 * nothing — and the plan is built from the *same* candidate set, so what the
 * user confirmed is exactly what moves. The workspace forces fresh inventory
 * at review/apply and retains exact tree snapshots under opaque review tokens.
 * Transcript hashing is streamed; ordinary inventory remains stat-based.
 *
 * Everything the sweep touches goes through kondo's trash as one journal
 * entry (ADR-0001 decision 2) — undo restores a sweep whole or not at all.
 */

/**
 * One thing the sweep displaces; a session carries its sidecar with it.
 *
 * No size here on purpose: what a candidate costs is measured from the trash
 * steps `tidyPlan` builds out of `paths`, not carried beside them, so the
 * figure on screen and the bytes that move cannot drift apart (ADR-0015).
 */
interface Candidate {
  /** Store-relative and `/`-separated, the way a mutation step wants it. */
  paths: string[]
  /** Tildified, for the preview's examples. */
  display: string
  /** The mutation store the paths are relative to; the user store unless said. */
  store?: string
}

export type TidyCandidates = Record<TidyCategory, Candidate[]>

/** Why a category cannot be swept right now, per category that has a reason. */
export type TidyBlocks = Partial<Record<TidyCategory, string>>

export interface TidyScan {
  withheldScratchCount: number
  candidates: TidyCandidates
  blocked: TidyBlocks
}

/**
 * Chromium's own caches, rebuilt on the next launch — what "clear cache" means
 * in any Electron app. A fixed allowlist, as `RECLAIMABLE` is: `IndexedDB`,
 * `Local Storage`, `Session Storage` and the rest sit beside them and hold the
 * app's state, and the desktop store's own directories (`vm_bundles`,
 * `pending-uploads`, sessions) are not caches at all (domain.md).
 */
const CHROMIUM_CACHES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary'
] as const
const PARTITIONS = 'Partitions'

const DESKTOP_APP_RUNNING =
  'The Claude desktop app is running and holds its caches open. Quit it, then clean up.'

/**
 * Whether the desktop app has its data directory in use. Windows first:
 * Electron keeps `lockfile` open with exclusive access while it runs, so an
 * open for writing fails with EBUSY — verified on the owner's machine with
 * the app up. Elsewhere Chromium leaves `SingletonLock` / `SingletonSocket` /
 * `SingletonCookie` behind while running (and after a crash — the honest
 * error is refusing a sweep that would have worked, not the reverse).
 */
export async function desktopAppBusy(locator: StoreLocator, c: Collector): Promise<string | null> {
  const root = locator.desktopRoot
  if (root === null) return null
  let lockfile: string
  let resolvedRoot: string
  try {
    resolvedRoot = await resolveAllowedPath(root, root, true)
    lockfile = await resolveAllowedPath(path.join(root, 'lockfile'), root, true)
  } catch (cause) {
    c.fail('read-failed', tildify(path.join(root, 'lockfile'), locator.home), cause)
    return 'The desktop app lock could not be checked safely.'
  }
  try {
    const handle = await fs.open(lockfile, 'r+')
    await handle.close()
  } catch (cause) {
    if (!isEnoent(cause)) return DESKTOP_APP_RUNNING
  }
  for (const marker of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      await fs.lstat(path.join(resolvedRoot, marker))
      return DESKTOP_APP_RUNNING
    } catch {
      // not there: keep looking
    }
  }
  return null
}

/**
 * The desktop store's Chromium caches, at its root and inside each partition,
 * as `desktop`-store candidates. Empty directories reclaim nothing and are
 * left out, as the user store's are.
 */
async function scanDesktopCaches(
  locator: StoreLocator,
  candidates: TidyCandidates,
  c: Collector
): Promise<void> {
  const root = locator.desktopRoot
  if (root === null) return
  const rootDisplay = tildify(root, locator.home)
  const homes: Array<{ relative: string; display: string }> = [{ relative: '', display: rootDisplay }]
  const partitionsDisplay = `${rootDisplay}/${PARTITIONS}`
  for (const entry of await safeReaddir(path.join(root, PARTITIONS), partitionsDisplay, c, root)) {
    if (!entry.isDirectory()) continue
    homes.push({
      relative: `${PARTITIONS}/${entry.name}`,
      display: `${partitionsDisplay}/${entry.name}`
    })
  }
  for (const home of homes) {
    const dir = home.relative === '' ? root : path.join(root, ...home.relative.split('/'))
    const present = new Set(
      (await safeReaddir(dir, home.display, c, root))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    )
    for (const name of CHROMIUM_CACHES) {
      if (!present.has(name)) continue
      const display = `${home.display}/${name}`
      // Measured here only to skip a cache that reclaims nothing; the
      // preview's figure comes from the trash steps, not from this.
      if (await directorySize(path.join(dir, name), display, c, root) === 0) continue
      candidates['desktop-caches'].push({
        store: 'desktop',
        paths: [home.relative === '' ? name : `${home.relative}/${name}`],
        display
      })
    }
  }
}

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

/** One directory per session id, keyed by that id (domain.md). */
const SESSION_ENV = 'session-env'

/**
 * The shape `sessions.ts` matches a transcript filename by. `session-env/`
 * is joined to `projects/` on exactly this id, so a directory that is not
 * uuid-shaped is not a session snapshot and kondo leaves it where it is.
 */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Display paths shown per category, so a count is inspectable, not a claim. */
const EXAMPLES = 5

/**
 * Every candidate, by category. Reads only: the whole point of the preview
 * is that this function is what produces it and it writes nothing.
 */
export async function scanTidyCandidates(
  locator: StoreLocator,
  inventory: SessionInventory,
  nowMs: number,
  c: Collector
): Promise<TidyScan> {
  const root = locator.userRoot
  const candidates: TidyCandidates = {
    'scratch-projects': [],
    'dead-projects': [],
    'stale-sessions': [],
    'empty-transcripts': [],
    'desktop-released-sessions': [],
    'orphan-sidecars': [],
    'orphan-session-env': [],
    'reclaimable-caches': [],
    'desktop-caches': [],
    'superseded-plugin-versions': [],
    'orphan-plugin-residue': [],
    'unarmed-hook-scripts': []
  }

  // The two whole-tree categories go first and claim their directories, so
  // the per-file pass below has only to skip what they took. That is the
  // whole of the exclusivity rule: a transcript queued inside a directory
  // that is itself moving would make the second trash step of the pair fail.
  //
  // Name and inventory only — no project tree is walked to decide a category
  // (ADR-0007), which is what lets this answer for 9,171 directories.
  const tmpRoots = [locator.tmpRoot, locator.tmpRootRealpath]
  const trees = new Map<string, TidyCategory>()
  const withheld = new Set<string>()
  for (const project of inventory.projects) {
    // Only a directory under `projects/` can be trashed as a tree. A project
    // the registry names and `projects/` does not has nothing here to move,
    // however dead its path is.
    if (!project.sources.includes('transcripts')) continue
    if (isScratchProjectName(project.dirName, tmpRoots, project.guessedPath)) {
      // A name does not establish disuse. Preserve memory and recent state,
      // including sidecars, and do not fall through to another category.
      if (project.hasMemory || !(await inactiveScratch(project.absPath, root, nowMs, c))) {
        withheld.add(project.dirName)
      } else trees.set(project.dirName, 'scratch-projects')
    } else if (project.location === 'gone') {
      // `gone` and never `unlocated` or `unreadable` — a name kondo could not
      // reverse, and a path it could not stat, are not evidence of anything
      // (ADR-0009, entry 075: an unmounted volume still holds every byte).
      // Holds for a transcript-less directory too: its project is dead, which
      // is the truer label.
      trees.set(project.dirName, 'dead-projects')
    } else if (
      project.sessions.length === 0 &&
      project.location === 'unlocated' &&
      !project.hasMemory
    ) {
      // No transcript, no memory, and no path kondo can find: nothing was
      // ever recorded against it and nothing stands behind it. The other
      // transcript-less directories are offered nowhere (entry 058): one
      // holding `memory/` is Claude's own record of a project it worked with
      // — the owner's store had live projects whose only trace here was
      // memory — and an unlocated name is not evidence of anything
      // (ADR-0009). A project that is on disk is never litter by emptiness.
      if (await inactiveScratch(project.absPath, root, nowMs, c)) trees.set(project.dirName, 'scratch-projects')
      else withheld.add(project.dirName)
    }
  }

  const orphans: string[] = []
  for (const project of inventory.projects) {
    // Skipped whole: every path inside a claimed directory is already
    // covered by the one step that moves the directory.
    if (trees.has(project.dirName) || withheld.has(project.dirName)) continue
    for (const session of project.sessions) {
      // The sidecar rides with its transcript. Leaving it behind would only
      // make it tomorrow's orphan, and it is state for a session that is
      // going anyway.
      const paths = [relativeTo(root, session.file)]
      if (session.sidecar !== null) {
        paths.push(relativeTo(root, path.join(project.absPath, session.sidecar)))
      }
      // So does the desktop app's released marker: a marker for a transcript
      // that has gone is the next scan's orphan.
      if (session.released !== null) {
        paths.push(relativeTo(root, path.join(project.absPath, session.released)))
      }
      const item: Candidate = { paths, display: tildify(session.file, locator.home) }
      // A zero-byte transcript is empty whatever its age, so that category
      // claims it — no path is ever queued under two categories, which is
      // what would make the second trash step of a pair fail. A released one
      // is claimed by what the desktop app said about it before its age is
      // asked; the most specific description wins.
      if (session.bytes === 0) candidates['empty-transcripts'].push(item)
      else if (session.released !== null) candidates['desktop-released-sessions'].push(item)
      else if (isStale(session.mtimeMs, nowMs)) candidates['stale-sessions'].push(item)
    }
    for (const name of project.orphanDirs) orphans.push(path.join(project.absPath, name))
    for (const name of project.orphanMarkers) {
      // A marker with no transcript is an orphan like a sidecar directory is.
      const absPath = path.join(project.absPath, name)
      candidates['orphan-sidecars'].push({
        paths: [relativeTo(root, absPath)],
        display: tildify(absPath, locator.home)
      })
    }
  }

  candidates['orphan-sidecars'].push(
    ...orphans.map((absPath) => ({
      paths: [relativeTo(root, absPath)],
      display: tildify(absPath, locator.home)
    }))
  )

  // A project directory is offered whole, as one path — one trash step over
  // the tree is what makes the undo put it back in one (ADR-0001 decision 2).
  for (const project of inventory.projects) {
    const category = trees.get(project.dirName)
    if (category === undefined) continue
    candidates[category].push({
      paths: [relativeTo(root, project.absPath)],
      display: tildify(project.absPath, locator.home)
    })
  }

  const rootDisplay = tildify(root, locator.home)
  const present = new Set(
    (await safeReaddir(root, rootDisplay, c, locator.userRoot))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  )
  for (const name of RECLAIMABLE) {
    if (!present.has(name)) continue
    const display = `${rootDisplay}/${name}`
    // An empty cache directory reclaims nothing, and moving one would be
    // journal noise for a directory Claude recreates on its next run. Sized
    // for that test alone; the preview's figure comes from the trash steps.
    if (await directorySize(path.join(root, name), display, c, locator.userRoot) > 0) {
      candidates['reclaimable-caches'].push({ paths: [name], display })
    }
  }

  await scanSessionEnv(locator, inventory, candidates, c)
  await scanPluginResidue(locator, candidates, c)
  await scanDesktopCaches(locator, candidates, c)

  // Settings omit execution sources and scripts may invoke helpers. Even an
  // empty hooks object cannot establish disuse, so this category stays empty.
  const blocked: TidyBlocks = {
    'unarmed-hook-scripts': 'Hook scripts are kept: Kondo cannot establish that they are unused. Some hook sources and command forms are not checked, and scripts may call other scripts.'
  }
  const busy = candidates['desktop-caches'].length > 0 ? await desktopAppBusy(locator, c) : null
  if (busy !== null) blocked['desktop-caches'] = busy
  return { candidates, blocked, withheldScratchCount: withheld.size }
}

/** No recent entry anywhere in a scratch tree; inability to check is not disuse. */
async function inactiveScratch(target: string, root: string, nowMs: number, c: Collector): Promise<boolean> {
  try {
    for (const entry of await inspectTree(target, root)) {
      const info = await fs.stat(await resolveAllowedPath(path.join(target, entry.relative), root))
      if (!isStale(info.mtimeMs, nowMs)) return false
    }
    return true
  } catch {
    c.fail('read-failed', 'scratch-projects', 'A scratch folder could not be checked for recent activity; it was withheld.')
    return false
  }
}

/**
 * `session-env/<uuid>/` snapshots with no transcript behind them. Nothing
 * prunes this directory — the observed store held 5,213 of them against
 * 11,686 transcripts (domain.md) — and the uuid alone decides each one, so
 * no snapshot is opened to classify it (ADR-0007).
 *
 * A snapshot whose transcript is still there is never offered, including one
 * whose transcript this very sweep is about to trash: candidates come from
 * one scan, so a session and its snapshot leave in separate sweeps rather
 * than in a pair of steps that could half-fail.
 */
async function scanSessionEnv(
  locator: StoreLocator,
  inventory: SessionInventory,
  candidates: TidyCandidates,
  c: Collector
): Promise<void> {
  const transcripts = new Set<string>()
  for (const project of inventory.projects) {
    for (const session of project.sessions) transcripts.add(session.uuid.toLowerCase())
  }

  const root = path.join(locator.userRoot, SESSION_ENV)
  const rootDisplay = tildify(root, locator.home)
  const orphans = (await safeReaddir(root, rootDisplay, c, locator.userRoot)).filter(
    (entry) =>
      entry.isDirectory() &&
      SESSION_UUID.test(entry.name) &&
      !transcripts.has(entry.name.toLowerCase())
  )

  candidates['orphan-session-env'] = orphans.map((entry) => ({
    paths: [`${SESSION_ENV}/${entry.name}`],
    display: `${rootDisplay}/${entry.name}`
  }))
}

/**
 * What `plugins/` keeps after an upgrade or an uninstall. Two categories out
 * of one manifest read, and they cannot overlap: superseded versions live
 * under `plugins/cache/`, residue under `plugins/data/` and
 * `plugins/.install-manifests/`.
 *
 * `installed_plugins.json` is the only authority here. When it cannot be
 * read or parsed, nothing is offered at all (ADR-0005): treating an
 * unreadable manifest as "nothing is installed" would offer every plugin the
 * user has, live code included.
 */
async function scanPluginResidue(
  locator: StoreLocator,
  candidates: TidyCandidates,
  c: Collector
): Promise<void> {
  const installed = await readInstalledPlugins(locator, c)
  if (installed === null) return

  const root = path.join(locator.userRoot, PLUGINS_DIR)
  const rootRelative = PLUGINS_DIR
  const rootDisplay = tildify(root, locator.home)

  const residue = (relative: string): Candidate => ({
    paths: [`${rootRelative}/${relative}`],
    display: `${rootDisplay}/${relative}`
  })

  // Every cached version except those any installation scope still names.
  // A directory is offered only after all declared install paths have been
  // checked, because different scopes can retain different live versions.
  for (const key of installed.keys) {
    const at = key.lastIndexOf('@')
    if (at <= 0) continue
    const relative = `${PLUGIN_CACHE_DIR}/${key.slice(at + 1)}/${key.slice(0, at)}`
    const versionsDir = path.join(root, ...relative.split('/'))
    const versions = await safeReaddir(versionsDir, `${rootDisplay}/${relative}`, c, locator.userRoot)
    for (const version of versions) {
      if (!version.isDirectory()) continue
      const absPath = path.join(versionsDir, version.name)
      if (installed.installPaths.has(installKey(absPath))) continue
      candidates['superseded-plugin-versions'].push(residue(`${relative}/${version.name}`))
    }
  }

  // `plugins/data/<plugin>-<marketplace>/` — the id spelled with a dash
  // (domain.md). Derived forwards, from each declared id, because reading a
  // directory name backwards into an id is ambiguous the moment either half
  // holds a dash.
  const slugs = new Set([...installed.keys].map((key) => key.replaceAll('@', '-')))
  const dataDir = path.join(root, PLUGIN_DATA_DIR)
  const data = await safeReaddir(dataDir, `${rootDisplay}/${PLUGIN_DATA_DIR}`, c, locator.userRoot)
  for (const entry of data) {
    if (!entry.isDirectory() || slugs.has(entry.name)) continue
    candidates['orphan-plugin-residue'].push(residue(`${PLUGIN_DATA_DIR}/${entry.name}`))
  }

  // `plugins/.install-manifests/<id>.json` — the id verbatim, so no guessing.
  const manifestDir = path.join(root, PLUGIN_MANIFEST_DIR)
  const manifests = await safeReaddir(
    manifestDir,
    `${rootDisplay}/${PLUGIN_MANIFEST_DIR}`,
    c,
    locator.userRoot
  )
  for (const entry of manifests) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    if (installed.keys.has(entry.name.slice(0, -'.json'.length))) continue
    candidates['orphan-plugin-residue'].push(residue(`${PLUGIN_MANIFEST_DIR}/${entry.name}`))
  }
}

/**
 * The dry run itself: counts and bytes per category, and nothing moved.
 *
 * Each figure is measured over the very trash steps `tidyPlan` would build
 * for that category alone — the same steps `tidyPreview` snapshots under the
 * review token — so a session's sidecar directory and released marker are
 * counted with its transcript, and a sweep grows the trash by exactly the
 * number the row showed.
 *
 * One `counted` set runs through every category in order, so a path can only
 * ever land in one figure. The candidate scan already queues a path under a
 * single category; this makes summing a multi-category selection safe even
 * if that ever stopped being true.
 */
export async function toTidyPreview(
  candidates: TidyCandidates,
  rootOf: (store: string) => string | null,
  trashBytesBefore: number,
  c: Collector,
  blocked: TidyBlocks = {},
  withheldScratchCount = 0
): Promise<TidyPreview> {
  const counted = new Set<string>()
  const fail = (at: string, cause: unknown): void => c.fail('read-failed', at, cause)
  let complete = true
  const categories: TidyCategoryPreview[] = []
  for (const category of tidyCategories) {
    const items = candidates[category]
    const measured = await reviewedBytes(tidyPlan(candidates, [category]), rootOf, counted, fail)
    complete &&= measured.complete
    categories.push({
      category,
      count: items.length,
      bytes: measured.bytes,
      examples: items.slice(0, EXAMPLES).map((item) => item.display),
      blocked: blocked[category] ?? null
    })
  }
  const totalBytes = categories.reduce((sum, entry) => sum + entry.bytes, 0)
  return {
    reviewToken: null,
    withheldScratchCount,
    categories,
    totalCount: categories.reduce((sum, entry) => sum + entry.count, 0),
    totalBytes,
    estimate: {
      movingBytes: totalBytes,
      trashBytesBefore,
      trashBytesAfter: trashBytesBefore + totalBytes,
      freedOnEmptyBytes: trashBytesBefore + totalBytes,
      incomplete: !complete
    },
    staleAfterDays: STALE_AFTER_DAYS
  }
}

/**
 * How each category reads in the History row this sweep writes. Both forms
 * spelled out — "cache directorys" is not a plural — and both in the UI
 * column of docs/glossary.md, because this string is read on screen by
 * someone who has never heard of a sidecar or an orphan.
 */
const LABEL: Record<TidyCategory, readonly [one: string, many: string]> = {
  'scratch-projects': ['throwaway project folder', 'throwaway project folders'],
  'dead-projects': ['deleted project', 'deleted projects'],
  'stale-sessions': ['untouched session', 'untouched sessions'],
  'empty-transcripts': ['empty transcript', 'empty transcripts'],
  'desktop-released-sessions': [
    'conversation with a desktop released marker',
    'conversations with a desktop released marker'
  ],
  'orphan-sidecars': ['leftover session folder', 'leftover session folders'],
  'orphan-session-env': ['leftover session snapshot', 'leftover session snapshots'],
  'reclaimable-caches': ['cache directory', 'cache directories'],
  'desktop-caches': ['desktop app cache', 'desktop app caches'],
  'superseded-plugin-versions': ['superseded plugin version', 'superseded plugin versions'],
  'orphan-plugin-residue': ['leftover plugin file', 'leftover plugin files'],
  'unarmed-hook-scripts': ['kept hook script', 'kept hook scripts']
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
      item.paths.map((from) => ({ type: 'trash' as const, store: item.store ?? 'user', from }))
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
    summary: `Clean up: ${parts.join(', ')} into kondo's trash`,
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
