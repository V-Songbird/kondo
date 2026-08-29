import fs from 'node:fs/promises'
import path from 'node:path'
import type { Scan, SessionProject, SessionSummary } from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, finish, mapPool, safeReaddir, safeStat, type Collector } from './scan'
import { guessOriginalPath, type ExistsFn } from './projects'
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
  hasSidecar: boolean
}

export interface ProjectRecord {
  dirName: string
  absPath: string
  guessedPath: string | null
  sessions: SessionRecord[]
  orphanDirs: string[]
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

  const projects = await mapPool(projectDirs, 16, async (dir) =>
    scanProject(root, dir.name, rootDisplay, platform, exists, c)
  )

  projects.sort((a, b) => a.dirName.localeCompare(b.dirName))
  const byDirName = new Map(projects.map((project) => [project.dirName, project]))
  return finish({ projects, byDirName }, c)
}

async function scanProject(
  root: string,
  dirName: string,
  rootDisplay: string,
  platform: NodeJS.Platform,
  exists: ExistsFn,
  c: Collector
): Promise<ProjectRecord> {
  const absPath = path.join(root, dirName)
  const display = `${rootDisplay}/${dirName}`
  const entries = await safeReaddir(absPath, display, c)

  const sessions: SessionRecord[] = []
  const sidecars = new Set<string>()
  const orphanCandidates: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (UUID_DIR.test(entry.name)) {
        sidecars.add(entry.name.toLowerCase())
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
      hasSidecar: false
    })
  }

  const transcriptUuids = new Set(sessions.map((session) => session.uuid))
  for (const session of sessions) session.hasSidecar = sidecars.has(session.uuid)
  const orphanDirs = orphanCandidates.filter(
    (name) => !transcriptUuids.has(name.toLowerCase())
  )

  const guessedPath = await guessOriginalPath(dirName, platform, exists)
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { dirName, absPath, guessedPath, sessions, orphanDirs }
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
  return inventory.projects.map((project) => ({
    id: projectId(project.dirName),
    dirName: project.dirName,
    guessedPath: project.guessedPath,
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
  return project.sessions.map((session) => ({
    id: sessionId(project.dirName, session.uuid),
    uuid: session.uuid,
    projectId: projectId(project.dirName),
    bytes: session.bytes,
    mtimeMs: session.mtimeMs,
    stale: isStale(session.mtimeMs, nowMs),
    hasSidecar: session.hasSidecar
  }))
}
