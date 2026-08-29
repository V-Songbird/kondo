import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  KondoApi,
  Scan,
  ScanError,
  SessionDetail,
  StoresOverview
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, describe, finish, mapPool } from './scan'
import {
  scanSessionInventory,
  toSessionProjects,
  toSessionSummaries,
  type ProjectRecord,
  type SessionInventory
} from './sessions'
import {
  hooksFromLayers,
  readSettingsLayers,
  scanPlugins,
  scanSkills,
  userStoreReport,
  type VerifiedProject
} from './user-store'
import { desktopSessions, desktopStoreReport } from './desktop-store'
import { summarizeTranscript } from './jsonl'
import { isStale } from './analysis'

/**
 * The workspace: the server side of KondoApi. Owns the cached session
 * inventory (ADR-0007) and resolves every renderer-supplied id against it
 * (ADR-0008) — no channel accepts a path.
 */

export interface WorkspaceOptions {
  locator: StoreLocator
  platform: NodeJS.Platform
  now?: () => number
  /** Existence probe used for original-path guessing; injectable for tests. */
  guessExists?: (target: string) => Promise<boolean>
}

interface InventoryState {
  scan: Scan<SessionInventory>
  verified: VerifiedProject[]
}

export function createWorkspace(options: WorkspaceOptions): KondoApi {
  const { locator, platform } = options
  const now = options.now ?? Date.now

  let inventoryState: Promise<InventoryState> | null = null

  const inventory = (refresh = false): Promise<InventoryState> => {
    if (!inventoryState || refresh) {
      inventoryState = (async () => {
        const scan = await scanSessionInventory(locator, platform, options.guessExists)
        const verified = await verifyProjects(scan.data.projects)
        return { scan, verified }
      })()
    }
    return inventoryState
  }

  /** Projects whose reconstructed path exists AND has a .claude directory. */
  const verifyProjects = async (projects: ProjectRecord[]): Promise<VerifiedProject[]> => {
    const guessed = projects.filter(
      (project): project is ProjectRecord & { guessedPath: string } =>
        project.guessedPath !== null
    )
    const checked = await mapPool(guessed, 16, async (project) => {
      try {
        const info = await fs.stat(path.join(project.guessedPath, '.claude'))
        return info.isDirectory()
          ? { dirName: project.dirName, absPath: project.guessedPath }
          : null
      } catch {
        return null
      }
    })
    return checked.filter((project): project is VerifiedProject => project !== null)
  }

  const badRequest = <T>(data: T, message: string): Scan<T> => ({
    data,
    errors: [{ code: 'bad-request', path: '(request)', message }],
    unknown: []
  })

  const unknownId = <T>(data: T, id: string): Scan<T> => ({
    data,
    errors: [
      {
        code: 'unknown-id',
        path: id,
        message: 'Id not found in the current scan — rescan and retry.'
      }
    ],
    unknown: []
  })

  return {
    async storesOverview(): Promise<Scan<StoresOverview>> {
      const c = collector()
      const { scan } = await inventory()
      const projects = scan.data.projects
      const nowMs = now()

      let sessionCount = 0
      let staleCount = 0
      let transcriptBytes = 0
      for (const project of projects) {
        sessionCount += project.sessions.length
        transcriptBytes += project.sessions.reduce((sum, s) => sum + s.bytes, 0)
        staleCount += project.sessions.filter((s) => isStale(s.mtimeMs, nowMs)).length
      }

      const [user, desktop] = await Promise.all([
        userStoreReport(locator, transcriptBytes, c),
        desktopStoreReport(locator, c)
      ])
      const errors: ScanError[] = [...scan.errors, ...c.errors]
      return {
        data: {
          user,
          desktop,
          sessions: { projectCount: projects.length, sessionCount, staleCount, transcriptBytes }
        },
        errors,
        unknown: [...scan.unknown, ...c.unknown]
      }
    },

    async sessionProjects(refresh?: boolean) {
      const { scan } = await inventory(refresh === true)
      return {
        data: toSessionProjects(scan.data, now()),
        errors: scan.errors,
        unknown: scan.unknown
      }
    },

    async sessionList(projectId: string) {
      if (typeof projectId !== 'string' || !projectId.startsWith('project:code:')) {
        return badRequest([], 'sessionList expects a project:code: id.')
      }
      const dirName = projectId.slice('project:code:'.length)
      const { scan } = await inventory()
      const project = scan.data.byDirName.get(dirName)
      if (!project) return unknownId([], projectId)
      return finish(toSessionSummaries(project, now()), collector())
    },

    async sessionDetail(sessionId: string): Promise<Scan<SessionDetail | null>> {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('session:code:')) {
        return badRequest(null, 'sessionDetail expects a session:code: id.')
      }
      const key = sessionId.slice('session:code:'.length)
      const slash = key.lastIndexOf('/')
      if (slash <= 0) return badRequest(null, 'Malformed session id.')
      const dirName = key.slice(0, slash)
      const uuid = key.slice(slash + 1).toLowerCase()

      const { scan } = await inventory()
      const record = scan.data.byDirName
        .get(dirName)
        ?.sessions.find((session) => session.uuid === uuid)
      if (!record) return unknownId(null, sessionId)

      const c = collector()
      try {
        const summary = await summarizeTranscript(record.file)
        return finish({ id: sessionId, ...summary }, c)
      } catch (cause) {
        c.errors.push({ code: 'read-failed', path: sessionId, message: describe(cause) })
        return finish(null, c)
      }
    },

    async desktopSessions() {
      const c = collector()
      const sessions = await desktopSessions(locator, c)
      return finish(sessions, c)
    },

    async skillsList() {
      const c = collector()
      const { verified } = await inventory()
      const layers = await readSettingsLayers(locator, verified, c)
      const plugins = await scanPlugins(locator, layers, c)
      const skills = await scanSkills(locator, verified, plugins, c)
      return finish(skills, c)
    },

    async pluginsList() {
      const c = collector()
      const { verified } = await inventory()
      const layers = await readSettingsLayers(locator, verified, c)
      const plugins = await scanPlugins(locator, layers, c)
      return finish(
        plugins.map((plugin) => plugin.info),
        c
      )
    },

    async hooksList() {
      const c = collector()
      const { verified } = await inventory()
      const layers = await readSettingsLayers(locator, verified, c)
      return finish(hooksFromLayers(layers), c)
    },

    async settingsLayers() {
      const c = collector()
      const { verified } = await inventory()
      const layers = await readSettingsLayers(locator, verified, c)
      return finish(
        layers.map((layer) => layer.info),
        c
      )
    }
  }
}
