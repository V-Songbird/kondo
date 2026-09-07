import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { KondoApi } from '../shared/contract'
import { collector, safeReadJson } from '../electron/main/workspace/scan'
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

/**
 * The ADR-0002 boundary test: run every read API over a fixture world whose
 * verified project contains synthetic files OUTSIDE .claude, recording
 * readdir/stat/lstat/readFile calls through node:fs/promises. Assert no
 * recorded path escapes the allowed roots and no readFile attempt names a
 * protected identity/token file. (Transcript streaming goes through node:fs
 * createReadStream, whose static import this spy cannot intercept; those
 * paths come from inventory records that are inside the user store by
 * construction.)
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
    const reads = vi.spyOn(fsp, 'readFile')
    const spies = (['readdir', 'stat', 'lstat'] as const).map((method) =>
      vi.spyOn(fsp, method)
    )

    const projects = await api.sessionProjects()
    expect(projects.data[0]).not.toHaveProperty('guessedPath')
    const sessions = await api.sessionList(projects.data[0]!.id)
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
    expect(await safeReadJson(target, name, c)).toBeNull()
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

  const splice = (store: string, at: string): MutationPlan => ({
    op: 'settings-edit',
    kind: 'settings',
    entityId: 'settings:boundary',
    summary: 'Exercise resolved boundary',
    steps: [{
      type: 'splice', store, at, expectDigest: digestSource(contents),
      edits: [{ at: contents.indexOf('quiet'), remove: 5, insert: 'loud' }]
    }]
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

    await refusesWithoutIo(() => createMutations(world.locator).mutate(splice('user', at)))
    expect(await fsp.readFile(target, 'utf8')).toBe(contents)
    expect(await fsp.readdir(outside)).toEqual(['settings.json'])
  })

  it('refuses a missing destination below an external parent junction before creating directories', async (context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    await link(context, outside, path.join(world.userRoot, 'linked'), true)
    const plan = splice('user', 'unused')
    plan.steps = [{ type: 'write', store: 'user', at: 'linked/new/nested/settings.json', content: contents }]

    await refusesWithoutIo(() => createMutations(world.locator).mutate(plan))
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
  })

  it.for(['file', 'parent'] as const)('refuses a dangling %s link instead of treating it as an absent destination', async (kind, context) => {
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    const directory = kind === 'parent'
    await link(context, path.join(outside, 'absent'), path.join(world.userRoot, 'dangling'), directory)
    const plan = splice('user', 'unused')
    plan.steps = [{ type: 'write', store: 'user', at: directory ? 'dangling/nested/settings.json' : 'dangling', content: contents }]

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
      splice('user-config', path.basename(world.locator.userConfigFile))
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

    await refusesWithoutIo(() => mutations.mutate(splice('project:fixture', 'settings.json')))
    expect(await fsp.readFile(mcp, 'utf8')).toBe(contents)
    expect(await fsp.readdir(project)).toEqual(['.claude', '.mcp.json'])
  })

  it('returns an undo refusal when a restore parent becomes an external junction', async (context) => {
    const parent = path.join(world.userRoot, 'restore')
    const outside = path.join(world.base, 'outside')
    await writeFileTree(parent, { 'settings.json': contents })
    await writeFileTree(outside, { 'settings.json': 'outside bytes' })
    const mutations = createMutations(world.locator)
    const plan = splice('user', 'unused')
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

  it('reports a dangling splice undo parent without claiming the trash was emptied', async (context) => {
    const backing = path.join(world.userRoot, 'backing')
    const parent = path.join(world.userRoot, 'linked')
    const outside = path.join(world.base, 'outside')
    await writeFileTree(backing, { 'settings.json': contents })
    await writeFileTree(outside, { 'sentinel.txt': 'unchanged' })
    await link(context, backing, parent, true)
    const mutations = createMutations(world.locator)
    const done = await mutations.mutate(splice('user', 'linked/settings.json'))
    expect(done.errors).toEqual([])
    expect(done.data).not.toBeNull()
    await fsp.unlink(parent)
    await link(context, path.join(outside, 'absent'), parent, true)

    const undone = await mutations.undo(done.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.map((error) => error.code)).toContain('read-failed')
    expect(undone.errors.map((error) => error.message).join(' ')).not.toContain('emptied')
    expect(await fsp.readFile(path.join(backing, 'settings.json'), 'utf8')).toBe(contents.replace('quiet', 'loud'))
    expect(await fsp.readdir(outside)).toEqual(['sentinel.txt'])
    expect(await fsp.readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    expect((await fsp.lstat(parent)).isSymbolicLink()).toBe(true)
  })
})
