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
  type ExistsFn
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
/** Non-session entries that are normal inside a project directory. */
const KNOWN_PROJECT_ENTRIES = new Set(['memory'])

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

const defaultExists: ExistsFn = async (target) => {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
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

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (UUID_DIR.test(entry.name)) {
        sidecars.set(entry.name.toLowerCase(), entry.name)
        orphanCandidates.push(entry.name)
      } else if (!KNOWN_PROJECT_ENTRIES.has(entry.name)) {
        c.unknown.push(`${display}/${entry.name}`)
      }
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
      sidecar: null
    })
  }

  const transcriptUuids = new Set(sessions.map((session) => session.uuid))
  for (const session of sessions) session.sidecar = sidecars.get(session.uuid) ?? null
  const orphanDirs = orphanCandidates.filter(
    (name) => !transcriptUuids.has(name.toLowerCase())
  )

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return {
    dirName,
    absPath,
    ...(await locate(dirName, home, platform, exists, registered, c)),
    sessions,
    orphanDirs
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
  const pathExists = await exists(absPath)
  return {
    dirName,
    absPath: path.join(root, dirName),
    guessedPath: absPath,
    sessions: [],
    orphanDirs: [],
    sources: ['registry'],
    // The registry named it, so a failed stat is evidence and not ignorance.
    location: pathExists ? 'here' : 'gone',
    hasStore: pathExists && (await hasClaudeDir(absPath, home, c))
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
  // A registry key that fails its stat is `gone`; a guess that never verified
  // is `unlocated`, which says nothing about whether the project still exists.
  const location: ProjectLocation =
    known !== null
      ? (await exists(known))
        ? 'here'
        : 'gone'
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

export function toSessionSummaries(
  project: ProjectRecord,
  nowMs: number
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
    hasSidecar: session.sidecar !== null
  }))
}
