import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KondoApi } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  flattenPath,
  healthyTranscript,
  makeWorld,
  mcpServer,
  placedManifest,
  registerMcp,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The projects home: `projectsList` and `projectDetail`, the two halves of
 * ADR-0007's tiering as the front door uses them. The listing must stay a
 * readdir, and the detail must read the one scope it was asked for.
 */

const GLOBAL_ROW = 'store:user:user'

/**
 * Wrap — not stub — `readFile`, appending each target in call order, so a
 * test can prove what a call did and did not open. The real read still
 * happens, which is the whole point: the assertion is about the tier, not
 * about a mock.
 */
function recordReads(into: string[]): () => void {
  const original = fs.readFile as (...args: unknown[]) => unknown
  const patched = (...args: unknown[]): unknown => {
    if (typeof args[0] === 'string') into.push(args[0])
    return original(...args)
  }
  Object.defineProperty(fs, 'readFile', { value: patched, configurable: true, writable: true })
  return () =>
    Object.defineProperty(fs, 'readFile', { value: original, configurable: true, writable: true })
}

describe('the projects home', () => {
  let world: FixtureWorld
  let api: KondoApi
  let workdir: string
  let storeless: string
  let flattened: string
  let projectId: string

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    storeless = path.join(world.base, 'work', 'plain')
    flattened = flattenPath(workdir)
    projectId = `project:code:${flattened}`
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${flattened}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({
        enabledPlugins: { 'alpha@acme': true },
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }] }
      }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills.disabled/beta-skill/SKILL.md': skillManifest('beta-skill', 'Benched skill'),
      'agents/reviewer.md': placedManifest('Reviews a diff'),
      'commands/ship.md': placedManifest('Ships it'),
      'rules/style.md': placedManifest('House style'),
      'output-styles/terse.md': placedManifest('Say less'),
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [{ scope: 'user', installPath: pluginInstall, version: '1.0.0' }],
          'beta@acme': [{ scope: 'user', installPath: pluginInstall, version: '2.0.0' }]
        }
      })
    })

    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ outputStyle: 'quiet' }),
      // Two keys, so a clear can be shown to take exactly one of them.
      '.claude/settings.local.json': writeJson({
        enabledPlugins: { 'alpha@acme': false },
        outputStyle: 'loud'
      }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped'),
      '.claude/agents/helper.md': placedManifest('Project agent'),
      '.claude/commands/deploy.md': placedManifest('Project command'),
      '.claude/rules/local.md': placedManifest('Project rule')
    })
    // A project Claude knows about that has no `.claude` at all: a real
    // member of the set, and not a store (ADR-0005 — it still gets a row).
    await writeFileTree(storeless, { 'README.md': '# plain\n' })

    await registerMcp(
      world,
      {
        mcpServers: { usersrv: mcpServer() },
        projects: {
          [workdir]: { mcpServers: { localsrv: mcpServer() } },
          [storeless]: {}
        }
      },
      { [workdir]: { mcpServers: { teamsrv: mcpServer() } } }
    )

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('leads with the global row, then one row per project', async () => {
    const list = await api.projectsList()
    expect(list.errors).toEqual([])

    const [global, ...projects] = list.data
    expect(global?.id).toBe(GLOBAL_ROW)
    expect(global?.global).toBe(true)
    expect(global?.path).toBe('~/.claude')
    expect(projects.map((row) => row.id).sort()).toEqual(
      [projectId, `project:code:${flattenPath(storeless)}`].sort()
    )
  })

  it('counts what a readdir can see, and says null for what only a file holds', async () => {
    const list = await api.projectsList()
    const global = list.data.find((row) => row.global)
    const project = list.data.find((row) => row.id === projectId)

    // Benched skills are still skills; the count is both directories.
    expect(global?.counts).toEqual({
      skills: 2,
      agents: 1,
      commands: 1,
      rules: 1,
      settings: 1,
      hooks: null,
      mcpServers: null
    })
    expect(project?.counts).toEqual({
      skills: 1,
      agents: 1,
      commands: 1,
      rules: 1,
      settings: 2,
      hooks: null,
      mcpServers: null
    })
    expect(project?.sessionCount).toBe(1)
    expect(project?.hasStore).toBe(true)
  })

  it('opens no store file to draw the list — only Claude’s own registry', async () => {
    // The project set itself comes from `~/.claude.json` (ADR-0009), so the
    // inventory is warmed first: what is under test is that counting adds
    // nothing to it, not that the registry is never parsed.
    await api.projectsList()

    const reads: string[] = []
    const restore = recordReads(reads)
    try {
      await api.projectsList()
    } finally {
      restore()
    }
    expect(reads).toEqual([])
  })

  it('gives a project with no .claude a row rather than an error', async () => {
    const list = await api.projectsList()
    const row = list.data.find((entry) => entry.id === `project:code:${flattenPath(storeless)}`)
    expect(row?.hasStore).toBe(false)
    expect(row?.counts.skills).toBe(0)
    expect(row?.path).toBe(storeless)
  })

  it('reads one project and returns only what belongs to it', async () => {
    const detail = await api.projectDetail(projectId)
    expect(detail.errors).toEqual([])
    const data = detail.data
    expect(data).not.toBeNull()

    expect(data?.skills.map((skill) => skill.name)).toEqual(['delta-skill'])
    expect(data?.agents.map((entry) => entry.name)).toEqual(['helper'])
    expect(data?.commands.map((entry) => entry.name)).toEqual(['deploy'])
    expect(data?.rules.map((entry) => entry.name)).toEqual(['local'])
    // Output styles are a user-store kind; a project has no directory for one.
    expect(data?.outputStyles).toEqual([])
    // Every entry attributes to this project and no other (ADR-0008).
    for (const entry of [...(data?.skills ?? []), ...(data?.agents ?? [])]) {
      expect(entry.projectId).toBe(projectId)
    }
    expect(data?.settings.map((layer) => layer.layer).sort()).toEqual(['local', 'project'])
    expect(data?.mcpServers.map((server) => server.name).sort()).toEqual([
      'localsrv',
      'teamsrv'
    ])
    expect(data?.sessions).toHaveLength(1)
    expect(data?.storage).toBeNull()
    // The two counts the listing could not make are made here.
    expect(data?.row.counts.hooks).toBe(0)
    expect(data?.row.counts.mcpServers).toBe(2)
  })

  it('serves the global row from the user store, with the storage report', async () => {
    const detail = await api.projectDetail(GLOBAL_ROW)
    expect(detail.errors).toEqual([])
    const data = detail.data

    expect(data?.skills.map((skill) => skill.name).sort()).toEqual([
      'alpha-skill',
      'beta-skill'
    ])
    expect(data?.outputStyles.map((entry) => entry.name)).toEqual(['terse'])
    expect(data?.hooks).toHaveLength(1)
    expect(data?.mcpServers.map((server) => server.name)).toEqual(['usersrv'])
    expect(data?.settings.map((layer) => layer.id)).toEqual(['settings:user:user'])
    // Sessions belong to the project they were recorded in, never here.
    expect(data?.sessions).toEqual([])
    expect(data?.storage?.user.exists).toBe(true)
    expect(data?.storage?.sessions.projectCount).toBe(2)
    expect(data?.row.counts.hooks).toBe(1)
  })

  it('answers a malformed id and an unknown one with typed errors', async () => {
    const malformed = await api.projectDetail('not-an-id')
    expect(malformed.errors[0]?.code).toBe('bad-request')
    expect(malformed.data).toBeNull()

    const unknown = await api.projectDetail('project:code:nothing-here')
    expect(unknown.errors[0]?.code).toBe('unknown-id')
    expect(unknown.data).toBeNull()
  })

  it('points a plugin change at the layer that already speaks, else settings.local', async () => {
    const detail = await api.projectDetail(projectId)
    const alpha = detail.data?.plugins.find((entry) => entry.name === 'alpha')
    const beta = detail.data?.plugins.find((entry) => entry.name === 'beta')

    // The local layer states false, so that is the file a click edits.
    expect(alpha?.choice).toBe('off')
    expect(alpha?.targetLayerId).toBe(`settings:local:${flattened}`)
    expect(alpha?.effective).toBe(false)
    // Nothing in this project mentions beta, so it follows the user layer —
    // and a change would land in the private layer.
    expect(beta?.choice).toBe('inherit')
    expect(beta?.targetLayerId).toBe(`settings:local:${flattened}`)
    expect(beta?.effective).toBeNull()

    // The user store's own control points at its one layer.
    const global = await api.projectDetail(GLOBAL_ROW)
    const there = global.data?.plugins.find((entry) => entry.name === 'alpha')
    expect(there?.choice).toBe('on')
    expect(there?.targetLayerId).toBe('settings:user:user')
  })

  it('clears one plugin statement, leaves every other key, and undoes exactly', async () => {
    const file = path.join(workdir, '.claude', 'settings.local.json')
    const before = await fs.readFile(file, 'utf8')

    const done = await api.pluginClear('plugin:alpha@acme', `settings:local:${flattened}`)
    expect(done.errors).toEqual([])
    expect(done.data).not.toBeNull()

    const after = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    expect(after['enabledPlugins']).toEqual({})
    expect(after['outputStyle']).toBe('loud')

    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })
    const detail = await fresh.projectDetail(projectId)
    const alpha = detail.data?.plugins.find((entry) => entry.name === 'alpha')
    expect(alpha?.choice).toBe('inherit')
    // The user layer says true, so that is what stands once the project stops
    // stating anything — which is the whole point of "follows global".
    expect(alpha?.effective).toBe(true)

    const undone = await api.journalUndo(done.data?.id as string)
    expect(undone.errors).toEqual([])
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('refuses to clear a layer that already says nothing, and writes nothing', async () => {
    const file = path.join(workdir, '.claude', 'settings.json')
    const before = await fs.readFile(file, 'utf8')

    const done = await api.pluginClear('plugin:alpha@acme', `settings:project:${flattened}`)
    expect(done.errors[0]?.code).toBe('not-permitted')
    expect(done.errors[0]?.message).toContain('says nothing about')
    expect(done.data).toBeNull()
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('rejects a malformed clear before it reaches the store', async () => {
    expect((await api.pluginClear('not-a-plugin', 'settings:user:user')).errors[0]?.code).toBe(
      'bad-request'
    )
    expect((await api.pluginClear('plugin:alpha@acme', 'nope')).errors[0]?.code).toBe(
      'bad-request'
    )
    expect(
      (await api.pluginClear('plugin:alpha@acme', 'settings:local:nowhere')).errors[0]?.code
    ).toBe('unknown-id')
  })
})
