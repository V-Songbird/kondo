import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ProjectLocation,
  ProjectSource,
  Scan,
  SessionProject,
  SessionSummary
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import {
  collector,
  finish,
  isEnoent,
  mapPool,
  safeReaddir,
  safeReadJson,
  safeStat,
  type Collector
} from './scan'
import {
  guessOriginalPath,
  projectIndex,
  registeredProjectPaths,
  type ExistsFn,
  type Presence
} from './projects'
import { capabilitiesFor } from './capabilities'
import { isStale } from './analysis'
import { tildify } from './display'

/**
 * Tier-1 session inventory (ADR-0007): readdir + stat only, no transcript
 * contents. The inventory is the workspace's shared source for the
 * dashboard, the sessions views, and later analysis.
 */

const TRANSCRIPT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const UUID_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * The desktop app's marker beside a transcript it has released (domain.md):
 * `<uuid>.desktop-released.json`, 78 bytes of `{ v, releasedAt, reason }`.
 */
const RELEASED =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.desktop-released\.json$/i
/**
 * Non-session entries that are normal inside a project directory: Claude's
 * memory, and the benchmark runs `claude plugin eval` writes (domain.md).
 */
const MEMORY_DIR = 'memory'
const KNOWN_PROJECT_ENTRIES = new Set([MEMORY_DIR, '.benchmarks'])

export interface SessionRecord {
  uuid: string
  file: string
  bytes: number
  mtimeMs: number
  /**
   * The sibling directory's real name on disk, or null when there is none.
   * The name and not a flag, because the sweep has to displace that exact
   * directory and the match that found it is case-insensitive.
   */
  sidecar: string | null
  /**
   * The desktop app's `<uuid>.desktop-released.json` marker, by its real
   * name, or null. Its presence says the desktop app has released — on the
   * observed store, deleted — this conversation while the transcript stayed.
   */
  released: string | null
}

export interface ProjectRecord {
  dirName: string
  /** The `~/.claude/projects/<dirName>` directory — never the project itself. */
  absPath: string
  /**
   * The project's real directory: the registry's key when it has one
   * (ADR-0009), otherwise the un-flattening guess, kept only when it
   * verified. Null when neither names a path.
   */
  guessedPath: string | null
  sessions: SessionRecord[]
  orphanDirs: string[]
  /** Released markers whose transcript is already gone, by file name. */
  orphanMarkers: string[]
  /**
   * The directory holds a `memory/` — Claude's persistent memory for the
   * project. Evidence that Claude worked with the project even when no
   * transcript is here, which is why a transcript-less directory with memory
   * is never called scratch (entry 058).
   */
  hasMemory: boolean
  /** Which of the two halves of the union named it; never empty. */
  sources: ProjectSource[]
  /**
   * Whether `guessedPath` is on disk, is gone, or was never resolved at all.
   * Only `gone` is evidence of deletion — see `ProjectLocation`.
   */
  location: ProjectLocation
  /** It has a `.claude` directory, so it is a store kondo can write into. */
  hasStore: boolean
}

export interface SessionInventory {
  projects: ProjectRecord[]
  byDirName: Map<string, ProjectRecord>
}

/**
 * Only ENOENT says a path is not there. Every other errno — a permission
 * kondo does not have, a volume no longer mounted, an I/O error — says
 * kondo could not look, which is a different answer and must not be read as
 * deletion (ADR-0005). `safeStat` in scan.ts splits them the same way.
 */
const defaultExists: ExistsFn = async (target) => {
  try {
    await fs.stat(target)
    return 'present'
  } catch (cause) {
    return isEnoent(cause) ? 'absent' : 'unreadable'
  }
}

/** The location a probed registry path implies, and the error it owes. */
function locationOf(presence: Presence, display: string, c: Collector): ProjectLocation {
  if (presence === 'present') return 'here'
  if (presence === 'absent') return 'gone'
  c.fail('stat-failed', display, new Error('the path could not be read'))
  return 'unreadable'
}

export async function scanSessionInventory(
  locator: StoreLocator,
  platform: NodeJS.Platform,
  exists: ExistsFn = defaultExists
): Promise<Scan<SessionInventory>> {
  const c = collector()
  const root = path.join(locator.userRoot, 'projects')
  const rootDisplay = tildify(root, locator.home)

  const entries = await safeReaddir(root, rootDisplay, c)
  const projectDirs = entries.filter((entry) => entry.isDirectory())

  // Claude's own reverse map (ADR-0009): one parse, and only the keys of
  // `projects` are kept — the per-project entries carry prompts and cost
  // figures kondo has no business surfacing.
  const config = await safeReadJson(
    locator.userConfigFile,
    tildify(locator.userConfigFile, locator.home),
    c
  )
  const registered = projectIndex(registeredProjectPaths(config))

  // The project set is the union of the two halves (domain.md), joined on the
  // flattened path: a directory here means Claude kept transcripts, a registry
  // key means Claude knows the path. A key with no transcripts is a project
  // that has simply not been worked in yet — an omission, not a non-project.
  const onDisk = new Set(projectDirs.map((dir) => dir.name))
  const registryOnly = [...registered.keys()].filter((flat) => !onDisk.has(flat))

  const projects = [
    ...(await mapPool(projectDirs, 16, async (dir) =>
      scanProject(root, dir.name, rootDisplay, locator.home, platform, exists, registered, c)
    )),
    ...(await mapPool(registryOnly, 16, async (flat) =>
      registryProject(root, flat, registered.get(flat) as string, locator.home, exists, c)
    ))
  ]

  projects.sort((a, b) => a.dirName.localeCompare(b.dirName))
  const byDirName = new Map(projects.map((project) => [project.dirName, project]))
  return finish({ projects, byDirName }, c)
}

async function scanProject(
  root: string,
  dirName: string,
  rootDisplay: string,
  home: string,
  platform: NodeJS.Platform,
  exists: ExistsFn,
  registered: ReadonlyMap<string, string>,
  c: Collector
): Promise<ProjectRecord> {
  const absPath = path.join(root, dirName)
  const display = `${rootDisplay}/${dirName}`
  const entries = await safeReaddir(absPath, display, c)

  const sessions: SessionRecord[] = []
  const sidecars = new Map<string, string>()
  const orphanCandidates: string[] = []
  const markers = new Map<string, string>()
  let hasMemory = false

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (UUID_DIR.test(entry.name)) {
        sidecars.set(entry.name.toLowerCase(), entry.name)
        orphanCandidates.push(entry.name)
      } else if (entry.name === MEMORY_DIR) {
        hasMemory = true
      } else if (!KNOWN_PROJECT_ENTRIES.has(entry.name)) {
        c.unknown.push(`${display}/${entry.name}`)
      }
      continue
    }
    const released = RELEASED.exec(entry.name)
    if (released && released[1] !== undefined) {
      markers.set(released[1].toLowerCase(), entry.name)
      continue
    }
    const match = TRANSCRIPT.exec(entry.name)
    if (!match || match[1] === undefined) {
      c.unknown.push(`${display}/${entry.name}`)
      continue
    }
    const file = path.join(absPath, entry.name)
    const info = await safeStat(file, `${display}/${entry.name}`, c)
    if (!info) continue
    sessions.push({
      uuid: match[1].toLowerCase(),
      file,
      bytes: info.size,
      mtimeMs: info.mtimeMs,
      sidecar: null,
      released: null
    })
  }

  const transcriptUuids = new Set(sessions.map((session) => session.uuid))
  for (const session of sessions) {
    session.sidecar = sidecars.get(session.uuid) ?? null
    session.released = markers.get(session.uuid) ?? null
  }
  const orphanDirs = orphanCandidates.filter(
    (name) => !transcriptUuids.has(name.toLowerCase())
  )
  const orphanMarkers = [...markers.entries()]
    .filter(([uuid]) => !transcriptUuids.has(uuid))
    .map(([, name]) => name)

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return {
    dirName,
    absPath,
    ...(await locate(dirName, home, platform, exists, registered, c)),
    sessions,
    orphanDirs,
    orphanMarkers,
    hasMemory
  }
}

/**
 * A project the registry names and `projects/` does not: no transcripts, no
 * orphans, and no directory under the user store to read. Its record exists so
 * a listing can still show it, say where it is, and — when it has a `.claude`
 * — offer it as a destination.
 */
async function registryProject(
  root: string,
  dirName: string,
  absPath: string,
  home: string,
  exists: ExistsFn,
  c: Collector
): Promise<ProjectRecord> {
  const presence = await exists(absPath)
  // The registry named it, so an ENOENT is evidence. Any other errno is not:
  // kondo could not look, and saying `gone` would offer a mounted-elsewhere
  // project up for trashing.
  const location = locationOf(presence, tildify(absPath, home), c)
  return {
    dirName,
    absPath: path.join(root, dirName),
    guessedPath: absPath,
    sessions: [],
    orphanDirs: [],
    orphanMarkers: [],
    hasMemory: false,
    sources: ['registry'],
    location,
    hasStore: location === 'here' && (await hasClaudeDir(absPath, home, c))
  }
}

/** Where a project really is, whether it is still there, and whether it is a store. */
async function locate(
  dirName: string,
  home: string,
  platform: NodeJS.Platform,
  exists: ExistsFn,
  registered: ReadonlyMap<string, string>,
  c: Collector
): Promise<Pick<ProjectRecord, 'guessedPath' | 'sources' | 'location' | 'hasStore'>> {
  // The registry's key IS the path (ADR-0009), so it is kept even when the
  // stat says the directory is gone — that is the dead-project signal, and a
  // name the UI can show. The un-flattening guess only proposes a path, so it
  // survives solely when it verified.
  const known = registered.get(dirName) ?? null
  const guessedPath = known ?? (await guessOriginalPath(dirName, platform, exists))
  // A registry key that stats ENOENT is `gone`, and one that fails any other
  // way is `unreadable`; a guess that never verified is `unlocated`, which
  // says nothing about whether the project still exists.
  const location: ProjectLocation =
    known !== null
      ? locationOf(await exists(known), tildify(known, home), c)
      : guessedPath !== null
        ? 'here'
        : 'unlocated'
  return {
    guessedPath,
    sources: known === null ? ['transcripts'] : ['registry', 'transcripts'],
    location,
    hasStore:
      location === 'here' &&
      guessedPath !== null &&
      (await hasClaudeDir(guessedPath, home, c))
  }
}

/**
 * ADR-0002 allows exactly this much of a project: a stat on its `.claude`,
 * never a listing of anything above it. A missing one is not an error — it is
 * a project kondo has nothing to write into.
 */
async function hasClaudeDir(absPath: string, home: string, c: Collector): Promise<boolean> {
  const dir = path.join(absPath, '.claude')
  return (await safeStat(dir, tildify(dir, home), c))?.isDirectory() === true
}

// ---------------------------------------------------------------------------
// Contract projections

export function projectId(dirName: string): string {
  return `project:code:${dirName}`
}

export function sessionId(dirName: string, uuid: string): string {
  return `session:code:${dirName}/${uuid}`
}

export function toSessionProjects(
  inventory: SessionInventory,
  nowMs: number
): SessionProject[] {
  const capabilities = capabilitiesFor('project', 'code')
  return inventory.projects.map((project) => ({
    id: projectId(project.dirName),
    kind: 'project' as const,
    capabilities,
    dirName: project.dirName,
    guessedPath: project.guessedPath,
    sources: project.sources,
    location: project.location,
    hasStore: project.hasStore,
    sessionCount: project.sessions.length,
    transcriptBytes: project.sessions.reduce((sum, s) => sum + s.bytes, 0),
    lastActivityMs: project.sessions.reduce((max, s) => Math.max(max, s.mtimeMs), 0),
    staleCount: project.sessions.filter((s) => isStale(s.mtimeMs, nowMs)).length,
    orphanCount: project.orphanDirs.length
  }))
}

/**
 * `mirrored` is the desktop store's session ids (`desktopSessionStems`). The
 * join is on the uuid alone, because a session id is the same UUID in every
 * store that holds it (domain.md) — two listings, no transcript opened.
 */
export function toSessionSummaries(
  project: ProjectRecord,
  nowMs: number,
  mirrored: ReadonlySet<string> = new Set()
): SessionSummary[] {
  const capabilities = capabilitiesFor('session', 'code')
  return project.sessions.map((session) => ({
    id: sessionId(project.dirName, session.uuid),
    kind: 'session' as const,
    capabilities,
    uuid: session.uuid,
    projectId: projectId(project.dirName),
    bytes: session.bytes,
    mtimeMs: session.mtimeMs,
    stale: isStale(session.mtimeMs, nowMs),
    hasSidecar: session.sidecar !== null,
    releasedByDesktop: session.released !== null,
    mirroredIn: mirrored.has(session.uuid) ? 'desktop' : null
  }))
}
