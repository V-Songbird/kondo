import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import type {
  EntityKind,
  KondoApi,
  MutateRequest,
  ToggleOperation
} from '../shared/contract'
import { capabilitiesFor, scopesFor } from '../electron/main/workspace/capabilities'
import {
  configOrphans,
  configOrphansPlan,
  createKindContext,
  kinds,
  listingFor,
  listingForId,
  listings,
  type KindContext
} from '../electron/main/workspace/kinds'
import { collector } from '../electron/main/workspace/scan'
import { scanSessionInventory } from '../electron/main/workspace/sessions'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  hashTree,
  makeWorld,
  skillManifest,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The kind registry and the capability matrix. Three things are under test:
 * every kind supplies the same three members, write permission is a lookup on
 * kind × scope × operation that a single boolean could not hold, and one
 * generic channel reaches every kind by the prefix of its id (ADR-0008) while
 * the shipped channels keep working as aliases over it (ADR-0004).
 */

describe('kind registry and capability matrix', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')

    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
        enabledPlugins: { 'alpha@acme': true },
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }]
        }
      }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills.disabled/beta-skill/SKILL.md': skillManifest('beta-skill', 'Benched skill'),
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [{ scope: 'user', installPath: pluginInstall, version: '1.0.0' }]
        }
      })
    })
    await writeFileTree(pluginInstall, {
      'skills/gamma-skill/SKILL.md': skillManifest('gamma-skill', 'Ships with plugin')
    })
    await writeFileTree(world.desktopRoot, {
      'local-agent-mode-sessions/device-1/account-1/local_session-a.json': writeJson({ a: 1 })
    })

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  /** A fresh context per call — the layer and plugin reads memoize inside one. */
  const context = async (parentId?: string): Promise<KindContext> => {
    const c = collector()
    const scan = await scanSessionInventory(world.locator, process.platform)
    return createKindContext({
      locator: world.locator,
      c,
      now: Date.now(),
      inventory: async () => scan.data,
      projects: async () => [{ dirName: 'X--work-proj', absPath: workdir }],
      parentId
    })
  }

  // -------------------------------------------------------------------------
  // The registry

  it('every kind supplies discover, read and one plan seat', () => {
    const entries = Object.entries(kinds)
    expect(entries.length).toBeGreaterThan(0)
    for (const [name, definition] of entries) {
      expect(typeof definition.discover, `${name}.discover`).toBe('function')
      expect(typeof definition.read, `${name}.read`).toBe('function')
      expect(typeof definition.plan, `${name}.plan`).toBe('function')
    }
  })

  it('gives every registry entry a listing row, and every row a live entry', () => {
    const registered = new Set<unknown>(Object.values(kinds))
    // Same set both ways: an entry with no row is unreachable by id, and a
    // row pointing at nothing would dispatch into the void.
    expect(new Set<unknown>(listings.map((listing) => listing.definition))).toEqual(registered)
    for (const listing of listings) {
      expect(listing.idPrefix.startsWith(`${listing.kind}:`), listing.idPrefix).toBe(true)
    }
  })

  it('discovers skills across every scope and resolves one back by its id', async () => {
    const skills = (await kinds.skill.discover(await context())) ?? []
    const ids = skills.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids).toContain('skill:user-disabled:beta-skill')
    // A plugin's own skills are the plugin's, and are not catalogued here.
    expect(ids).not.toContain('skill:plugin/alpha@acme:gamma-skill')

    const found = await kinds.skill.read('skill:user:alpha-skill', await context())
    expect(found?.name).toBe('alpha-skill')
    expect(await kinds.skill.read('skill:user:not-here', await context())).toBeNull()
  })

  it('returns null for a parent id that no longer resolves (ADR-0008)', async () => {
    expect(await kinds.session.discover(await context('project:code:D--Not-There'))).toBeNull()
    expect(await kinds.session.discover(await context())).toBeNull()
  })

  it('builds a plan only where the matrix permits one, and keeps its reason', async () => {
    const shared = await context()
    const skills = (await kinds.skill.discover(shared)) ?? []
    const benched = skills.find((skill) => skill.scope === 'user-disabled')!
    expect(benched.capabilities.enable.allowed).toBe(true)

    const enabled = await kinds.skill.plan(benched, { op: 'enable' }, shared)
    expect(enabled.ok && enabled.plan.steps).toEqual([
      { type: 'move', store: 'user', from: 'skills.disabled/beta-skill', to: 'skills/beta-skill' }
    ])

    // The same entity, the direction the matrix refuses: no plan, and the
    // matrix's own words rather than a generic error (ADR-0006).
    const refused = await kinds.skill.plan(benched, { op: 'disable' }, shared)
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.code).toBe('not-permitted')
    expect(refused.ok === false && refused.message).toBe(
      capabilitiesFor('skill', 'user-disabled').disable.reason
    )

    // A kind with no mechanism answers the same way, in its own row's words.
    const layers = (await kinds.settings.discover(shared)) ?? []
    const layer = await kinds.settings.plan(layers[0]!, { op: 'disable' }, shared)
    expect(layer.ok === false && layer.message).toContain('not a toggle')
  })

  // -------------------------------------------------------------------------
  // The matrix

  it('keys permission on kind, scope and operation rather than one flag', () => {
    // One kind, one operation, opposite answers in two scopes — the pair no
    // single boolean on the entity could have held.
    expect(capabilitiesFor('skill', 'user').disable.allowed).toBe(true)
    // The plugins view does list plugin-scoped skills now (`kinds.pluginSkill`),
    // and this row is what keeps that listing read-only.
    expect(capabilitiesFor('skill', 'plugin').disable.allowed).toBe(false)
    expect(capabilitiesFor('skill', 'plugin').move.allowed).toBe(false)
    // One kind, one scope, opposite answers for the two operations.
    expect(capabilitiesFor('skill', 'user').enable.allowed).toBe(false)
    expect(capabilitiesFor('skill', 'user-disabled').enable.allowed).toBe(true)
    // One scope, one operation, opposite answers for two kinds.
    expect(capabilitiesFor('plugin', 'user').disable.allowed).toBe(true)
    expect(capabilitiesFor('hook', 'user').disable.allowed).toBe(false)
  })

  it('gives a hook move its own reason, apart from the toggle refusal', () => {
    // The old row called a two-layer settings edit impossible. Both toggles
    // are refused because Claude has no convention (ADR-0006); the move is
    // refused because kondo has not built it, and the two must not read the
    // same or the UI states a falsehood about what Claude allows.
    const row = capabilitiesFor('hook', 'user')
    expect(row.move.allowed).toBe(false)
    expect(row.move.reason).not.toBe(row.enable.reason)
    expect(row.move.reason).not.toBe(row.disable.reason)
    expect(row.move.reason).toMatch(/not built yet/)
  })

  it('refuses both hook operations because Claude has no convention (ADR-0006)', () => {
    const row = capabilitiesFor('hook', 'user')
    expect(row.enable.allowed).toBe(false)
    expect(row.disable.reason).toContain('no way to switch off one hook')
  })

  it('degrades to read-only on a scope it has not learned (ADR-0005)', () => {
    const row = capabilitiesFor('skill', 'from-a-newer-claude')
    expect(row.enable.allowed).toBe(false)
    expect(row.disable.allowed).toBe(false)
    expect(row.disable.reason).toContain('from-a-newer-claude')
  })

  it('gives every refusal a reason and every permission none', () => {
    const registered = new Set<EntityKind>(
      Object.values(kinds).map((definition) => definition.kind)
    )
    for (const kind of registered) {
      for (const scope of scopesFor(kind)) {
        for (const decision of Object.values(capabilitiesFor(kind, scope))) {
          const where = `${kind}/${scope}`
          if (decision.allowed) expect(decision.reason, where).toBeNull()
          else expect(decision.reason, where).toBeTruthy()
        }
      }
    }
  })

  // -------------------------------------------------------------------------
  // What the renderer receives

  it('stamps every listed entity with its kind and its matrix row', async () => {
    const skills = await api.skillsList()
    expect(skills.data.length).toBeGreaterThan(0)
    for (const skill of skills.data) {
      expect(skill.kind).toBe('skill')
      expect(skill.capabilities).toEqual(capabilitiesFor('skill', skill.scope))
    }

    const plugins = await api.pluginsList()
    for (const plugin of plugins.data) {
      expect(plugin.kind).toBe('plugin')
      expect(plugin.capabilities).toEqual(capabilitiesFor('plugin', plugin.installScope))
    }

    const hooks = await api.hooksList()
    expect(hooks.data.length).toBeGreaterThan(0)
    for (const hook of hooks.data.flatMap((group) => group.hooks)) {
      expect(hook.kind).toBe('hook')
      expect(hook.capabilities).toEqual(capabilitiesFor('hook', hook.layer))
    }

    const layers = await api.settingsLayers()
    for (const layer of layers.data) {
      expect(layer.kind).toBe('settings')
      expect(layer.capabilities).toEqual(capabilitiesFor('settings', layer.layer))
    }

    const desktop = await api.desktopSessions()
    expect(desktop.data.length).toBeGreaterThan(0)
    for (const entry of desktop.data) {
      expect(entry.kind).toBe('session')
      expect(entry.capabilities).toEqual(capabilitiesFor('session', 'desktop'))
    }
  })

  // -------------------------------------------------------------------------
  // Dispatch by the id's kind prefix (ADR-0008)

  it('picks the registry entry from the id prefix, longest match winning', () => {
    expect(listingForId('skill:user:alpha-skill')?.definition).toBe(kinds.skill)
    // The longer prefix wins, so a plugin's own skill never reaches the
    // user's listing — where it would look mutable.
    expect(listingForId('skill:plugin/alpha@acme:gamma-skill')?.definition).toBe(
      kinds.pluginSkill
    )
    expect(listingForId('session:code:X--work-proj/abc')?.definition).toBe(kinds.session)
    expect(listingForId('session:desktop:device-1/account-1/a')?.definition).toBe(
      kinds.desktopSession
    )
    expect(listingForId('plugin:alpha@acme')?.definition).toBe(kinds.plugin)
    expect(listingForId('output-style:user:terse')?.definition).toBe(kinds.outputStyle)
    // An id no kind claims dispatches nowhere rather than to a default.
    expect(listingForId('nonesuch:user:thing')).toBeNull()
  })

  it('picks a listing by kind, and by the parent id when one is given', () => {
    expect(listingFor('skill')?.definition).toBe(kinds.skill)
    expect(listingFor('skill', 'plugin:alpha@acme')?.definition).toBe(kinds.pluginSkill)
    expect(listingFor('session')?.definition).toBe(kinds.desktopSession)
    expect(listingFor('session', 'project:code:X--work-proj')?.definition).toBe(kinds.session)
    // A parent of the wrong shape has no listing rather than the wrong one.
    expect(listingFor('session', 'plugin:alpha@acme')).toBeNull()
    expect(listingFor('hook', 'plugin:alpha@acme')).toBeNull()
  })

  it('mutates through one channel, and refuses in the matrix words', async () => {
    // The skill kind: the prefix picks it, and the plan is applied.
    const enabled = await api.entityMutate('skill:user-disabled:beta-skill', { op: 'enable' })
    expect(enabled.errors).toEqual([])
    expect(enabled.data?.summary).toContain('Enable skill beta-skill')

    // A different kind down the same channel, refused by its own row rather
    // than by a branch in the workspace.
    const layers = await api.settingsLayers()
    const layer = await api.entityMutate(layers.data[0]!.id, { op: 'disable' })
    expect(layer.data).toBeNull()
    expect(layer.errors[0]?.code).toBe('not-permitted')
    expect(layer.errors[0]?.message).toContain('not a toggle')

    // An id whose kind nothing claims, and an op that is not one.
    const nowhere = await api.entityMutate('nonesuch:user:thing', { op: 'enable' })
    expect(nowhere.errors[0]?.code).toBe('bad-request')
    const notAnOp = await api.entityMutate('skill:user:alpha-skill', {
      op: 'clear'
    } as unknown as MutateRequest)
    expect(notAnOp.errors[0]?.code).toBe('bad-request')
  })

  // -------------------------------------------------------------------------
  // The shipped channels, now aliases (ADR-0004)

  it('answers the shipped listing channels with entityList', async () => {
    expect((await api.skillsList()).data).toEqual((await api.entityList('skill')).data)
    // The one shipped listing that is not a pass-through: it groups what
    // `entityList` returns flat, so the members are what has to match.
    expect((await api.hooksList()).data.flatMap((group) => group.hooks)).toEqual(
      (await api.entityList('hook')).data
    )
    expect((await api.settingsLayers()).data).toEqual((await api.entityList('settings')).data)
    expect((await api.pluginsList()).data).toEqual((await api.entityList('plugin')).data)
    expect((await api.desktopSessions()).data).toEqual((await api.entityList('session')).data)

    const pluginId = (await api.pluginsList()).data[0]!.id
    expect((await api.pluginSkills(pluginId)).data).toEqual(
      (await api.entityList('skill', pluginId)).data
    )
    // The parentless guard the alias kept: its own message, not the generic
    // listing's.
    expect((await api.pluginSkills('skill:user:alpha-skill')).errors[0]?.message).toContain(
      'expects a plugin: id'
    )
  })

  it('answers the shipped mutation channels with entityMutate', async () => {
    const layerId = (await api.settingsLayers()).data[0]!.id
    // Same refusal from the alias and from the generic call — the plugin
    // toggle's layer travels as targetId either way.
    const viaAlias = await api.pluginToggle('plugin:alpha@acme', layerId, 'enable')
    const viaGeneric = await api.entityMutate('plugin:alpha@acme', {
      op: 'enable',
      targetId: layerId
    })
    expect(viaAlias.errors).toEqual(viaGeneric.errors)
    expect(viaAlias.data).toBeNull()

    // `move` was never legal on skillToggle and still is not, even though
    // entityMutate accepts it.
    const sideways = await api.skillToggle(
      'skill:user:alpha-skill',
      'move' as unknown as ToggleOperation
    )
    expect(sideways.errors[0]?.code).toBe('bad-request')
    expect(sideways.errors[0]?.message).toContain('enable or disable')
  })
})


describe('conservative configuration inventory (100)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const manifest = (plugins: Record<string, unknown> = {}) => writeJson({ version: 2, plugins })
  const installed = () => ({ 'alpha@acme': [{ scope: 'user',
    installPath: path.join(world.userRoot, 'plugins/cache/acme/alpha/1') }] })
  const preview = () => api.configOrphansPreview()

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'ghost@acme': false,
        'my-tool@skills-dir': false, 'session@inline': false, 'cloud@synced': false,
        'future@new-source': false, 'unqualified': false },
        skillOverrides: { doctor: 'off', deploy: 'off', 'nested:release': 'off',
          'future-bundled-skill': 'off', 'alpha:helper': 'off' } }),
      'plugins/installed_plugins.json': manifest(installed()),
      'plugins/known_marketplaces.json': writeJson({ acme: { source: { source: 'directory', path: './marketplace' } } }),
      'skills/my-tool/.claude-plugin/plugin.json': writeJson({ name: 'my-tool' }),
      'commands/deploy.md': 'Deploy the fixture',
      'commands/nested/release.md': 'Release the fixture'
    })
    await fs.writeFile(world.locator.userConfigFile, writeJson({ projects: {
      [path.join(world.base, 'gone')]: { mcpServers: { unused: { command: 'fixture' } } }
    } }))
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => { await world.cleanup() })

  it('preserves directory plugins, session sources, commands and all skill preferences', async () => {
    const result = await preview()
    expect(result.errors).toEqual([])
    expect(result.data.filter((r) => r.kind === 'enabled-plugin').map((r) => r.name)).toEqual(['ghost@acme'])
    expect(result.data.some((r) => r.kind === 'skill-override')).toBe(false)
    const plugins = await api.pluginsList()
    expect(plugins.data.filter((r) => !r.installed).map((r) => r.id)).toEqual(['plugin:ghost@acme'])
    expect(plugins.data.some((r) => r.id === 'plugin:alpha@acme' && r.installed)).toBe(true)
  })

  it.each([undefined, '{broken', 'null', '[]', '{}', '{"version":2,"plugins":[]}',
    '{"version":2,"plugins":null}', '{"plugins":{}}'])('does not infer absence from unavailable manifest %s', async (source) => {
    const file = path.join(world.userRoot, 'plugins/installed_plugins.json')
    if (source === undefined) await fs.unlink(file)
    else await fs.writeFile(file, source)
    const result = await preview()
    expect(result.data.map((r) => r.kind).sort()).toEqual(['mcp-declaration', 'project-entry'])
    if (source !== undefined) expect(result.errors.length).toBeGreaterThan(0)
  })

  it('keeps healthy plugin rows while malformed sibling installs withhold absence', async () => {
    await writeFileTree(world.userRoot, { 'plugins/installed_plugins.json': manifest({
      ...installed(), 'broken@acme': [null], 'shapeless@acme': { installPath: 'unknown' }
    }) })
    const plugins = await api.pluginsList()
    expect(plugins.data.map((r) => r.id)).toEqual(['plugin:alpha@acme'])
    expect(plugins.errors.length).toBeGreaterThanOrEqual(2)
    expect((await preview()).data.map((r) => r.kind).sort()).toEqual(['mcp-declaration', 'project-entry'])
  })

  it('keeps readable entries of unsupported versions without making absence claims', async () => {
    await writeFileTree(world.userRoot, { 'plugins/installed_plugins.json': writeJson({ version: 99, plugins: installed() }) })
    const plugins = await api.pluginsList()
    expect(plugins.data.map((r) => r.id)).toEqual(['plugin:alpha@acme'])
    expect(plugins.errors.length).toBeGreaterThan(0)
    expect((await preview()).data.some((r) => r.kind === 'enabled-plugin')).toBe(false)
  })

  it('treats a complete empty manifest as absence only for a recognized marketplace', async () => {
    await writeFileTree(world.userRoot, { 'plugins/installed_plugins.json': manifest() })
    expect((await preview()).data.filter((r) => r.kind === 'enabled-plugin').map((r) => r.name)).toEqual(['ghost@acme'])
    await fs.unlink(path.join(world.userRoot, 'plugins/known_marketplaces.json'))
    expect((await preview()).data.some((r) => r.kind === 'enabled-plugin')).toBe(false)
  })

  it('does not treat a non-boolean or legacy plugin preference as removable', async () => {
    for (const enabledPlugins of [{ 'ghost@acme': { future: false } }, ['ghost@acme']]) {
      await writeFileTree(world.userRoot, { 'settings.json': writeJson({ enabledPlugins }) })
      expect((await preview()).data.some((r) => r.kind === 'enabled-plugin')).toBe(false)
    }
  })

  it('preserves proved project candidates when the plugin file cannot be read', async () => {
    const file = path.join(world.userRoot, 'plugins/installed_plugins.json')
    await fs.unlink(file)
    await fs.mkdir(file)
    const result = await preview()
    expect(result.errors.some((r) => r.code === 'read-failed')).toBe(true)
    expect(result.data.map((r) => r.kind).sort()).toEqual(['mcp-declaration', 'project-entry'])
  })

  it('revalidates a degraded manifest before planning and refuses the entire mixed choice', async () => {
    const before = await preview()
    const ids = before.data.filter((r) => r.kind === 'project-entry' || r.kind === 'enabled-plugin').map((r) => r.id)
    await writeFileTree(world.userRoot, { 'plugins/installed_plugins.json': '{broken' })
    const scan = await scanSessionInventory(world.locator, process.platform)
    const c = collector()
    const context = createKindContext({ locator: world.locator, c, now: Date.now(),
      inventory: async () => scan.data, projects: async () => [] })
    expect(configOrphansPlan(await configOrphans(context), ids)).toMatchObject({ ok: false, code: 'unknown-id' })
    const hash = await hashTree(world.base)
    const result = await api.configOrphansRemove(ids)
    expect(result.data).toBeNull()
    expect(result.errors.some((r) => r.code === 'unknown-id')).toBe(true)
    expect(await hashTree(world.base)).toBe(hash)
    expect((await api.journalList()).data).toEqual([])
  })

  it('rechecks a registered project recreated after preview before planning removal', async () => {
    const before = await preview()
    const ids = before.data.filter((r) => r.kind === 'project-entry' || r.kind === 'mcp-declaration' || r.kind === 'enabled-plugin').map((r) => r.id)
    expect(ids).toHaveLength(3)
    // This changes neither the registry nor user/projects, the cache fingerprint.
    await fs.mkdir(path.join(world.base, 'gone'))
    const hash = await hashTree(world.base)
    const result = await api.configOrphansRemove(ids)
    expect(result.data).toBeNull()
    expect(result.errors.some((r) => r.code === 'unknown-id')).toBe(true)
    expect(await hashTree(world.base)).toBe(hash)
    expect((await api.journalList()).data).toEqual([])
    expect((await preview()).data.some((r) => r.kind === 'project-entry' || r.kind === 'mcp-declaration')).toBe(false)
  })

  it('retains the 098 refusal for a proved absent marketplace plugin', async () => {
    const candidate = (await preview()).data.find((r) => r.name === 'ghost@acme')!
    const hash = await hashTree(world.base)
    const result = await api.configOrphansRemove([candidate.id])
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted' })])
    expect(await hashTree(world.base)).toBe(hash)
    expect((await api.journalList()).data).toEqual([])
  })
})
