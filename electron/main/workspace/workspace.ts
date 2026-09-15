import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ConfigOrphan,
  DesktopSession,
  EntityIdentity,
  EntityKind,
  HookGroup,
  HookInfo,
  JournalEntryInfo,
  KondoApi,
  MutateRequest,
  PluginInfo,
  ProjectDetail,
  ProjectRow,
  ProjectRowCounts,
  Scan,
  ScanError,
  SessionDetail,
  SessionDuplicateGroup,
  SessionProject,
  SessionSummary,
  SessionTrashPreview,
  SettingsLayerInfo,
  SkillDuplicateGroup,
  SkillInfo,
  StoresOverview,
  TidyCategory,
  TidyPreview,
  ToggleOperation
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, describe, finish, mapPool, isEnoent, resolveAllowedPath, type Collector, type ReadBoundary } from './scan'
import {
  configOrphans,
  configOrphansPlan,
  createKindContext,
  kinds,
  mcpProjectsOf,
  listingFor,
  listingForId,
  pluginClearPlan,
  projectPluginStates,
  sessionNearDuplicates,
  sessionTrashPlan,
  skillDuplicates,
  snapshotSkillGroup,
  type KindContext
} from './kinds'
import {
  scanSessionInventory,
  toSessionSummaries,
  type ProjectRecord,
  type SessionInventory
} from './sessions'
import {
  countStoreEntries,
  groupHooks,
  inheritedMcpServers,
  inheritedSkills,
  userStoreReport,
  type VerifiedProject
} from './user-store'
import { desktopStoreReport } from './desktop-store'
import { slashed, tildify } from './display'
import { isScratchProjectName, isStale, STALE_AFTER_DAYS } from './analysis'
import { createMutations, type MutationPlan } from './mutations'
import { createRemovalReviews, snapshotRemovalTree, staleRemoval } from './reviewed-removals'
import { tidyCategories } from '../../../shared/contract'
import { createAppearance } from './appearance'
import { describeProfile } from './profile'
import type { ExistsFn } from './projects'
import {
  readCategories,
  scanTidyCandidates,
  tidyPlan,
  toTidyPreview,
  type TidyBlocks,
  type TidyCandidates
} from './tidy'

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
  guessExists?: ExistsFn
}

/** The store-name prefix a project's `.claude` root answers to (ADR-0008). */
const PROJECT_STORE = 'project:'

/** The id prefixes the shipped channels check before they alias (ADR-0008). */
const PROJECT_ID_PREFIX = 'project:code:'
const SKILL_ID_PREFIX = 'skill:'
const PLUGIN_ID_PREFIX = 'plugin:'

interface InventoryState {
  scan: Scan<SessionInventory>
  verified: VerifiedProject[]
  /** The wider set a `.mcp.json` may be opened for (entry 103, ADR-0002). */
  mcpProjects: VerifiedProject[]
  /** What `inventoryFingerprint` read when this inventory was built. */
  fingerprint: string
}

/**
 * The cheapest honest reading of "has the store moved on": the mtime and
 * size of the two things the inventory is built from — Claude's registry,
 * which names the projects, and the `projects/` directory, whose entries are
 * the transcript half. Two stats per call, no directory walked (ADR-0007).
 * A file that is not there is a state too, and differs from one that is.
 */
async function inventoryFingerprint(locator: StoreLocator): Promise<string> {
  const mark = async (target: string, boundary: ReadBoundary): Promise<string> => {
    try {
      const resolved = await resolveAllowedPath(target, boundary)
      const stat = await fs.stat(resolved)
      return `${resolved}:${stat.mtimeMs}:${stat.size}`
    } catch (cause) {
      return isEnoent(cause) ? 'absent' : `unreadable:${describe(cause)}`
    }
  }
  const [registry, projects] = await Promise.all([
    mark(locator.userConfigFile, { file: locator.userConfigFile }),
    mark(path.join(locator.userRoot, 'projects'), locator.userRoot)
  ])
  return `${registry}|${projects}`
}

type RemovalReview =
  | { kind: 'tidy'; candidates: TidyCandidates; signatures: Record<TidyCategory, string>; blocked: TidyBlocks }
  | { kind: 'sessions'; ids: string[]; signature: string }
  | { kind: 'skill'; name: string; ids: string[]; signature: string }

export function createWorkspace(options: WorkspaceOptions): KondoApi {
  const { locator, platform } = options
  const tmpRoots = [locator.tmpRoot, locator.tmpRootRealpath]
  const now = options.now ?? Date.now
  const appearance = createAppearance(locator)
  const reviews = createRemovalReviews<RemovalReview>(now)

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

  /**
   * The cached inventory, rebuilt when asked to, when a mutation dropped it,
   * or when the store it was read from has changed under it. Claude rewrites
   * `~/.claude.json` during every session (ADR-0010) and other tools add and
   * remove project directories, so a cache that only its own writes could
   * invalidate would report a project set nobody else has anymore.
   */
  const inventory = async (refresh = false): Promise<InventoryState> => {
    const fingerprint = await inventoryFingerprint(locator)
    const held = inventoryState === null ? null : await inventoryState
    if (held === null || refresh || held.fingerprint !== fingerprint) {
      inventoryState = (async () => {
        const scan = await scanSessionInventory(locator, platform, options.guessExists)
        return {
          scan,
          verified: verifyProjects(scan.data.projects),
          mcpProjects: mcpProjectsOf(scan.data),
          fingerprint
        }
      })()
    }
    return inventoryState as Promise<InventoryState>
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
    only?: { stores: VerifiedProject[]; mcp: VerifiedProject[] }
  ): KindContext =>
    createKindContext({
      locator,
      c,
      now: now(),
      inventory: async () => (await inventory()).scan.data,
      projects: only ? async () => only.stores : async () => (await inventory()).verified,
      mcpProjects: only
        ? async () => only.mcp
        : async () => (await inventory()).mcpProjects,
      parentId
    })

  /** Pin one forced inventory to this call, including its verified store roots. */
  const freshContext = async (c: Collector): Promise<KindContext> => {
    const { scan, verified, mcpProjects } = await inventory(true)
    c.errors.push(...scan.errors)
    c.unknown.push(...scan.unknown)
    return createKindContext({
      locator,
      c,
      now: now(),
      inventory: async () => scan.data,
      projects: async () => verified,
      mcpProjects: async () => mcpProjects
    })
  }

  const stale = (at: string, detail?: string): Scan<null> => ({
    data: null, errors: [staleRemoval(at, detail)], unknown: []
  })

  const snapshotPlan = async (plan: MutationPlan | null): Promise<string> => {
    const result = []
    for (const step of plan?.steps ?? []) {
      if (step.type !== 'trash') throw Error('A removal review may only trash reviewed entries.')
      const root = step.store === 'user' ? locator.userRoot :
        step.store === 'desktop' ? locator.desktopRoot : null
      if (root === null) throw Error('Unknown removal store.')
      result.push([step.store, step.from, await snapshotRemovalTree(path.join(root, step.from), root)])
    }
    return JSON.stringify(result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  }

  // Include the complete selected UUID namespace, including formerly absent
  // sidecars/markers. Ambiguous or unrecognized related entries are withheld.
  const snapshotSessions = async (plan: MutationPlan, ids: string[], shared: KindContext): Promise<string> => {
    const selected = new Set(plan.steps.map((step) => step.type === 'trash' ? step.from : ''))
    for (const id of ids) {
      const key = id.slice('session:code:'.length)
      const slash = key.lastIndexOf('/')
      const dirName = key.slice(0, slash)
      const uuid = key.slice(slash + 1).toLowerCase()
      const project = (await shared.inventory()).byDirName.get(dirName)
      if (!project) throw Error('The selected project disappeared.')
      const record = project.sessions.find((session) => session.uuid === uuid)
      if (!record) throw Error('The selected transcript disappeared.')
      const info = await fs.stat(await resolveAllowedPath(record.file, locator.userRoot))
      if (info.size !== record.bytes || info.mtimeMs !== record.mtimeMs) throw Error('The session changed after inventory.')
      const root = await resolveAllowedPath(project.absPath, locator.userRoot)
      const names = (await fs.readdir(root)).filter((name) => {
        const lower = name.toLowerCase()
        return lower === uuid || lower.startsWith(uuid + '.')
      })
      const planned = [...selected].filter((name) => name.startsWith('projects/' + dirName + '/') &&
        (path.posix.basename(name).toLowerCase() === uuid || path.posix.basename(name).toLowerCase().startsWith(uuid + '.')))
      if (names.length !== planned.length || names.some((name) => !selected.has('projects/' + dirName + '/' + name))) {
        throw Error('The selected session has changed or ambiguous related files.')
      }
    }
    return snapshotPlan(plan)
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

  /**
   * The three display strings a row is named by, built here so the renderer
   * never splits a path (ADR-0008). With no real path the flattened directory
   * name stands for all three halves.
   */
  const naming = (
    project: { guessedPath: string | null; dirName: string }
  ): Pick<ProjectRow, 'label' | 'name' | 'parent' | 'path'> => {
    if (project.guessedPath === null) {
      return { label: project.dirName, name: project.dirName, parent: null, path: null }
    }
    const full = slashed(project.guessedPath)
    const parent = slashed(path.dirname(project.guessedPath))
    return {
      label: full,
      name: path.basename(project.guessedPath) || full,
      parent: parent === full ? null : parent,
      path: full
    }
  }

  const globalRow = async (c: Collector): Promise<ProjectRow> => ({
    id: GLOBAL_ROW,
    label: 'Global',
    name: 'Global',
    parent: null,
    path: tildify(locator.userRoot, locator.home),
    global: true,
    location: 'here',
    throwaway: false,
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
    // The second count the card needs, read off the inventory the first one
    // already walked: a member with no transcript of its own is a registry key
    // Claude has on record and nothing more. No extra scan, no extra field.
    let transcriptProjectCount = 0
    for (const project of projects) {
      if (project.sessions.length > 0) transcriptProjectCount += 1
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
        sessions: {
          // The union (ADR-0009, domain.md), not the transcript-bearing subset.
          projectCount: projects.length,
          transcriptProjectCount,
          sessionCount,
          staleCount,
          transcriptBytes
        }
      },
      errors,
      unknown: [...scan.unknown, ...c.unknown]
    }
  }

  // ---------------------------------------------------------------------
  // The generic pair every kind is reached through (ADR-0004)

  /**
   * Every entity of one kind, narrowed to `parentId` for the listings that
   * take one. The registry's `listings` table picks the entry; nothing here
   * branches on which kind was asked for.
   */
  const entityList = async (
    kind: EntityKind,
    parentId?: string
  ): Promise<Scan<EntityIdentity[]>> => {
    const listing = listingFor(kind, parentId)
    if (listing === null) {
      return badRequest(
        [] as EntityIdentity[],
        parentId === undefined
          ? `entityList has no listing for kind "${kind}".`
          : `entityList has no listing for kind "${kind}" under a parent like "${parentId}".`
      )
    }
    const c = collector()
    const entities = await listing.definition.discover(context(c, parentId))
    if (!entities) return unknownId([] as EntityIdentity[], parentId ?? kind)
    return finish(entities, c)
  }

  /**
   * The one mutating entry. The id's kind prefix picks the registry entry in
   * the main process (ADR-0008) — the renderer hands back the id it was given
   * and parses nothing — and that entry plans the request. Planning stays
   * separate from applying and what it plans is reversible (ADR-0001).
   *
   * A refusal arrives with the capability matrix's own reason and its own
   * code (ADR-0006); nothing here flattens one into a generic error.
   */
  const entityMutate = async (
    entityId: string,
    request: MutateRequest
  ): Promise<Scan<JournalEntryInfo | null>> => {
    if (typeof entityId !== 'string' || entityId === '') {
      return badRequest(null, 'entityMutate expects an entity id.')
    }
    const op = request === null || typeof request !== 'object' ? undefined : request.op
    if (op !== 'enable' && op !== 'disable' && op !== 'move' && op !== 'trash') {
      return badRequest(null, 'entityMutate expects an op of enable, disable, move or trash.')
    }
    const listing = listingForId(entityId)
    if (listing === null) {
      return badRequest(null, `entityMutate does not know the kind of id "${entityId}".`)
    }

    const c = collector()
    const review = op === 'trash' && listing.kind === 'skill' ? reviews.take(request.reviewToken) : null
    // One context: the entity is read and the plan built from the same bytes,
    // so nothing is re-scanned between deciding and describing.
    const shared = op === 'trash' ? await freshContext(c) : context(c)
    const entity = await listing.definition.read(entityId, shared)
    if (entity === null || entity === undefined) {
      if (op === 'trash' && listing.kind === 'skill' && request.reviewToken !== undefined) return stale(entityId, 'A reviewed skill is no longer present.')
      return unknownId(null, entityId)
    }

    // The cast the erased view cannot make for us: `read` and `plan` here are
    // the same registry entry's, so this is the type that entry planned for.
    const planned = await listing.definition.plan(entity as never, request, shared)
    if (!planned.ok) {
      c.errors.push({ code: planned.code, path: entityId, message: planned.message })
      return finish(null, c)
    }
    // Session trash always goes through sessionTrashPreview/sessionTrash, even
    // if the generic kind planner later gains a trash implementation.
    if (op === 'trash' && listing.kind === 'session') {
      return { data: null, errors: [{ code: 'not-permitted', path: entityId, message: 'Review selected sessions through sessionTrashPreview before removing them.' }], unknown: [] }
    }
    if (op === 'trash' && listing.kind === 'skill') {
      if (review?.kind !== 'skill' || !review.ids.includes(entityId)) return stale(entityId)
      const revalidate = async (): Promise<ScanError | null> => {
        const checked = collector()
        try {
          const current = await freshContext(checked)
          const group = (await skillDuplicates(current)).find((group) => group.name === review.name)
          if (!group?.identical || checked.errors.length > 0 ||
              await snapshotSkillGroup(group, current) !== review.signature) {
            return staleRemoval(entityId, 'The reviewed duplicate group changed in membership, identity, or contents.')
          }
          return null
        } catch {
          return staleRemoval(entityId, 'The reviewed duplicate group could not be verified.')
        }
      }
      const refusal = await revalidate()
      if (refusal) return { data: null, errors: [refusal], unknown: [] }
      planned.plan.preflight = revalidate
    }
    return mutations.mutate(planned.plan).finally(dropInventory)
  }

  /** One listing under the older, kind-specific name a shipped view calls. */
  const listAs = async <T extends EntityIdentity>(
    kind: EntityKind,
    parentId?: string
  ): Promise<Scan<T[]>> => (await entityList(kind, parentId)) as Scan<T[]>

  /**
   * What a sweep would move, from a fresh pinned inventory. The
   * preview and sweep both come through here, with the same category blocks.
   */
  const tidyCandidates = async (
    c: Collector
  ): Promise<{ scan: Scan<SessionInventory>; candidates: TidyCandidates; blocked: TidyBlocks; withheldScratchCount: number }> => {
    const shared = await freshContext(c)
    const scan = finish(await shared.inventory(), collector())
    const tidy = await scanTidyCandidates(locator, scan.data, now(), c)
    return { scan, candidates: tidy.candidates, blocked: tidy.blocked, withheldScratchCount: tidy.withheldScratchCount }
  }

  return {
    ...appearance,
    profileGet: () => Promise.resolve(describeProfile(locator)),
    entityList,
    entityMutate,
    storesOverview,

    async projectsList(refresh?: boolean): Promise<Scan<ProjectRow[]>> {
      const c = collector()
      const { scan } = await inventory(refresh === true)
      const projects = (await kinds.project.discover(context(c))) ?? []
      // Tier-1 throughout (ADR-0007): the cached inventory plus a handful of
      // readdirs per project that has a store, and not one file opened.
      const rows = await mapPool(projects, 8, async (project): Promise<ProjectRow> => {
        const root = await storeRoot(project.dirName)
        const record = scan.data.byDirName.get(project.dirName)
        return {
          id: project.id,
          ...naming(record ?? { guessedPath: null, dirName: project.dirName }),
          global: false,
          location: project.location,
          throwaway: isScratchProjectName(project.dirName, tmpRoots, record?.guessedPath ?? null),
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
      const { scan, verified, mcpProjects } = await inventory()

      let only: VerifiedProject[] = []
      // A project with no store can still hold a `.mcp.json`, and a page for
      // it reads that one file and no other project's (entry 103).
      let onlyMcp: VerifiedProject[] = []
      let row: ProjectRow
      if (global) {
        row = await globalRow(c)
      } else {
        const dirName = id.slice(PROJECT_ID_PREFIX.length)
        const record = scan.data.byDirName.get(dirName)
        if (!record) return unknownId(null, id)
        const store = verified.find((candidate) => candidate.dirName === dirName)
        if (store) only = [store]
        const readable = mcpProjects.find((candidate) => candidate.dirName === dirName)
        if (readable) onlyMcp = [readable]
        const rows = (await kinds.project.discover(context(c))) ?? []
        const project = rows.find((candidate) => candidate.id === id)
        row = {
          id,
          ...naming(record),
          global: false,
          location: project?.location ?? 'unlocated',
          throwaway: isScratchProjectName(dirName, tmpRoots, record.guessedPath),
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
      const shared = context(c, undefined, { stores: only, mcp: onlyMcp })
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
          // The full layers (parsed, not the seam's summaries): what each says
          // about a skill is the whole question.
          inheritedSkills: global ? [] : inheritedSkills(skills ?? [], await shared.layers(), id),
          // The user scope's declarations, answered for this project: Claude's
          // switch for one of them lives in this project's entry (entry 103).
          inheritedMcpServers:
            dirName === null ? [] : inheritedMcpServers(await shared.mcp(), dirName),
          sessions,
          staleAfterDays: STALE_AFTER_DAYS,
          storage: overview?.data ?? null
        },
        c
      )
    },

    async sessionProjects(refresh?: boolean) {
      const { scan } = await inventory(refresh === true)
      return {
        data: (await listAs<SessionProject>('project')).data,
        errors: scan.errors,
        unknown: scan.unknown
      }
    },

    async sessionList(projectId: string) {
      // Its own guard rather than the generic one's: this channel has always
      // named the id shape it wants, and the message is what the UI shows.
      if (typeof projectId !== 'string' || !projectId.startsWith(PROJECT_ID_PREFIX)) {
        return badRequest([] as SessionSummary[], 'sessionList expects a project:code: id.')
      }
      return listAs<SessionSummary>('session', projectId)
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

    async sessionNearDuplicates(projectId: string): Promise<Scan<SessionDuplicateGroup[]>> {
      if (typeof projectId !== 'string' || !projectId.startsWith(PROJECT_ID_PREFIX)) {
        return badRequest(
          [] as SessionDuplicateGroup[],
          'sessionNearDuplicates expects a project:code: id.'
        )
      }
      const c = collector()
      const groups = await sessionNearDuplicates(projectId, context(c))
      if (groups === null) return unknownId([] as SessionDuplicateGroup[], projectId)
      return finish(groups, c)
    },

    async sessionTrashPreview(ids: string[]): Promise<Scan<SessionTrashPreview | null>> {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return badRequest(null, 'sessionTrashPreview expects an array of session ids.')
      }
      const chosen = [...new Set(ids)].sort()
      const c = collector()
      const shared = await freshContext(c)
      const planned = await sessionTrashPlan(chosen, shared)
      if (!planned.ok) {
        c.errors.push({ code: planned.code, path: '(request)', message: planned.message })
        return finish(null, c)
      }
      if (!planned.plan) return finish(null, c)
      try {
        if (c.errors.length > 0) return finish(null, c)
        const signature = await snapshotSessions(planned.plan, chosen, shared)
        const stems = await shared.desktopStems()
        const sessions = (await shared.inventory()).projects.flatMap((project) =>
          toSessionSummaries(project, shared.now, stems)).filter((session) => chosen.some((id) =>
            id.toLowerCase() === session.id.toLowerCase()))
        if (c.errors.length > 0) return finish(null, c)
        const reviewToken = reviews.issue({ kind: 'sessions', ids: chosen, signature })
        if (reviewToken === null) return stale('(sessions)', 'This selection is too large to retain safely.')
        return finish({ reviewToken, count: chosen.length, sessions }, c)
      } catch {
        c.errors.push(staleRemoval('(sessions)', 'The selected sessions could not be safely reviewed.'))
        return finish(null, c)
      }
    },

    async sessionTrash(ids: string[], reviewToken?: string): Promise<Scan<JournalEntryInfo | null>> {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return badRequest(null, 'sessionTrash expects an array of session ids.')
      }
      const chosen = [...new Set(ids)].sort()
      if (chosen.length === 0) return finish(null, collector())
      const review = reviews.take(reviewToken)
      const c = collector()
      const shared = await freshContext(c)
      const planned = await sessionTrashPlan(chosen, shared)
      if (!planned.ok) {
        if (reviewToken !== undefined && planned.code === 'unknown-id') return stale('(sessions)', 'A reviewed session is no longer present.')
        c.errors.push({ code: planned.code, path: '(request)', message: planned.message })
        return finish(null, c)
      }
      if (review?.kind !== 'sessions' || JSON.stringify(chosen) !== JSON.stringify(review.ids)) return stale('(sessions)')
      if (!planned.plan) return stale('(sessions)', 'The reviewed sessions are no longer present.')
      const revalidate = async (): Promise<ScanError | null> => {
        const checked = collector()
        try {
          const current = await freshContext(checked)
          const currentPlan = await sessionTrashPlan(chosen, current)
          if (!currentPlan.ok || !currentPlan.plan || checked.errors.length > 0 ||
              await snapshotSessions(currentPlan.plan, chosen, current) !== review.signature) {
            return staleRemoval('(sessions)', 'The selected sessions changed, resumed, or gained or lost related files.')
          }
          return null
        } catch {
          return staleRemoval('(sessions)', 'The selected sessions could not be verified.')
        }
      }
      const refusal = await revalidate()
      if (refusal) return { data: null, errors: [refusal], unknown: [] }
      planned.plan.preflight = revalidate
      return mutations.mutate(planned.plan).finally(dropInventory)
    },

    desktopSessions() {
      return listAs<DesktopSession>('session')
    },

    skillsList() {
      return listAs<SkillInfo>('skill')
    },

    async skillToggle(
      skillId: string,
      operation: ToggleOperation
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof skillId !== 'string' || !skillId.startsWith(SKILL_ID_PREFIX)) {
        return badRequest(null, 'skillToggle expects a skill: id.')
      }
      // `move` is a legal op for `entityMutate` and never was for this
      // channel, so the older, narrower guard stays.
      if (operation !== 'enable' && operation !== 'disable') {
        return badRequest(null, 'skillToggle expects enable or disable.')
      }
      return entityMutate(skillId, { op: operation })
    },

    async skillMove(
      skillId: string,
      destinationId: string
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof skillId !== 'string' || !skillId.startsWith(SKILL_ID_PREFIX)) {
        return badRequest(null, 'skillMove expects a skill: id.')
      }
      if (typeof destinationId !== 'string' || destinationId === '') {
        return badRequest(null, 'skillMove expects a destination scope id.')
      }
      return entityMutate(skillId, { op: 'move', targetId: destinationId })
    },

    async skillDuplicates(): Promise<Scan<SkillDuplicateGroup[]>> {
      const c = collector()
      const shared = await freshContext(c)
      const groups = await skillDuplicates(shared)
      for (const group of groups) {
        group.reviewToken = null
        if (!group.identical || c.errors.length > 0) continue
        try {
          const signature = await snapshotSkillGroup(group, shared)
          group.reviewToken = reviews.issue({ kind: 'skill', name: group.name, ids: group.members.map((member) => member.skill.id), signature })
        } catch {
          c.errors.push(staleRemoval(group.name, 'This duplicate group changed or could not be safely reviewed.'))
        }
      }
      return finish(groups, c)
    },

    pluginsList() {
      return listAs<PluginInfo>('plugin')
    },

    async pluginSkills(pluginId: string) {
      if (typeof pluginId !== 'string' || !pluginId.startsWith(PLUGIN_ID_PREFIX)) {
        return badRequest([] as SkillInfo[], 'pluginSkills expects a plugin: id.')
      }
      return listAs<SkillInfo>('skill', pluginId)
    },

    async pluginToggle(
      pluginId: string,
      layerId: string,
      operation: ToggleOperation,
      createLayer?: boolean
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof pluginId !== 'string' || !pluginId.startsWith(PLUGIN_ID_PREFIX)) {
        return badRequest(null, 'pluginToggle expects a plugin: id.')
      }
      if (typeof layerId !== 'string' || !layerId.startsWith('settings:')) {
        return badRequest(null, 'pluginToggle expects a settings: layer id.')
      }
      if (operation !== 'enable' && operation !== 'disable') {
        return badRequest(null, 'pluginToggle expects enable or disable.')
      }
      return entityMutate(pluginId, {
        op: operation,
        targetId: layerId,
        confirm: createLayer === true
      })
    },

    async pluginMove(
      pluginId: string,
      fromLayerId: string,
      destinationId: string,
      createLayer?: boolean
    ): Promise<Scan<JournalEntryInfo | null>> {
      if (typeof pluginId !== 'string' || !pluginId.startsWith(PLUGIN_ID_PREFIX)) {
        return badRequest(null, 'pluginMove expects a plugin: id.')
      }
      if (typeof fromLayerId !== 'string' || !fromLayerId.startsWith('settings:')) {
        return badRequest(null, 'pluginMove expects a settings: layer id to move out of.')
      }
      if (typeof destinationId !== 'string' || destinationId === '') {
        return badRequest(null, 'pluginMove expects a destination scope id.')
      }
      return entityMutate(pluginId, {
        op: 'move',
        sourceId: fromLayerId,
        targetId: destinationId,
        confirm: createLayer === true
      })
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

    async hooksList(): Promise<Scan<HookGroup[]>> {
      const listing = await entityList('hook')
      return { ...listing, data: groupHooks(listing.data as HookInfo[]) }
    },

    settingsLayers() {
      return listAs<SettingsLayerInfo>('settings')
    },

    async tidyPreview(): Promise<Scan<TidyPreview>> {
      const c = collector()
      const { candidates, blocked, withheldScratchCount } = await tidyCandidates(c)
      const preview = toTidyPreview(candidates, blocked, withheldScratchCount)
      const signatures = {} as Record<TidyCategory, string>
      try {
        if (c.errors.length === 0) {
          for (const category of tidyCategories) signatures[category] = await snapshotPlan(tidyPlan(candidates, [category]))
          preview.reviewToken = reviews.issue({ kind: 'tidy', candidates, signatures, blocked })
          if (preview.reviewToken === null) c.errors.push(staleRemoval('(cleanup)', 'This preview is too large to retain safely.'))
        }
      } catch {
        c.errors.push(staleRemoval('(cleanup)', 'The cleanup candidates changed or could not be safely reviewed.'))
      }
      return finish(preview, c)
    },

    async tidySweep(categories: TidyCategory[], reviewToken?: string): Promise<Scan<JournalEntryInfo | null>> {
      const chosen = readCategories(categories)
      if (chosen === null) return badRequest(null, 'tidySweep expects an array of known tidy categories.')
      if (chosen.length === 0) return finish(null, collector())
      const review = reviews.take(reviewToken)
      if (review?.kind !== 'tidy') return stale('(cleanup)')
      const selected = [...new Set(chosen)]
      const held = selected.find((category) => review.blocked[category] !== undefined)
      if (held !== undefined) {
        return { data: null, errors: [{ code: 'not-permitted', path: held, message: review.blocked[held] as string }], unknown: [] }
      }
      const revalidate = async (): Promise<ScanError | null> => {
        const checked = collector()
        try {
          const current = await tidyCandidates(checked)
          if (checked.errors.length > 0) return staleRemoval(selected.join(', '), 'The selected cleanup categories could not be completely checked.')
          for (const category of selected) {
            if (current.blocked[category] !== undefined ||
                await snapshotPlan(tidyPlan(current.candidates, [category])) !== review.signatures[category]) {
              return staleRemoval(category, 'The reviewed selection (' + review.candidates[category].length + ' items) changed: files were added, removed, edited or used again.')
            }
          }
          return null
        } catch {
          return staleRemoval(selected.join(', '), 'The selected cleanup candidates could not be verified.')
        }
      }
      const refusal = await revalidate()
      if (refusal) return { data: null, errors: [refusal], unknown: [] }
      const plan = tidyPlan(review.candidates, selected)
      if (plan === null) return finish(null, collector())
      plan.preflight = revalidate
      return mutations.mutate(plan).finally(dropInventory)
    },

    async configOrphansPreview(): Promise<Scan<ConfigOrphan[]>> {
      const c = collector()
      const records = await configOrphans(await freshContext(c))
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
      // Re-stat project roots as well as re-reading plugin records: recreating
      // a project does not change the session inventory cache fingerprint.
      // Lost absence evidence refuses the whole choice. Settings execution
      // remains independently refused under 098 (ADR-0010).
      const planned = configOrphansPlan(await configOrphans(await freshContext(c)), orphanIds)
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
