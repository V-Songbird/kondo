import path from 'node:path'
import type {
  ConfigOrphan,
  JournalEntryInfo,
  KondoApi,
  ProjectDetail,
  ProjectRow,
  ProjectRowCounts,
  Scan,
  ScanError,
  SessionDetail,
  StoresOverview,
  TidyCategory,
  TidyPreview,
  ToggleOperation
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, describe, finish, mapPool, type Collector } from './scan'
import {
  configOrphans,
  configOrphansPlan,
  createKindContext,
  kinds,
  pluginClearPlan,
  pluginTogglePlan,
  projectPluginStates,
  skillMovePlan,
  type KindContext
} from './kinds'
import {
  scanSessionInventory,
  type ProjectRecord,
  type SessionInventory
} from './sessions'
import { countStoreEntries, userStoreReport, type VerifiedProject } from './user-store'
import { desktopStoreReport } from './desktop-store'
import { tildify } from './display'
import { isStale } from './analysis'
import { createMutations } from './mutations'
import { readCategories, scanTidyCandidates, tidyPlan, toTidyPreview } from './tidy'

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

/** The id prefix every project in the session store answers to (ADR-0008). */
const PROJECT_ID_PREFIX = 'project:code:'

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
        return { scan, verified: verifyProjects(scan.data.projects) }
      })()
    }
    return inventoryState
  }

  /**
   * ADR-0006: the store is the state. A sweep — or the undo of one — changes
   * the very tree the inventory was built from, so the cache is dropped and
   * the next read rescans instead of replaying what is no longer there.
   */
  const dropInventory = (): void => {
    inventoryState = null
  }

  /**
   * Projects that are stores: the path resolved and holds a `.claude`. The
   * inventory already stat'd for that (`hasStore`), so this is a filter over
   * what it found rather than a second pass over the same directories.
   */
  const verifyProjects = (projects: ProjectRecord[]): VerifiedProject[] =>
    projects
      .filter((project) => project.hasStore && project.guessedPath !== null)
      .map((project) => ({
        dirName: project.dirName,
        absPath: project.guessedPath as string
      }))

  /**
   * One context per call: the kinds share this call's collector and read the
   * inventory through the same cache the workspace already holds.
   *
   * `only` narrows the project list every scanner takes as a parameter, so a
   * project page reads the user store and that one project's `.claude` and
   * nothing else (ADR-0007). Omitted, it is every verified project, as it was.
   */
  const context = (
    c: Collector,
    parentId?: string,
    only?: VerifiedProject[]
  ): KindContext =>
    createKindContext({
      locator,
      c,
      now: now(),
      inventory: async () => (await inventory()).scan.data,
      projects: only ? async () => only : async () => (await inventory()).verified,
      parentId
    })

  const badRequest = <T>(data: T, message: string): Scan<T> => ({
    data,
    errors: [{ code: 'bad-request', path: '(request)', message }],
    unknown: []
  })

  /**
   * The refusal message for a destination that names a project kondo knows
   * about but cannot write into, or null when the destination is fine as far
   * as this check goes.
   */
  const storelessDestination = async (destinationId: string): Promise<string | null> => {
    if (!destinationId.startsWith(PROJECT_ID_PREFIX)) return null
    const dirName = destinationId.slice(PROJECT_ID_PREFIX.length)
    const record = (await inventory()).scan.data.byDirName.get(dirName)
    if (!record || record.hasStore) return null
    const where = record.guessedPath ?? record.dirName
    return `${where} has no .claude directory; create ${path.join(where, '.claude')} before moving a skill there.`
  }

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

  // ---------------------------------------------------------------------
  // The projects home

  /** The id of the one row that is the user store rather than a project. */
  const GLOBAL_ROW = 'store:user:user'

  /** A scope kondo cannot look inside still gets a row (ADR-0005). */
  const NO_COUNTS: ProjectRowCounts = {
    skills: 0,
    agents: 0,
    commands: 0,
    rules: 0,
    settings: 0,
    hooks: null,
    mcpServers: null
  }

  /** A project's `.claude`, or null when it has none to read (ADR-0002). */
  const storeRoot = async (dirName: string): Promise<string | null> => {
    const project = (await inventory()).verified.find(
      (candidate) => candidate.dirName === dirName
    )
    return project ? path.join(project.absPath, '.claude') : null
  }

  const globalRow = async (c: Collector): Promise<ProjectRow> => ({
    id: GLOBAL_ROW,
    label: 'Global',
    path: tildify(locator.userRoot, locator.home),
    global: true,
    hasStore: true,
    sessionCount: 0,
    lastActivityMs: 0,
    counts: await countStoreEntries(locator, locator.userRoot, c)
  })

  const storesOverview = async (): Promise<Scan<StoresOverview>> => {
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
  }

  return {
    storesOverview,

    async projectsList(refresh?: boolean): Promise<Scan<ProjectRow[]>> {
      const c = collector()
      const { scan } = await inventory(refresh === true)
      const projects = (await kinds.project.discover(context(c))) ?? []
      // Tier-1 throughout (ADR-0007): the cached inventory plus a handful of
      // readdirs per project that has a store, and not one file opened.
      const rows = await mapPool(projects, 8, async (project): Promise<ProjectRow> => {
        const root = await storeRoot(project.dirName)
        return {
          id: project.id,
          label: project.guessedPath ?? project.dirName,
          path: project.guessedPath,
          global: false,
          hasStore: project.hasStore,
          sessionCount: project.sessionCount,
          lastActivityMs: project.lastActivityMs,
          counts: root === null ? { ...NO_COUNTS } : await countStoreEntries(locator, root, c)
        }
      })
      rows.sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      return {
        // The global row leads, because the user store is what every project
        // inherits from — it is the top of the chain, not one more project.
        data: [await globalRow(c), ...rows],
        errors: [...scan.errors, ...c.errors],
        unknown: [...scan.unknown, ...c.unknown]
      }
    },

    async projectDetail(id: string): Promise<Scan<ProjectDetail | null>> {
      const global = id === GLOBAL_ROW
      if (typeof id !== 'string' || (!global && !id.startsWith(PROJECT_ID_PREFIX))) {
        return badRequest(null, `projectDetail expects a ${PROJECT_ID_PREFIX} id or ${GLOBAL_ROW}.`)
      }
      const c = collector()
      const { scan, verified } = await inventory()

      let only: VerifiedProject[] = []
      let row: ProjectRow
      if (global) {
        row = await globalRow(c)
      } else {
        const dirName = id.slice(PROJECT_ID_PREFIX.length)
        const record = scan.data.byDirName.get(dirName)
        if (!record) return unknownId(null, id)
        const store = verified.find((candidate) => candidate.dirName === dirName)
        if (store) only = [store]
        const rows = (await kinds.project.discover(context(c))) ?? []
        const project = rows.find((candidate) => candidate.id === id)
        row = {
          id,
          label: project?.guessedPath ?? dirName,
          path: project?.guessedPath ?? null,
          global: false,
          hasStore: project?.hasStore ?? false,
          sessionCount: project?.sessionCount ?? 0,
          lastActivityMs: project?.lastActivityMs ?? 0,
          counts: store === undefined
            ? { ...NO_COUNTS }
            : await countStoreEntries(locator, path.join(store.absPath, '.claude'), c)
        }
      }

      // One context, narrowed to this scope: every scanner below reads the
      // user store and — for a project — that project's `.claude`, and the
      // filter then keeps what belongs to the scope asked for. The join is on
      // the DTOs' own `projectId` fields, never on a parsed id (ADR-0008).
      const shared = context(c, undefined, only)
      const owner = global ? null : id
      const mine = <T extends { projectId: string | null }>(entries: T[] | null): T[] =>
        (entries ?? []).filter((entry) => entry.projectId === owner)

      const [skills, agents, commands, rules, outputStyles, hooks, servers, layers, plugins] =
        await Promise.all([
          kinds.skill.discover(shared),
          kinds.agent.discover(shared),
          kinds.command.discover(shared),
          kinds.rule.discover(shared),
          kinds.outputStyle.discover(shared),
          kinds.hook.discover(shared),
          kinds.mcp.discover(shared),
          kinds.settings.discover(shared),
          kinds.plugin.discover(shared)
        ])

      // An MCP server carries the flattened project it was declared for
      // rather than a project id, so this one join is on that name — inside
      // the main process, which is where flattening is understood.
      const dirName = global ? null : id.slice(PROJECT_ID_PREFIX.length)
      const mcpServers = (servers ?? []).filter((server) =>
        global ? server.scope === 'user' : server.project === dirName
      )

      const sessions = global ? [] : ((await kinds.session.discover(context(c, id))) ?? [])
      const overview = global ? await storesOverview() : null
      if (overview) c.errors.push(...overview.errors)

      return finish(
        {
          row: {
            ...row,
            counts: {
              ...row.counts,
              // Counted at last: both live inside files, which is why the
              // listing could not say (ADR-0007).
              hooks: mine(hooks).length,
              mcpServers: mcpServers.length
            }
          },
          skills: mine(skills),
          agents: mine(agents),
          commands: mine(commands),
          rules: mine(rules),
          outputStyles: global ? (outputStyles ?? []) : [],
          hooks: mine(hooks),
          mcpServers,
          settings: mine(layers),
          plugins: projectPluginStates(plugins ?? [], owner),
          sessions,
          storage: overview?.data ?? null
        },
        c
      )
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
      // A project with no `.claude` is a real member of the project set and
      // still not a store (ADR-0002), so it is refused by name rather than
      // reported as an id nobody has heard of — the UI can say which
      // directory would have to exist first.
      const storeless = await storelessDestination(destinationId)
      if (storeless !== null) return badRequest(null, storeless)

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

    async pluginSkills(pluginId: string) {
      if (typeof pluginId !== 'string' || !pluginId.startsWith('plugin:')) {
        return badRequest([], 'pluginSkills expects a plugin: id.')
      }
      const c = collector()
      const skills = await kinds.pluginSkill.discover(context(c, pluginId))
      if (!skills) return unknownId([], pluginId)
      return finish(skills, c)
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

    async pluginClear(
      pluginId: string,
      layerId: string
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof pluginId !== 'string' || !pluginId.startsWith('plugin:')) {
        return badRequest(null, 'pluginClear expects a plugin: id.')
      }
      if (typeof layerId !== 'string' || !layerId.startsWith('settings:')) {
        return badRequest(null, 'pluginClear expects a settings: layer id.')
      }
      const c = collector()
      // One context, as the toggle does: the plugin and the layer are read
      // once, so the splice sees the bytes the entity was built from.
      const shared = context(c)
      const entity = await kinds.plugin.read(pluginId, shared)
      if (!entity) return unknownId(null, pluginId)

      const planned = await pluginClearPlan({ entity, layerId }, shared)
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

    async tidyPreview(): Promise<Scan<TidyPreview>> {
      const c = collector()
      const { scan } = await inventory()
      const candidates = await scanTidyCandidates(locator, scan.data, now(), c)
      return {
        data: toTidyPreview(candidates),
        errors: [...scan.errors, ...c.errors],
        unknown: [...scan.unknown, ...c.unknown]
      }
    },

    async tidySweep(categories: TidyCategory[]): Promise<Scan<JournalEntryInfo | null>> {
      const chosen = readCategories(categories)
      if (chosen === null) {
        return badRequest(null, 'tidySweep expects an array of known tidy categories.')
      }
      const c = collector()
      // The same cached scan the preview was built from (ADR-0007), so the
      // sweep moves the set the user confirmed rather than one rediscovered
      // a moment later. An item that vanished in between refuses the whole
      // plan in `mutate` — all of the preview or none of it.
      const { scan } = await inventory()
      const plan = tidyPlan(await scanTidyCandidates(locator, scan.data, now(), c), chosen)
      // Nothing to sweep is the ordinary answer on a tidy store, not an
      // error: no journal entry, and not a byte touched.
      if (plan === null) return finish<JournalEntryInfo | null>(null, c)

      // Dropped whether or not the sweep finished: a step that failed part
      // way has already moved transcripts the cached inventory still lists.
      const result = await mutations.mutate(plan).finally(dropInventory)
      return {
        data: result.data,
        errors: [...c.errors, ...result.errors],
        unknown: [...c.unknown, ...result.unknown]
      }
    },

    async configOrphansPreview(): Promise<Scan<ConfigOrphan[]>> {
      const c = collector()
      const records = await configOrphans(context(c))
      return finish(
        records.map((record) => record.info),
        c
      )
    },

    async configOrphansRemove(orphanIds: string[]): Promise<Scan<JournalEntryInfo | null>> {
      if (!Array.isArray(orphanIds) || orphanIds.some((id) => typeof id !== 'string')) {
        return badRequest(null, 'configOrphansRemove expects an array of orphan ids.')
      }
      const c = collector()
      // The same scan the plan is built from, so a member that changed since
      // the preview refuses the whole removal rather than quietly splicing a
      // different one — and the digest in each step refuses again at apply
      // time if Claude wrote the file in between (ADR-0010).
      const planned = configOrphansPlan(await configOrphans(context(c)), orphanIds)
      if (!planned.ok) {
        c.errors.push({ code: planned.code, path: '(request)', message: planned.message })
        return finish(null, c)
      }
      if (planned.plan === null) return finish<JournalEntryInfo | null>(null, c)

      // A registry entry is half the project set (ADR-0009), so removing one
      // changes what the cached inventory describes — dropped whether or not
      // the splice finished.
      const result = await mutations.mutate(planned.plan).finally(dropInventory)
      return {
        data: result.data,
        errors: [...c.errors, ...result.errors],
        unknown: [...c.unknown, ...result.unknown]
      }
    },

    journalList() {
      return mutations.list()
    },

    async journalUndo(journalId: string) {
      if (typeof journalId !== 'string' || !journalId.startsWith('journal:')) {
        return badRequest(null, 'journalUndo expects a journal: id.')
      }
      return mutations.undo(journalId).finally(dropInventory)
    },

    trashSize() {
      return mutations.trashSize()
    },

    /**
     * The one destructive channel (ADR-0001). It stands alone here for the
     * same reason it stands alone in `mutations`: nothing else on this
     * workspace reaches it, so emptying can never ride along with a toggle,
     * a move or a sweep. The renderer confirms before calling.
     *
     * No `dropInventory()` — kondo's trash sits outside every store, so the
     * session inventory is not built from anything this touches.
     */
    trashEmpty() {
      return mutations.emptyTrash()
    }
  }
}
