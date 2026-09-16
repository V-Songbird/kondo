import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, McpServerInfo } from '../shared/contract'
import { slashed } from '../electron/main/workspace/display'
import { createLocator } from '../electron/main/workspace/locator'
import { claimDataRoot } from '../electron/main/workspace/profile'
import { INVALID_JSON } from '../electron/main/workspace/scan'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  healthyTranscript,
  hashTree,
  flattenPath,
  makeWorld,
  mcpServer,
  registerMcp,
  registerProjects,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Integration through the public KondoApi surface — the same calls the IPC
 * layer delegates to, run against a fixture world.
 */

describe('workspace (KondoApi)', () => {
  let world: FixtureWorld
  let api: KondoApi
  let workdir: string

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    const flattened = flattenPath(workdir)

    await writeFileTree(world.userRoot, {
      [`projects/${flattened}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: {} }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill')
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ outputStyle: 'quiet' }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped')
    })

    // The registry names the project whatever the tmpdir looks like (ADR-0009),
    // so the real stat does the verifying here — no injected probe.
    await registerProjects(world, [workdir])
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('lists projects and sessions by id, and streams a session detail', async () => {
    const projects = await api.sessionProjects()
    expect(projects.data).toHaveLength(1)
    const project = projects.data[0]!
    expect(projects.errors).toEqual([])
    expect(project).not.toHaveProperty('guessedPath')
    expect(project).toMatchObject({
      id: `project:code:${flattenPath(workdir)}`,
      sources: ['registry', 'transcripts'],
      location: 'here',
      hasStore: true
    })
    const entities = await api.entityList('project')
    expect(entities.errors).toEqual([])
    expect(entities.data).toEqual(projects.data)
    for (const entity of entities.data) expect(entity).not.toHaveProperty('guessedPath')
    const row = (await api.projectsList()).data.find((candidate) => candidate.id === project.id)
    expect(row).toMatchObject({ name: 'proj', location: 'here', hasStore: true })
    const projectDetail = await api.projectDetail(project.id)
    expect(projectDetail.errors).toEqual([])
    expect(projectDetail.data?.row).toMatchObject({
      name: row!.name, parent: row!.parent, label: row!.label,
      location: 'here', hasStore: true, throwaway: row!.throwaway
    })

    const sessions = await api.sessionList(project.id)
    expect(sessions.errors).toEqual([])
    expect(sessions.data).toHaveLength(1)

    const detail = await api.sessionDetail(sessions.data[0]!.id)
    expect(detail.errors).toEqual([])
    expect(detail.data?.messageCount).toBe(3)
    expect(detail.data?.firstUserPrompt).toBe('hello kondo')
  })

  it('rejects malformed and unknown ids with typed errors, never throwing', async () => {
    const bad = await api.sessionList('not-an-id')
    expect(bad.errors[0]?.code).toBe('bad-request')

    const probe = await api.sessionDetail('session:code:../../../etc/passwd')
    expect(probe.data).toBeNull()
    expect(probe.errors[0]?.code).toBe('unknown-id')

    const gone = await api.sessionList('project:code:D--Not-There')
    expect(gone.errors[0]?.code).toBe('unknown-id')
  })

  it('previews exact session identities without writes and refuses changed bytes before journaling', async () => {
    const projectId = `project:code:${flattenPath(workdir)}`
    const sessions = (await api.sessionList(projectId)).data
    const ids = sessions.map((session) => session.id)
    const before = await hashTree(world.userRoot)
    const review = await api.sessionTrashPreview(ids)
    expect(review.errors).toEqual([])
    expect(review.data).toMatchObject({ count: 1, reviewToken: expect.any(String), sessions })
    expect(review.data!.reviewToken).not.toContain(world.base)
    expect(await hashTree(world.userRoot)).toBe(before)
    await expect(fs.readFile(path.join(world.kondoDataRoot, 'journal.jsonl')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    await fs.appendFile(path.join(world.userRoot, 'projects', flattenPath(workdir), `${UUID_A}.jsonl`),
      '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'resumed fixture conversation' } }))
    const changed = await hashTree(world.userRoot)
    const refused = await api.sessionTrash(ids, review.data!.reviewToken)
    expect(refused.data).toBeNull()
    expect(refused.errors.map((error) => error.code)).toContain('stale-plan')
    expect(await hashTree(world.userRoot)).toBe(changed)
    await expect(fs.readFile(path.join(world.kondoDataRoot, 'journal.jsonl')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an unknown session review identity without issuing a token', async () => {
    const review = await api.sessionTrashPreview(['session:code:../../../outside'])
    expect(review.data).toBeNull()
    expect(review.errors[0]?.code).toBe('unknown-id')
    expect((await api.journalList()).data).toEqual([])
  })

  it('surfaces skills and settings from the verified project', async () => {
    const skills = await api.skillsList()
    const ids = skills.data.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids.some((id) => id.endsWith(':delta-skill'))).toBe(true)

    const layers = await api.settingsLayers()
    const project = layers.data.find((layer) => layer.layer === 'project')
    expect(project?.exists).toBe(true)
    expect(project?.keys).toContain('outputStyle')
  })

  it('exposes an empty journal and trash before anything has been written', async () => {
    const journal = await api.journalList()
    expect(journal.errors).toEqual([])
    expect(journal.data).toEqual([])

    const trash = await api.trashSize()
    expect(trash.errors).toEqual([])
    expect(trash.data.bytes).toBe(0)
    expect(trash.data.entryCount).toBe(0)
    expect(trash.data.root.endsWith('trash')).toBe(true)
  })

  it('keeps appearance preferences separate from Claude settings and the journal', async () => {
    expect((await api.appearanceGet()).data.theme).toBe('chalk')
    expect(await api.appearanceSet('carbon')).toEqual({ data: { theme: 'carbon' }, errors: [], unknown: [] })
    expect((await api.appearanceGet()).data.theme).toBe('carbon')
    expect((await api.journalList()).data).toEqual([])
    const layers = await api.settingsLayers()
    expect(layers.data.every((layer) => !layer.keys.includes('theme'))).toBe(true)
  })

  it('refuses an undo id that is not a journal id', async () => {
    const bad = await api.journalUndo('skill:user:alpha-skill')
    expect(bad.data).toBeNull()
    expect(bad.errors[0]?.code).toBe('bad-request')
  })

  it('summarizes both stores in the overview', async () => {
    const overview = await api.storesOverview()
    expect(overview.data.sessions.projectCount).toBe(1)
    // Every member of this store's union has a transcript, so the two
    // project figures agree — the other half of the pair in projects-home.
    expect(overview.data.sessions.transcriptProjectCount).toBe(1)
    expect(overview.data.sessions.sessionCount).toBe(1)
    expect(overview.data.sessions.transcriptBytes).toBeGreaterThan(0)
    expect(overview.data.user.exists).toBe(true)
    expect(overview.data.user.entries.some((entry) => entry.name === 'skills')).toBe(true)
    expect(overview.data.desktop.exists).toBe(true)
  })
})

describe('Claude profiles (ADR-0003)', () => {
  let world: FixtureWorld
  let profileRoot: string
  let inside: string
  let beside: string

  beforeEach(async () => {
    world = await makeWorld()
    profileRoot = path.join(world.base, 'profiles', 'work')
    inside = path.join(world.base, 'work', 'inside')
    beside = path.join(world.base, 'work', 'beside')
    await fs.mkdir(path.join(inside, '.claude'), { recursive: true })
    await fs.mkdir(path.join(beside, '.claude'), { recursive: true })
    // Claude Code reads a profile's registry inside the profile directory. The
    // one a directory above belongs to another profile and must stay unread.
    await writeFileTree(profileRoot, { '.claude.json': writeJson({ projects: { [inside]: {} } }) })
    await writeFileTree(path.dirname(profileRoot), { '.claude.json': writeJson({ projects: { [beside]: {} } }) })
  })
  afterEach(async () => { await world.cleanup() })

  const profiled = (env: Record<string, string | undefined>): KondoApi =>
    createWorkspace({
      locator: createLocator({
        home: world.home,
        appData: null,
        userData: world.kondoDataRoot,
        tmpRoot: world.base,
        platform: process.platform,
        env: { KONDO_DESKTOP_STORE_ROOT: world.desktopRoot, ...env }
      }),
      platform: process.platform
    })

  const projectNames = async (api: KondoApi): Promise<string[]> =>
    (await api.projectsList()).data.filter((row) => !row.global).map((row) => row.name)

  it('reads the registry inside the directory CLAUDE_CONFIG_DIR names', async () => {
    const api = profiled({ CLAUDE_CONFIG_DIR: profileRoot })
    expect(await projectNames(api)).toEqual(['inside'])
    expect(await api.profileGet()).toEqual({
      data: { source: 'environment', root: slashed(profileRoot), ignored: [] },
      errors: [],
      unknown: []
    })
  })

  it('keeps the fixture store and its sibling registry when a profile is inherited too', async () => {
    await writeFileTree(world.home, { '.claude.json': writeJson({ projects: { [beside]: {} } }) })
    const api = profiled({ KONDO_STORE_ROOT: world.userRoot, CLAUDE_CONFIG_DIR: profileRoot })
    expect(await projectNames(api)).toEqual(['beside'])
    expect((await api.profileGet()).data).toEqual({
      source: 'fixture',
      root: '~/.claude',
      ignored: [
        `Kondo is not using CLAUDE_CONFIG_DIR (${slashed(profileRoot)}): KONDO_STORE_ROOT takes precedence.`
      ]
    })
  })

  it('says so when a profile selection is not an absolute path', async () => {
    expect((await profiled({ CLAUDE_CONFIG_DIR: 'work/profile' }).profileGet()).data).toEqual({
      source: 'default',
      root: '~/.claude',
      ignored: ['Kondo is not using CLAUDE_CONFIG_DIR: it is not an absolute path.']
    })
  })

  it('binds Kondo’s data root to one store set and refuses another', async () => {
    const record = path.join(world.kondoDataRoot, 'stores.json')
    expect(await claimDataRoot(world.locator, process.platform)).toBeNull()
    const written = await fs.readFile(record, 'utf8')
    expect(await claimDataRoot(world.locator, process.platform)).toBeNull()

    const otherProfile = createLocator({
      home: world.home,
      appData: null,
      userData: world.kondoDataRoot,
      tmpRoot: world.base,
      platform: process.platform,
      env: { CLAUDE_CONFIG_DIR: profileRoot, KONDO_DESKTOP_STORE_ROOT: world.desktopRoot }
    })
    expect(await claimDataRoot(otherProfile, process.platform)).toMatch(/another Claude profile/)
    expect(await fs.readFile(record, 'utf8')).toBe(written)

    await fs.writeFile(record, '{"stores":', 'utf8')
    expect(await claimDataRoot(world.locator, process.platform)).toMatch(/damaged/)
  })
})

describe('workspace first read without user data', () => {
  let world: FixtureWorld

  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => { await world.cleanup() })

  it.each([
    { state: 'absent', exists: false },
    { state: 'empty directory', exists: true }
  ])('keeps an $state user store honest and quiet', async ({ exists }) => {
    // makeWorld creates its user store. Use a new home so absence is real,
    // while the desktop, registry, app data and temporary roots stay injected.
    const home = path.join(world.base, 'fresh-home')
    await fs.mkdir(home)
    const locator = createLocator({
      home,
      appData: null,
      userData: world.kondoDataRoot,
      tmpRoot: world.base,
      platform: process.platform,
      env: { KONDO_DESKTOP_STORE_ROOT: world.desktopRoot }
    })
    expect(locator.userRoot).toBe(path.join(home, '.claude'))
    expect(locator.userConfigFile).toBe(path.join(home, '.claude.json'))
    await expect(fs.lstat(locator.userRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    if (exists) await fs.mkdir(locator.userRoot)
    const expectedHome = exists ? ['.claude'] : []
    expect(await fs.readdir(home)).toEqual(expectedHome)

    const freshWorkspace = (): KondoApi => createWorkspace({ locator, platform: process.platform })
    const overview = await freshWorkspace().storesOverview()
    expect(overview.errors).toEqual([])
    expect(overview.unknown).toEqual([])
    expect(overview.data.user).toEqual({ root: '~/.claude', exists, entries: [], totalBytes: 0 })
    expect(overview.data.sessions).toEqual({
      projectCount: 0,
      transcriptProjectCount: 0,
      sessionCount: 0,
      staleCount: 0,
      transcriptBytes: 0
    })

    // Each listing is the first call on its own workspace, with no inventory
    // warmed by the overview or another listing.
    for (const method of ['sessionProjects', 'skillsList', 'hooksList', 'configOrphansPreview'] as const) {
      expect(await freshWorkspace()[method](), method).toEqual({ data: [], errors: [], unknown: [] })
    }
    expect(await fs.readdir(home)).toEqual(expectedHome)
    if (exists) {
      expect(await fs.readdir(locator.userRoot)).toEqual([])
    } else {
      await expect(fs.lstat(locator.userRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})

describe('settings-derived data crosses deny-by-default (117, ADR-0022)', () => {
  let world: FixtureWorld
  let api: KondoApi
  let workdir: string

  // Synthetic sentinels in every position named for 117: top-level and nested
  // unknown names, env and header names and values, hook matchers, commands,
  // an unknown event and handler type, and malformed JSON for each reader; 131
  // adds a plugin installation key that is not a plugin id.
  const userSettings = writeJson({
    S117_TOP_LEVEL_NAME: 'S117_TOP_LEVEL_VALUE',
    env: { S117_ENV_NAME: 'S117_ENV_VALUE' },
    permissions: { allow: ['Bash(S117_PERMISSION_RULE)'], S117_NESTED_NAME: true },
    statusLine: { type: 'command', command: 'S117_STATUS_COMMAND' },
    enabledPlugins: { 'alpha@acme': true, S117_PLUGIN_KEY: true },
    skillOverrides: { S117_SKILL_NAME: 'off' },
    hooks: {
      PreToolUse: [{
        matcher: 'S117_MATCHER',
        S117_GROUP_FIELD: 'S117_GROUP_VALUE',
        hooks: [
          { type: 'command', command: 'node ~/.claude/hooks/guard.js --token=S117_COMMAND_ARG', S117_HOOK_FIELD: 1 },
          { type: 'command', command: 'bash ~/.claude/hooks/S117_MISSING_SCRIPT.sh' }
        ]
      }],
      Stop: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'S117_PROMPT' }] }],
      S117_EVENT_NAME: [{ hooks: [{ type: 'S117_HANDLER_TYPE', command: 'echo S117_UNKNOWN_EVENT_COMMAND' }] }]
    }
  })
  // The denied script sits in the project store, which no store report walks,
  // so only the hook check stats it.
  const projectSettings = writeJson({
    outputStyle: 'quiet',
    hooks: {
      PostToolUse: [{
        matcher: 'S117_PROJECT_MATCHER',
        hooks: [{ type: 'command', command: '.claude/hooks/S117_DENIED_SCRIPT.sh S117_PROJECT_ARG' }]
      }]
    }
  })

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    const install = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': userSettings,
      'hooks/guard.js': 'never executed\n',
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [{ scope: 'user', installPath: install, version: '1.0.0' }],
          S117_INSTALL_KEY: [{ scope: 'user', installPath: install, version: '1.0.0' }]
        }
      })
    })
    await registerMcp(world, {
      mcpServers: {
        registry: mcpServer({
          type: 'S117_TRANSPORT',
          env: { S117_MCP_ENV_NAME: 'S117_MCP_ENV_VALUE' },
          headers: { S117_HEADER_NAME: 'S117_HEADER_VALUE' }
        })
      },
      projects: {
        [workdir]: {
          mcpServers: {
            local: { type: 'streamable-http', url: 'https://example.invalid/S117_URL', headers: { Authorization: 'Bearer S117_BEARER' } }
          }
        }
      }
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': projectSettings,
      '.claude/hooks/S117_DENIED_SCRIPT.sh': 'never executed\n',
      '.claude/settings.local.json': '{"env":{"S117_MALFORMED_NAME":S117_MALFORMED_VALUE}}',
      '.mcp.json': '{"mcpServers":{"committed":{"env":{"S117_MCP_FILE_NAME":S117_MCP_FILE_VALUE}}}}'
    })
    await writeFileTree(world.kondoDataRoot, {
      'journal.jsonl': '{"id":"torn","steps":[{"insert":S117_JOURNAL_BYTES}]}\n'
    })
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('keeps every sentinel out of the public envelopes and refusals while healthy summaries remain', async () => {
    const flat = flattenPath(workdir)
    const projectId = `project:code:${flat}`
    const localLayer = `settings:local:${flat}`
    // Node's own message names the path the command chose.
    const stat = fs.stat.bind(fs)
    vi.spyOn(fs, 'stat').mockImplementation(async (target) => {
      if (String(target).includes('S117_DENIED_SCRIPT')) {
        throw Object.assign(new Error(`EACCES: permission denied, stat '${String(target)}'`), { code: 'EACCES' })
      }
      return stat(target)
    })
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const bytes = async (): Promise<string[]> => [
      await hashTree(world.userRoot),
      await hashTree(workdir),
      await fs.readFile(world.locator.userConfigFile, 'utf8'),
      await fs.readFile(journal, 'utf8')
    ]
    const before = await bytes()

    const envelopes = {
      settingsLayers: await api.settingsLayers(),
      settings: await api.entityList('settings'),
      hookGroups: await api.hooksList(),
      hooks: await api.entityList('hook'),
      projects: await api.projectsList(),
      globalDetail: await api.projectDetail('store:user:user'),
      projectDetail: await api.projectDetail(projectId),
      mcp: await api.entityList('mcp'),
      skills: await api.skillsList(),
      plugins: await api.pluginsList(),
      leftovers: await api.configOrphansPreview(),
      cleanup: await api.tidyPreview(),
      history: await api.journalList(),
      overview: await api.storesOverview()
    }
    const firstHook = envelopes.hookGroups.data[0]!.hooks[0]!
    const refusals = {
      hook: await api.entityMutate(firstHook.id, { op: 'disable' }),
      layer: await api.entityMutate(localLayer, { op: 'enable' }),
      plugin: await api.pluginToggle('plugin:alpha@acme', localLayer, 'enable'),
      mcp: await api.entityMutate(`mcp:local:${flat}/local`, { op: 'disable' })
    }

    expect(JSON.stringify({ envelopes, refusals }).match(/S117_\w*/g) ?? []).toEqual([])
    for (const refusal of Object.values(refusals)) {
      expect(refusal.data).toBeNull()
      expect(refusal.errors.length).toBeGreaterThan(0)
    }
    expect(await bytes()).toEqual(before)

    // Documented names and validated states stay useful beside the omissions.
    expect(envelopes.settingsLayers.data.map(({ layer, exists, keys, unlistedKeys }) => ({ layer, exists, keys, unlistedKeys })))
      .toEqual([
        { layer: 'user', exists: true, keys: ['env', 'permissions', 'statusLine', 'enabledPlugins', 'skillOverrides', 'hooks'], unlistedKeys: true },
        { layer: 'project', exists: true, keys: ['outputStyle', 'hooks'], unlistedKeys: false },
        { layer: 'local', exists: true, keys: [], unlistedKeys: false }
      ])
    expect(envelopes.hookGroups.data.flatMap((group) => group.hooks)
      .map(({ event, type, hasMatcher, script, layer }) => ({ event, type, hasMatcher, script, layer })))
      .toEqual([
        { event: 'PreToolUse', type: 'command', hasMatcher: true, script: 'present', layer: 'user' },
        { event: 'PreToolUse', type: 'command', hasMatcher: true, script: 'missing', layer: 'user' },
        { event: 'Stop', type: 'prompt', hasMatcher: false, script: null, layer: 'user' },
        { event: null, type: null, hasMatcher: false, script: null, layer: 'user' },
        // Its script exists but the stat is denied: missing, with an itemized error.
        { event: 'PostToolUse', type: 'command', hasMatcher: true, script: 'missing', layer: 'project' }
      ])
    const projectFile = (name: string): string => slashed(path.join(workdir, '.claude', name))
    expect(envelopes.hookGroups.errors).toEqual([
      { code: 'parse-failed', path: projectFile('settings.local.json'), message: INVALID_JSON },
      { code: 'stat-failed', path: projectFile('settings.json'), message: 'Kondo could not check a script this settings file names.' }
    ])
    // Two files, one entry each: the layer that decides this project's MCP
    // approval, and the declaration file itself. Neither is reported twice,
    // and the unreadable layer is why the declaration reads as unknown rather
    // than as on (entry 103).
    expect(envelopes.mcp.errors).toEqual([
      { code: 'parse-failed', path: projectFile('settings.local.json'), message: INVALID_JSON },
      { code: 'parse-failed', path: slashed(path.join(workdir, '.mcp.json')), message: INVALID_JSON }
    ])
    expect(
      (envelopes.mcp.data as McpServerInfo[]).map((server) => [server.name, server.status])
    ).toEqual([
      ['local', 'unknown'],
      ['registry', 'configured']
    ])
    expect(envelopes.globalDetail.data!.mcpServers.map(({ name, transport }) => ({ name, transport })))
      .toEqual([{ name: 'registry', transport: 'unknown' }])
    const detail = envelopes.projectDetail.data!
    expect(detail.mcpServers.map(({ name, transport }) => ({ name, transport }))).toEqual([{ name: 'local', transport: 'http' }])
    expect(detail.settings.map((layer) => layer.layer)).toEqual(['project', 'local'])
    expect(detail.hooks.map((hook) => hook.event)).toEqual(['PostToolUse'])
    expect(detail.row.counts.hooks).toBe(1)
    expect(envelopes.plugins.data.map((plugin) => [plugin.id, plugin.scopes.find((scope) => scope.layer === 'user')?.enabled]))
      .toEqual([['plugin:alpha@acme', true]])
    expect(envelopes.history).toEqual({
      data: [], errors: [{ code: 'parse-failed', path: 'journal.jsonl:1', message: INVALID_JSON }], unknown: []
    })
  })
})
