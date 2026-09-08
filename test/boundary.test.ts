import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest'
import fsp from 'node:fs/promises'
import fs, { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { KondoApi } from '../shared/contract'
import { collector, digestTree, directorySize, safeReadJson } from '../electron/main/workspace/scan'
import { readFirstUserPrompt, summarizeTranscript } from '../electron/main/workspace/jsonl'
import { scanSessionInventory } from '../electron/main/workspace/sessions'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { createMutations, digestSource, type MutationPlan } from '../electron/main/workspace/mutations'
import {
  healthyTranscript,
  hashTree,
  flattenPath,
  makeWorld,
  mcpServer,
  placedManifest,
  READ_NEVER_FILES,
  registerMcp,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  writeReadNeverFiles,
  type FixtureWorld
} from './helpers'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const stream = vi.fn(actual.createReadStream)
  return { ...actual, createReadStream: stream, default: { ...actual, createReadStream: stream } }
})
const nativeCreateReadStream = vi.mocked(createReadStream).getMockImplementation()!
beforeEach(() => { vi.mocked(createReadStream).mockReset().mockImplementation(nativeCreateReadStream) })

/** Observe content entry points, including reads through an opened handle. */
function observeContents(): { method: string; target: string; resolved: string }[] {
  const calls: { method: string; target: string; resolved: string }[] = []
  const handles = new Map<number, string>()
  const record = (method: string, argument: unknown): void => {
    const target = argument instanceof URL ? fileURLToPath(argument)
      : Buffer.isBuffer(argument) ? argument.toString()
      : typeof argument === 'number' ? handles.get(argument)
      : typeof argument === 'object' && argument !== null && 'fd' in argument
        ? handles.get(Number(argument.fd)) : argument
    expect(typeof target, `${method} must use an observed pathname or handle`).toBe('string')
    let resolved = target as string
    try { resolved = fs.realpathSync(resolved) } catch { /* Observe missing pathname attempts too. */ }
    calls.push({ method, target: target as string, resolved })
  }
  const readFile = fsp.readFile
  vi.spyOn(fsp, 'readFile').mockImplementation((file, options) => {
    record('readFile', file)
    return readFile(file, options)
  })
  vi.mocked(createReadStream).mockImplementation((file, options) => {
    record('createReadStream', file ?? (typeof options === 'object' ? options.fd : undefined))
    return nativeCreateReadStream(file, options)
  })
  const open = fsp.open
  vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
    record('open', file)
    const handle = await open(file, flags, mode)
    handles.set(handle.fd, String(file))
    for (const method of ['read', 'readFile', 'readv', 'createReadStream'] as const) {
      const original = handle[method].bind(handle)
      vi.spyOn(handle, method).mockImplementation((...args: unknown[]) => {
        record(`FileHandle.${method}`, handle)
        return Reflect.apply(original, handle, args)
      })
    }
    return handle
  })
  return calls
}

async function fixtureLink(context: TestContext, target: string, at: string, directory = false): Promise<void> {
  try {
    await fsp.symlink(target, at, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file')
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
      context.skip(`Fixture symlinks unavailable on ${process.platform}: ${code}`)
    }
    throw cause
  }
}

function expectNoContentUnder(calls: ReturnType<typeof observeContents>, root: string): void {
  for (const call of calls) {
    const relative = path.relative(root, call.resolved)
    expect(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)),
      `${call.method} escaped through ${call.target} to ${call.resolved}`).toBe(false)
  }
}

/**
 * The ADR-0002 boundary test: run every read API over a fixture world whose
 * verified project contains synthetic files OUTSIDE .claude, recording
 * metadata calls and all content opens, including transcript streams and
 * FileHandle reads. Assert both named and resolved content paths remain
 * inside their boundary and never name protected identity/token files.
 */

function expectNoProtectedReads(calls: readonly (readonly unknown[])[]): void {
  for (const [argument] of calls) {
    const target = argument instanceof URL ? fileURLToPath(argument)
      : Buffer.isBuffer(argument) ? argument.toString() : argument
    // Fail closed if a future caller switches to a file handle: its path
    // needs separate observation instead of silently skipping the call.
    expect(typeof target, 'readFile target must be an observed path').toBe('string')
    expect(READ_NEVER_FILES, `protected readFile attempt: ${String(target)}`)
      .not.toContain(path.basename(target as string).toLowerCase())
  }
}

describe('privacy boundary (ADR-0002)', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi
  let protectedFiles: string[]

  beforeEach(async () => {
    world = await makeWorld()
    protectedFiles = await writeReadNeverFiles(world)
    workdir = path.join(world.base, 'work', 'proj')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: {} }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      // Shares its name with the project's, so the duplicate listing below
      // actually digests two trees inside this recorded window.
      'skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'User copy'),
      'agents/reviewer.md': placedManifest('User agent'),
      'commands/ship.md': placedManifest('User command'),
      'rules/house-style.md': placedManifest('User rule'),
      'output-styles/terse.md': placedManifest('User output style')
    })
    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({ version: 2, plugins: {
        'alpha@acme': [{ scope: 'user', version: '1.0.0',
          installPath: path.join(world.userRoot, 'plugins/cache/acme/alpha/1.0.0') }]
      } }),
      'plugins/cache/acme/alpha/1.0.0/skills/plugin-skill/SKILL.md': skillManifest('plugin-skill', 'Plugin copy')
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ outputStyle: 'quiet' }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped'),
      '.claude/agents/scout.md': placedManifest('Project agent'),
      '.claude/commands/deploy.md': placedManifest('Project command'),
      '.claude/rules/no-any.md': placedManifest('Project rule'),
      'src/secret.ts': 'export const apiKey = "never-read-me"',
      'README.md': 'project file, off-limits',
      // Decoys at the project root: near-misses for the one file the
      // amendment names, the directories the placed kinds read *inside*
      // `.claude`, and the instructions ADR-0002 keeps invisible.
      'CLAUDE.md': 'project instructions, off-limits',
      'agents/impostor.md': placedManifest('Outside .claude, off-limits'),
      'rules/impostor.md': placedManifest('Outside .claude, off-limits'),
      '.mcp.local.json': writeJson({ mcpServers: { sneaky: mcpServer() } })
    })
    await registerMcp(
      world,
      { mcpServers: { registry: mcpServer() }, projects: { [workdir]: {} } },
      { [workdir]: { mcpServers: { committed: mcpServer() } } }
    )
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('no read API touches a path outside the stores, ~/.claude.json and .claude', async () => {
    await writeFileTree(world.kondoDataRoot, { 'appearance.json': writeJson({ theme: 'slate' }) })
    expect(protectedFiles.map((file) => path.basename(file))).toEqual([...READ_NEVER_FILES])
    for (const file of protectedFiles) expect((await fsp.stat(file)).isFile(), file).toBe(true)
    const contentCalls = observeContents()
    const reads = vi.mocked(fsp.readFile)
    const spies = (['readdir', 'stat', 'lstat'] as const).map((method) =>
      vi.spyOn(fsp, method)
    )

    const projects = await api.sessionProjects()
    expect(projects.data[0]).not.toHaveProperty('guessedPath')
    const sessions = await api.sessionList(projects.data[0]!.id)
    const review = await api.sessionTrashPreview([sessions.data[0]!.id])
    expect(review.errors).toEqual([])
    expect(review.data?.sessions.map((session) => session.id)).toEqual([sessions.data[0]!.id])
    await api.sessionDetail(sessions.data[0]!.id)
    await api.sessionNearDuplicates(projects.data[0]!.id)
    await api.projectsList()
    await api.projectDetail(projects.data[0]!.id)
    await api.projectDetail('store:user:user')
    await api.storesOverview()
    await api.desktopSessions()
    await api.skillsList()
    await api.skillDuplicates()
    await api.pluginsList()
    expect((await api.pluginSkills('plugin:alpha@acme')).data).toHaveLength(1)
    await api.hooksList()
    await api.settingsLayers()
    await api.journalList()
    await api.trashSize()
    expect((await api.appearanceGet()).data.theme).toBe('slate')
    await api.tidyPreview()
    await api.configOrphansPreview()

    // Verify the OS path at its owning layer, inside the observed window.
    const inventory = (await scanSessionInventory(world.locator, process.platform)).data
    expect(inventory.byDirName.get(flattenPath(workdir))?.guessedPath).toBe(workdir)
    const servers = await api.entityList('mcp')
    expect(servers.data.map((server) => server.id).sort()).toEqual([
      `mcp:project:${flattenPath(workdir)}/committed`, 'mcp:user:registry'
    ].sort())

    for (const kind of ['agent', 'command', 'rule', 'output-style'] as const) {
      const entries = (await api.entityList(kind)).data
      expect(entries.length, kind).toBeGreaterThan(0)
      // The decoys at the project root are never among them.
      expect(entries.some((entry) => entry.id.endsWith(':impostor'))).toBe(false)
    }

    const claudeDir = path.join(workdir, '.claude')
    const within = (root: string, target: string): boolean => {
      const rel = path.relative(root, target)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    const allowed = (target: string): boolean =>
      within(world.userRoot, target) ||
      within(world.desktopRoot, target) ||
      // Kondo's own footprint: the journal and the trash (ADR-0001).
      within(world.kondoDataRoot, target) ||
      // Claude's own registry, beside the user store (ADR-0009).
      target === world.locator.userConfigFile ||
      within(claudeDir, target) ||
      target === workdir ||
      // The single ADR-0002 amendment: project-scope MCP servers.
      target === path.join(workdir, '.mcp.json')

    expect(reads).toHaveBeenCalled()
    expect(contentCalls.some((call) => call.method === 'createReadStream')).toBe(true)
    for (const call of contentCalls) {
      expect(allowed(call.resolved), `${call.method} resolved escape: ${call.resolved}`).toBe(true)
      expectNoProtectedReads([[call.target], [call.resolved]])
    }
    expectNoProtectedReads(reads.mock.calls)
    const touched = [...spies, reads]
      .flatMap((spy) => spy.mock.calls.map((call) => call[0]))
      .filter((argument): argument is string => typeof argument === 'string')
    expect(touched.length).toBeGreaterThan(0)
    for (const target of touched) {
      expect(allowed(target), `escaped the boundary: ${target}`).toBe(true)
    }
    expect(touched.some((target) => target.includes(path.join(workdir, 'src')))).toBe(false)

    // The pin. Everything touched outside a `.claude` directory and outside
    // kondo's own roots is exactly this list, asserted as a literal: the
    // project root (stat only), `~/.claude.json`, and `<project>/.mcp.json`.
    // Widening the boundary fails here rather than passing review — a new
    // read of `CLAUDE.md`, `package.json` or `.mcp.local.json` shows up as an
    // extra element and no amount of adding to `allowed` above hides it.
    const stores = [world.userRoot, world.desktopRoot, world.kondoDataRoot, claudeDir]
    const outside = [...new Set(touched)]
      .filter((target) => !stores.some((root) => within(root, target)))
      .sort()
    expect(outside).toEqual(
      [workdir, path.join(workdir, '.mcp.json'), world.locator.userConfigFile].sort()
    )
  })

  it.for(READ_NEVER_FILES)('detects an attempted read of %s even when the adapter catches the failure', async (name) => {
    const target = protectedFiles.find((file) => path.basename(file) === name)!
    const original = fsp.readFile
    const reads = vi.spyOn(fsp, 'readFile').mockImplementation((file, options) => {
      if (file === target) return Promise.reject(Object.assign(new Error('synthetic denial'), { code: 'EACCES' }))
      return original(file, options)
    })
    const c = collector()
    expect(await safeReadJson(target, name, c, name === '.credentials.json' ? world.userRoot : world.desktopRoot)).toBeNull()
    expect(c.errors).toEqual([expect.objectContaining({ code: 'read-failed', path: name })])
    expect(reads).toHaveBeenCalledWith(target, 'utf8')
    expect(() => expectNoProtectedReads(reads.mock.calls)).toThrow(`protected readFile attempt: ${target}`)
  })

  it('appearance selections read and write only Kondo data and preserve every Claude and project byte', async () => {
    const roots = [world.userRoot, world.desktopRoot, workdir]
    const before = await Promise.all(roots.map(hashTree))
    const registry = await fsp.readFile(world.locator.userConfigFile, 'utf8')
    const calls: string[] = []
    const spies = (['readFile', 'lstat', 'mkdir', 'open', 'rename', 'rm'] as const).map((method) =>
      ({ method, spy: vi.spyOn(fsp, method) })
    )
    await api.appearanceGet()
    expect((await api.appearanceSet('carbon')).errors).toEqual([])
    expect((await api.appearanceGet()).data.theme).toBe('carbon')
    for (const { method, spy } of spies) {
      for (const arguments_ of spy.mock.calls) {
        if (typeof arguments_[0] === 'string') calls.push(arguments_[0])
        if (method === 'rename' && typeof arguments_[1] === 'string') calls.push(arguments_[1])
      }
      spy.mockRestore()
    }
    expect(calls.length).toBeGreaterThan(0)
    for (const target of calls) {
      const relative = path.relative(world.kondoDataRoot, target)
      expect(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), target).toBe(true)
    }
    expect(await Promise.all(roots.map(hashTree))).toEqual(before)
    expect(await fsp.readFile(world.locator.userConfigFile, 'utf8')).toBe(registry)
    expect(await fsp.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
  })
})

describe('resolved mutation boundaries', () => {
  let world: FixtureWorld
  const contents = '{"outputStyle":"quiet"}\n'

  beforeEach(async () => {
    world = await makeWorld()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const link = async (
    context: TestContext,
    target: string,
    at: string,
    directory = false
  ): Promise<void> => {
    try {
      await fsp.symlink(target, at, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file')
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
        context.skip(`Fixture symlinks unavailable on ${process.platform}: ${code}`)
      }
      throw cause
    }
  }

  const boundaryRemoval = (store: string, at: string): MutationPlan => ({
    op: 'settings-edit',
    kind: 'settings',
    entityId: 'settings:boundary',
    summary: 'Exercise resolved boundary',
    // Use a permitted operation so path confinement still runs under 098.
    steps: [{ type: 'trash', store, from: at }]
  })

  const refusesWithoutIo = async (
    run: () => Promise<{ data: unknown; errors: Array<{ code: string }> }>,
    code = 'out-of-store',
    allowedReads: string[] = []
  ): Promise<void> => {
    const reads = vi.spyOn(fsp, 'readFile')
    // A refusal must happen before any mutation entry point, including
    // rename/copy: asserting zero calls also covers their destination paths.
    const writes = (['open', 'writeFile', 'appendFile', 'mkdir', 'rename', 'cp', 'copyFile', 'rm', 'rmdir'] as const)
      .map((method) => vi.spyOn(fsp, method))
    const result = await run()
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain(code)
    for (const call of reads.mock.calls) expect(allowedReads).toContain(call[0])
    for (const write of writes) expect(write).not.toHaveBeenCalled()
    reads.mockRestore()
    for (const write of writes) write.mockRestore()
  }

  it.for(['file', 'parent'] as const)('refuses an external %s link before reading its contents', async (kind, context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'settings.json': contents })
    const target = path.join(outside, 'settings.json')
    const directory = kind === 'parent'
    const at = directory ? 'linked/settings.json' : 'settings.json'
    await link(context, directory ? outside : target, path.join(world.userRoot, directory ? 'linked' : at), directory)

    await refusesWithoutIo(() => createMutations(world.locator).mutate(boundaryRemoval('user', at)))
    expect(await fsp.readFile(target, 'utf8')).toBe(contents)
    expect(await fsp.readdir(outside)).toEqual(['settings.json'])
  })

  it('refuses a missing destination below an external parent junction before creating directories', async (context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    await link(context, outside, path.join(world.userRoot, 'linked'), true)
    const plan = boundaryRemoval('user', 'unused')
    await writeFileTree(world.userRoot, { 'source.txt': contents })
    plan.steps = [{ type: 'move', store: 'user', from: 'source.txt', to: 'linked/new/nested/settings.json' }]

    await refusesWithoutIo(() => createMutations(world.locator).mutate(plan))
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
  })

  it.for(['file', 'parent'] as const)('refuses a dangling %s link instead of treating it as an absent destination', async (kind, context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    const directory = kind === 'parent'
    await link(context, path.join(outside, 'absent'), path.join(world.userRoot, 'dangling'), directory)
    const plan = boundaryRemoval('user', 'unused')
    await writeFileTree(world.userRoot, { 'source.txt': contents })
    plan.steps = [{ type: 'move', store: 'user', from: 'source.txt', to: directory ? 'dangling/nested/settings.json' : 'dangling' }]

    await refusesWithoutIo(() => createMutations(world.locator).mutate(plan), 'read-failed')
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    expect((await fsp.lstat(path.join(world.userRoot, 'dangling'))).isSymbolicLink()).toBe(true)
  })

  it('keeps user-config confined to one file when the registry links to a sibling', async (context) => {
    const sibling = path.join(world.home, 'unrelated.json')
    await fsp.writeFile(sibling, contents)
    await link(context, sibling, world.locator.userConfigFile)

    await refusesWithoutIo(() => createMutations(world.locator).mutate(
      boundaryRemoval('user-config', path.basename(world.locator.userConfigFile))
    ))
    expect(await fsp.readFile(sibling, 'utf8')).toBe(contents)
    expect((await fsp.lstat(world.locator.userConfigFile)).isSymbolicLink()).toBe(true)
  })

  it('does not extend the project MCP read exception to linked mutation targets', async (context) => {
    const project = path.join(world.base, 'project')
    const projectStore = path.join(project, '.claude')
    const mcp = path.join(project, '.mcp.json')
    await fsp.mkdir(projectStore, { recursive: true })
    await fsp.writeFile(mcp, contents)
    await link(context, mcp, path.join(projectStore, 'settings.json'))
    const mutations = createMutations(world.locator, Date.now, async (store) =>
      store === 'project:fixture' ? projectStore : null
    )

    await refusesWithoutIo(() => mutations.mutate(boundaryRemoval('project:fixture', 'settings.json')))
    expect(await fsp.readFile(mcp, 'utf8')).toBe(contents)
    expect(await fsp.readdir(project)).toEqual(['.claude', '.mcp.json'])
  })

  it('returns an undo refusal when a restore parent becomes an external junction', async (context) => {
    const parent = path.join(world.userRoot, 'restore')
    const outside = path.join(world.base, 'outside')
    await writeFileTree(parent, { 'settings.json': contents })
    await writeFileTree(outside, { 'settings.json': 'outside bytes' })
    const mutations = createMutations(world.locator)
    const plan = boundaryRemoval('user', 'unused')
    plan.steps = [{ type: 'trash', store: 'user', from: 'restore/settings.json' }]
    const done = await mutations.mutate(plan)
    expect(done.errors).toEqual([])
    expect(done.data).not.toBeNull()
    await fsp.rmdir(parent)
    await link(context, outside, parent, true)
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const beforeJournal = await fsp.readFile(journal, 'utf8')
    const beforeTrash = await hashTree(path.join(world.kondoDataRoot, 'trash'))

    await refusesWithoutIo(() => mutations.undo(done.data!.id), 'out-of-store', [journal])
    expect(await fsp.readFile(path.join(outside, 'settings.json'), 'utf8')).toBe('outside bytes')
    expect(await fsp.readFile(journal, 'utf8')).toBe(beforeJournal)
    expect(await hashTree(path.join(world.kondoDataRoot, 'trash'))).toBe(beforeTrash)
  })

  it('refuses undo of a nested external trash junction before journaling or displacing a healthy occupant', async (context) => {
    const relative = 'skills/restore'
    const target = path.join(world.userRoot, relative)
    const outside = path.join(world.base, 'outside')
    await writeFileTree(target, {
      'SKILL.md': skillManifest('restore', 'Original skill'),
      'nested/original.txt': 'saved fixture bytes'
    })
    await writeFileTree(outside, { 'sentinel.txt': 'external fixture bytes' })
    const mutations = createMutations(world.locator)
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:restore', summary: 'Synthetic restore boundary',
      steps: [{ type: 'trash', store: 'user', from: relative }]
    })
    expect(done.errors).toEqual([])
    expect(done.data).not.toBeNull()
    const saved = path.join(world.kondoDataRoot, 'trash', done.data!.id.slice('journal:'.length), 'user', relative)
    await fsp.rename(path.join(saved, 'nested'), path.join(saved, 'original-nested'))
    await link(context, outside, path.join(saved, 'nested'), true)
    await writeFileTree(target, {
      'SKILL.md': skillManifest('restore', 'New healthy occupant'),
      'occupant.txt': 'must stay in place'
    })
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const beforeJournal = await fsp.readFile(journal, 'utf8')
    const beforeOccupant = await hashTree(target)
    const calls = observeContents()
    const writes = (['open', 'writeFile', 'appendFile', 'mkdir', 'rename', 'cp', 'copyFile', 'rm', 'rmdir'] as const)
      .map((method) => vi.spyOn(fsp, method))

    const undone = await mutations.undo(done.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.length).toBeGreaterThan(0)
    expectNoContentUnder(calls, outside)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(await fsp.readFile(journal, 'utf8')).toBe(beforeJournal)
    expect(await hashTree(target)).toEqual(beforeOccupant)
    expect(await fsp.readFile(path.join(saved, 'original-nested', 'original.txt'), 'utf8')).toBe('saved fixture bytes')
    expect((await fsp.lstat(path.join(saved, 'nested'))).isSymbolicLink()).toBe(true)
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('external fixture bytes')
  })
  it('reports a dangling splice undo parent without claiming the trash was emptied', async (context) => {
    const backing = path.join(world.userRoot, 'backing')
    const parent = path.join(world.userRoot, 'linked')
    const outside = path.join(world.base, 'outside')
    await writeFileTree(backing, { 'settings.json': contents })
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    await link(context, backing, parent, true)
    const mutations = createMutations(world.locator)
    const next = contents.replace('quiet', 'loud')
    const offset = contents.indexOf('quiet')
    const record = { id: 'historical-splice', at: '2026-09-01T00:00:00.000Z', op: 'settings-edit',
      kind: 'settings', entityId: 'settings:boundary', summary: 'Historical linked splice', undoOf: null,
      steps: [{ type: 'splice', store: 'user', from: 'linked/settings.json',
        expectDigest: digestSource(contents), resultDigest: digestSource(next),
        edits: [{ at: offset, remove: 5, insert: 'loud' }], undoEdits: [{ at: offset, remove: 4, insert: 'quiet' }] }] }
    const journal = JSON.stringify(record) + '\n'
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': journal })
    await fsp.writeFile(path.join(backing, 'settings.json'), next)
    const done = { data: { id: 'journal:historical-splice' } }
    await fsp.unlink(parent)
    await link(context, path.join(outside, 'absent'), parent, true)

    const undone = await mutations.undo(done.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.map((error) => error.code)).toContain('not-permitted')
    expect(undone.errors.map((error) => error.message).join(' ')).not.toContain('emptied')
    expect(await fsp.readFile(path.join(backing, 'settings.json'), 'utf8')).toBe(contents.replace('quiet', 'loud'))
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    expect((await fsp.lstat(parent)).isSymbolicLink()).toBe(true)
    expect(await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'), 'utf8')).toBe(journal)
  })
})

describe('resolved read boundaries', () => {
  let world: FixtureWorld
  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  it('observes path reads, streams, open and every supported file-handle reader', async () => {
    const target = path.join(world.userRoot, 'sentinel.txt')
    await fsp.writeFile(target, 'invented content')
    const calls = observeContents()
    await fsp.readFile(target)
    for await (const chunk of createReadStream(target)) expect(chunk.length).toBeGreaterThan(0)
    const handle = await fsp.open(target, 'r')
    try {
      await handle.readFile()
      await handle.read(Buffer.alloc(1), 0, 1, 0)
      await handle.readv([Buffer.alloc(1)], 0)
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
        expect(chunk.length).toBeGreaterThan(0)
      }
    } finally { await handle.close() }
    expect(new Set(calls.map((call) => call.method))).toEqual(new Set([
      'readFile', 'createReadStream', 'open', 'FileHandle.readFile',
      'FileHandle.read', 'FileHandle.readv', 'FileHandle.createReadStream'
    ]))
    for (const call of calls) expect(call.resolved).toBe(target)
    expect(() => expectNoContentUnder(calls, world.userRoot)).toThrow('escaped through')
  })

  it('A6 refuses a skills-root junction to an external synthetic directory', async (context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'external/SKILL.md': skillManifest('external', 'Never read this') })
    await fixtureLink(context, outside, path.join(world.userRoot, 'skills'), true)
    const calls = observeContents()
    const result = await createWorkspace({ locator: world.locator, platform: process.platform }).skillsList()
    expect(result.data).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining('skills') })
    ]))
    expectNoContentUnder(calls, outside)
  })

  it.for(['root', 'manifest'] as const)('follows a safe in-store skills %s alias', async (kind, context) => {
    const backing = path.join(world.userRoot, 'backing')
    await writeFileTree(backing, { 'healthy/SKILL.md': skillManifest('healthy', 'Safe alias') })
    await fixtureLink(context, backing, path.join(world.userRoot, 'skills'), true)
    if (kind === 'manifest') {
      await fsp.mkdir(path.join(backing, 'alias'))
      await fixtureLink(context, path.join(backing, 'healthy', 'SKILL.md'), path.join(backing, 'alias', 'SKILL.md'))
    }
    const result = await createWorkspace({ locator: world.locator, platform: process.platform }).skillsList()
    expect(result.errors).toEqual([])
    expect(result.data.map((entry) => entry.name).sort()).toEqual(kind === 'manifest' ? ['alias', 'healthy'] : ['healthy'])
  })

  it.for(['external', 'dangling', 'loop'] as const)(
    'keeps healthy skills and itemizes a nested %s manifest link', async (kind, context) => {
      const outside = path.join(world.base, 'outside')
      await writeFileTree(world.userRoot, { 'skills/healthy/SKILL.md': skillManifest('healthy', 'Still available') })
      await writeFileTree(outside, { 'SKILL.md': skillManifest('forbidden', 'External sentinel') })
      const manifest = path.join(world.userRoot, 'skills', 'broken', 'SKILL.md')
      await fsp.mkdir(path.dirname(manifest))
      await fixtureLink(context, kind === 'loop' ? manifest
        : path.join(outside, kind === 'dangling' ? 'absent.md' : 'SKILL.md'), manifest)
      const calls = observeContents()
      const result = await createWorkspace({ locator: world.locator, platform: process.platform }).skillsList()
      expect(result.data.some((entry) => entry.name === 'healthy')).toBe(true)
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('broken') })
      ]))
      expectNoContentUnder(calls, outside)
    }
  )

  it.for(['file', 'parent'] as const)('rejects a cross-store %s link from a user-store read', async (kind, context) => {
    await writeFileTree(world.desktopRoot, { 'settings.json': writeJson({ sentinel: 'other store' }) })
    const linked = path.join(world.userRoot, kind === 'parent' ? 'linked/settings.json' : 'settings.json')
    await fixtureLink(context, kind === 'parent' ? world.desktopRoot : path.join(world.desktopRoot, 'settings.json'),
      kind === 'parent' ? path.dirname(linked) : linked, kind === 'parent')
    const calls = observeContents()
    const c = collector()
    expect(await safeReadJson(linked, 'settings.json', c, world.userRoot)).toBeNull()
    expect(c.errors).toHaveLength(1)
    expectNoContentUnder(calls, world.desktopRoot)
  })

  it.for(['registry', 'mcp'] as const)('keeps the exact %s read exception from admitting a sibling', async (kind, context) => {
    const project = path.join(world.base, 'project')
    await writeFileTree(project, { '.claude/settings.json': '{}', 'sibling.json': writeJson({ mcpServers: { forbidden: mcpServer() } }) })
    await registerMcp(world, { projects: { [project]: {} } }, {})
    const target = kind === 'registry' ? world.locator.userConfigFile : path.join(project, '.mcp.json')
    const sibling = kind === 'registry' ? path.join(world.home, 'sibling.json') : path.join(project, 'sibling.json')
    if (kind === 'registry') {
      await fsp.writeFile(sibling, writeJson({ mcpServers: { forbidden: mcpServer() } }))
      await fsp.unlink(target)
    }
    await fixtureLink(context, sibling, target)
    const calls = observeContents()
    const result = await createWorkspace({ locator: world.locator, platform: process.platform }).entityList('mcp')
    expect(result.data.some((entry) => entry.id.includes('forbidden'))).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expectNoContentUnder(calls, sibling)
  })

  it.for(['summary-file', 'first-prompt-file', 'summary-parent', 'first-prompt-parent'] as const)('rechecks %s stream paths after inventory', async (kind, context) => {
    const project = path.join(world.base, 'project')
    const relative = `projects/${flattenPath(project)}/${UUID_A}.jsonl`
    const target = path.join(world.userRoot, relative)
    const outside = path.join(world.base, 'outside')
    await writeFileTree(world.userRoot, { [relative]: healthyTranscript(UUID_A) })
    await writeFileTree(outside, { [`${UUID_A}.jsonl`]: healthyTranscript(UUID_A) })
    const inventory = await scanSessionInventory(world.locator, process.platform)
    const record = inventory.data.byDirName.get(flattenPath(project))!.sessions[0]!
    expect(record.file).toBe(target)
    if (kind.endsWith('parent')) {
      await fsp.rename(path.dirname(target), `${path.dirname(target)}-original`)
      await fixtureLink(context, outside, path.dirname(target), true)
    } else {
      await fsp.unlink(target)
      await fixtureLink(context, path.join(outside, `${UUID_A}.jsonl`), target)
    }
    const calls = observeContents()
    const run = kind.startsWith('summary') ? summarizeTranscript : readFirstUserPrompt
    await expect(run(record.file, world.userRoot)).rejects.toThrow()
    expect(calls).toEqual([])
    expectNoContentUnder(calls, outside)
  })

  it.for(['external', 'dangling', 'loop'] as const)(
    'recursive size preserves healthy bytes and digest refuses a nested %s directory link', async (kind, context) => {
      const root = path.join(world.userRoot, 'tree')
      const outside = path.join(world.base, 'outside')
      await writeFileTree(root, { 'healthy.txt': 'healthy' })
      await writeFileTree(outside, { 'sentinel.txt': 'forbidden bytes' })
      await fixtureLink(context, kind === 'loop' ? root
        : kind === 'dangling' ? path.join(outside, 'missing') : outside, path.join(root, 'linked'), true)
      const calls = observeContents()
      const c = collector()
      expect(await directorySize(root, 'tree', c, world.userRoot)).toBe(Buffer.byteLength('healthy'))
      expect(c.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining('linked') })
      ]))
      await expect(digestTree(root, world.userRoot)).rejects.toThrow()
      expectNoContentUnder(calls, outside)
    }
  )

  it('recursive size and digest include safe in-store aliases without mistaking siblings for a cycle', async (context) => {
    const root = path.join(world.userRoot, 'tree')
    const equivalent = path.join(world.userRoot, 'equivalent')
    await writeFileTree(root, { 'actual/value.txt': 'abc' })
    await writeFileTree(equivalent, { 'actual/value.txt': 'abc', 'alias/value.txt': 'abc' })
    await fixtureLink(context, path.join(root, 'actual'), path.join(root, 'alias'), true)
    const c = collector()
    expect(await directorySize(root, 'tree', c, world.userRoot)).toBe(6)
    expect(c.errors).toEqual([])
    expect(await digestTree(root, world.userRoot)).toBe(await digestTree(equivalent, world.userRoot))
  })

  it('rechecks nested copy destinations after preflight before a newly inserted junction can receive bytes', async (context) => {
    const source = path.join(world.userRoot, 'source')
    const destination = path.join(world.desktopRoot, 'destination')
    const outside = path.join(world.base, 'outside')
    await writeFileTree(source, { 'nested/sentinel.txt': 'source bytes' })
    await writeFileTree(outside, { 'sentinel.txt': 'external bytes must remain' })
    const probe = path.join(world.desktopRoot, 'link-capability-probe')
    await fixtureLink(context, outside, probe, true)
    await fsp.unlink(probe)
    const beforeSource = await hashTree(source)
    let injected = false
    const mkdir = fsp.mkdir
    vi.spyOn(fsp, 'mkdir').mockImplementation(async (at, options) => {
      const result = await mkdir(at, options)
      // Root creation follows copy preflight. Swap the still-missing child
      // before the copy loop gets to its directory or file entry.
      if (at === destination && !injected) {
        injected = true
        await fsp.symlink(outside, path.join(destination, 'nested'), process.platform === 'win32' ? 'junction' : 'dir')
      }
      return result
    })
    const calls = observeContents()
    const copies = vi.spyOn(fsp, 'copyFile')
    const result = await createMutations(world.locator).mutate({
      op: 'move', kind: 'skill', entityId: 'skill:boundary', summary: 'Synthetic copy destination swap',
      steps: [
        { type: 'copy', store: 'user', from: 'source', toStore: 'desktop', to: 'destination' },
        { type: 'trash', store: 'user', from: 'source' }
      ]
    })
    expect(injected).toBe(true)
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(copies).not.toHaveBeenCalled()
    expectNoContentUnder(calls, outside)
    vi.restoreAllMocks()
    expect(await hashTree(source)).toEqual(beforeSource)
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('external bytes must remain')
  })
  it.for(['source', 'destination'] as const)('recursive mutation rejects a nested external %s junction', async (side, context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    await writeFileTree(world.userRoot, { 'source/healthy.txt': 'healthy' })
    if (side === 'source') {
      await fixtureLink(context, outside, path.join(world.userRoot, 'source', 'linked'), true)
    } else {
      await fsp.mkdir(path.join(world.desktopRoot, 'nested'))
      await fixtureLink(context, outside, path.join(world.desktopRoot, 'nested', 'linked'), true)
    }
    const calls = observeContents()
    const writes = (['copyFile', 'cp', 'rename', 'writeFile', 'mkdir'] as const).map((method) => vi.spyOn(fsp, method))
    const result = await createMutations(world.locator).mutate({
      op: 'move', kind: 'skill', entityId: 'skill:boundary', summary: 'Synthetic recursive boundary',
      steps: [
        { type: 'copy', store: 'user', from: 'source', toStore: 'desktop',
          to: side === 'destination' ? 'nested/linked/new' : 'destination' },
        { type: 'trash', store: 'user', from: 'source' }
      ]
    })
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expectNoContentUnder(calls, outside)
    for (const spy of writes) {
      for (const args of spy.mock.calls) {
        for (const target of args.slice(0, 2)) {
          if (typeof target !== 'string') continue
          let resolved = target
          try { resolved = fs.realpathSync(target) } catch { /* Missing destinations checked by parent link cases. */ }
          expectNoContentUnder([{ method: 'mutation', target, resolved }], outside)
        }
      }
    }
    vi.restoreAllMocks()
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'healthy.txt'), 'utf8')).toBe('healthy')
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
  })
})
