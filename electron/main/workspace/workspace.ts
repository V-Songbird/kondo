import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  JournalEntryInfo,
  KondoApi,
  Scan,
  ScanError,
  SessionDetail,
  StoresOverview,
  ToggleOperation
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, describe, finish, mapPool, type Collector } from './scan'
import {
  createKindContext,
  kinds,
  pluginTogglePlan,
  skillMovePlan,
  type KindContext
} from './kinds'
import {
  scanSessionInventory,
  type ProjectRecord,
  type SessionInventory
} from './sessions'
import { userStoreReport, type VerifiedProject } from './user-store'
import { desktopStoreReport } from './desktop-store'
import { isStale } from './analysis'
import { createMutations } from './mutations'

/**
 * The workspace: the server side of KondoApi. Owns the cached session
 * inventory (ADR-0007) and resolves every renderer-supplied id against it
 * (ADR-0008) — no channel accepts a path.
 *
 * Entities are reached through the kind registry (`kinds.ts`), never by
 * naming an adapter here: a method validates the id shape it accepts, hands
 * the rest to a kind, and wraps the result in the scan envelope. The two
 * store *reports* below are the exception — a store is not an entity.
 */

export interface WorkspaceOptions {
  locator: StoreLocator
  platform: NodeJS.Platform
  now?: () => number
  /** Existence probe used for original-path guessing; injectable for tests. */
  guessExists?: (target: string) => Promise<boolean>
}

/** The store-name prefix a project's `.claude` root answers to (ADR-0008). */
const PROJECT_STORE = 'project:'

interface InventoryState {
  scan: Scan<SessionInventory>
  verified: VerifiedProject[]
}

export function createWorkspace(options: WorkspaceOptions): KondoApi {
  const { locator, platform } = options
  const now = options.now ?? Date.now

  let inventoryState: Promise<InventoryState> | null = null

  // The write path (ADR-0001). `user` and `desktop` come from the locator;
  // a project store is resolved here, because only the workspace knows which
  // projects verified — and it resolves to the project's `.claude` directory,
  // never the project itself (ADR-0002).
  const mutations = createMutations(locator, now, async (store) => {
    if (!store.startsWith(PROJECT_STORE)) return null
    const dirName = store.slice(PROJECT_STORE.length)
    const project = (await inventory()).verified.find(
      (candidate) => candidate.dirName === dirName
    )
    return project ? path.join(project.absPath, '.claude') : null
  })

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

  /**
   * One context per call: the kinds share this call's collector and read the
   * inventory through the same cache the workspace already holds.
   */
  const context = (c: Collector, parentId?: string): KindContext =>
    createKindContext({
      locator,
      c,
      now: now(),
      inventory: async () => (await inventory()).scan.data,
      projects: async () => (await inventory()).verified,
      parentId
    })

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
        data: (await kinds.project.discover(context(collector()))) ?? [],
        errors: scan.errors,
        unknown: scan.unknown
      }
    },

    async sessionList(projectId: string) {
      if (typeof projectId !== 'string' || !projectId.startsWith('project:code:')) {
        return badRequest([], 'sessionList expects a project:code: id.')
      }
      const c = collector()
      const sessions = await kinds.session.discover(context(c, projectId))
      if (!sessions) return unknownId([], projectId)
      return finish(sessions, c)
    },

    async sessionDetail(sessionId: string): Promise<Scan<SessionDetail | null>> {
      if (typeof sessionId !== 'string' || !sessionId.startsWith('session:code:')) {
        return badRequest(null, 'sessionDetail expects a session:code: id.')
      }
      const key = sessionId.slice('session:code:'.length)
      if (key.lastIndexOf('/') <= 0) return badRequest(null, 'Malformed session id.')

      const c = collector()
      try {
        const detail = await kinds.session.read(sessionId, context(c))
        if (!detail) return unknownId(null, sessionId)
        return finish(detail, c)
      } catch (cause) {
        c.errors.push({ code: 'read-failed', path: sessionId, message: describe(cause) })
        return finish(null, c)
      }
    },

    async desktopSessions() {
      const c = collector()
      return finish((await kinds.desktopSession.discover(context(c))) ?? [], c)
    },

    async skillsList() {
      const c = collector()
      return finish((await kinds.skill.discover(context(c))) ?? [], c)
    },

    async skillToggle(
      skillId: string,
      operation: ToggleOperation
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof skillId !== 'string' || !skillId.startsWith('skill:')) {
        return badRequest(null, 'skillToggle expects a skill: id.')
      }
      if (operation !== 'enable' && operation !== 'disable') {
        return badRequest(null, 'skillToggle expects enable or disable.')
      }
      const c = collector()
      const entity = await kinds.skill.read(skillId, context(c))
      if (!entity) return unknownId(null, skillId)

      const plan =
        operation === 'enable' ? kinds.skill.enable(entity) : kinds.skill.disable(entity)
      if (!plan) {
        // The matrix refused, not the UI — its reason is the whole answer.
        c.errors.push({
          code: 'not-permitted',
          path: skillId,
          message:
            entity.capabilities[operation].reason ?? `kondo cannot ${operation} this skill.`
        })
        return finish(null, c)
      }
      return mutations.mutate(plan)
    },

    async skillMove(
      skillId: string,
      destinationId: string
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof skillId !== 'string' || !skillId.startsWith('skill:')) {
        return badRequest(null, 'skillMove expects a skill: id.')
      }
      if (typeof destinationId !== 'string' || destinationId === '') {
        return badRequest(null, 'skillMove expects a destination scope id.')
      }
      const c = collector()
      const shared = context(c)
      // One listing, used twice: the skill being moved and the destination's
      // own skills the collision check reads come from the same scan.
      const all = (await kinds.skill.discover(shared)) ?? []
      const entity = all.find((candidate) => candidate.id === skillId)
      if (!entity) return unknownId(null, skillId)

      const planned = await skillMovePlan({ entity, destinationId, all }, shared)
      if (!planned.ok) {
        // The matrix refused, not the UI — its reason is the whole answer.
        c.errors.push({ code: planned.code, path: skillId, message: planned.message })
        return finish(null, c)
      }
      return mutations.mutate(planned.plan)
    },

    async pluginsList() {
      const c = collector()
      return finish((await kinds.plugin.discover(context(c))) ?? [], c)
    },

    async pluginToggle(
      pluginId: string,
      layerId: string,
      operation: ToggleOperation,
      createLayer?: boolean
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof pluginId !== 'string' || !pluginId.startsWith('plugin:')) {
        return badRequest(null, 'pluginToggle expects a plugin: id.')
      }
      if (typeof layerId !== 'string' || !layerId.startsWith('settings:')) {
        return badRequest(null, 'pluginToggle expects a settings: layer id.')
      }
      if (operation !== 'enable' && operation !== 'disable') {
        return badRequest(null, 'pluginToggle expects enable or disable.')
      }
      const c = collector()
      // One context, so the plugin manifest and the settings layers are read
      // once and the plan sees exactly the bytes the entity was built from.
      const shared = context(c)
      const entity = await kinds.plugin.read(pluginId, shared)
      if (!entity) return unknownId(null, pluginId)

      const planned = await pluginTogglePlan(
        { entity, layerId, operation, createLayer: createLayer === true },
        shared
      )
      if (!planned.ok) {
        c.errors.push({ code: planned.code, path: layerId, message: planned.message })
        return finish(null, c)
      }
      return mutations.mutate(planned.plan)
    },

    async hooksList() {
      const c = collector()
      return finish((await kinds.hook.discover(context(c))) ?? [], c)
    },

    async settingsLayers() {
      const c = collector()
      return finish((await kinds.settings.discover(context(c))) ?? [], c)
    },

    journalList() {
      return mutations.list()
    },

    journalUndo(journalId: string) {
      if (typeof journalId !== 'string' || !journalId.startsWith('journal:')) {
        return Promise.resolve(badRequest(null, 'journalUndo expects a journal: id.'))
      }
      return mutations.undo(journalId)
    },

    trashSize() {
      return mutations.trashSize()
    }
  }
}
