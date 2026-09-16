import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PluginScopeState } from '../shared/contract'
import { collector } from '../electron/main/workspace/scan'
import {
  hooksFromLayers,
  readPluginInventory,
  readSettingsLayers,
  scanPlugins,
  scanSkills,
  type VerifiedProject
} from '../electron/main/workspace/user-store'
import { makeWorld, skillManifest, writeFileTree, writeJson, type FixtureWorld } from './helpers'

describe('user store adapter', () => {
  let world: FixtureWorld
  let workdir: string
  let verified: VerifiedProject[]

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    verified = [{ dirName: 'X--work-proj', absPath: workdir }]

    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')
    const benchedInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'beta', '2.0.0')
    const escapedInstall = path.join(world.base, 'outside-the-store', 'omega', '1.0.0')
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
        enabledPlugins: { 'alpha@acme': true },
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
          UserPromptSubmit: [
            { matcher: '*', hooks: [{ type: 'command', command: 'node check.js' }] }
          ]
        },
        outputStyle: 'quiet'
      }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills/not-a-skill/README.md': 'no manifest here',
      'skills.disabled/beta-skill/SKILL.md': skillManifest('beta-skill', 'Benched skill'),
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [
            {
              scope: 'user',
              installPath: pluginInstall,
              version: '1.0.0',
              installedAt: '2026-01-01T00:00:00.000Z',
              lastUpdated: '2026-02-01T00:00:00.000Z'
            }
          ],
          'beta@acme': [{ scope: 'user', installPath: benchedInstall, version: '2.0.0' }],
          'omega@acme': [{ scope: 'user', installPath: escapedInstall, version: '1.0.0' }]
        }
      })
    })
    await writeFileTree(pluginInstall, {
      'skills/gamma-skill/SKILL.md': skillManifest('gamma-skill', 'Ships with plugin')
    })
    await writeFileTree(benchedInstall, {
      'skills/epsilon-skill/SKILL.md': skillManifest('epsilon-skill', 'From a disabled plugin')
    })
    await writeFileTree(escapedInstall, {
      'skills/rogue-skill/SKILL.md': skillManifest('rogue-skill', 'Should never be scanned')
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ enabledPlugins: {} }),
      '.claude/settings.local.json': writeJson({ hooks: {} }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped')
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('preserves other skill scopes when the user skill directory read is denied (ADR-0005)', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const denied = path.join(world.userRoot, 'skills')
    const readdir = fs.readdir
    const read = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      if (args[0] === denied) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return readdir(...args)
    })

    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)

    expect(read).toHaveBeenCalledWith(denied, { withFileTypes: true })
    expect(skills.map((skill) => skill.name).sort()).toEqual(['beta-skill', 'delta-skill'])
    expect(skills.find((skill) => skill.name === 'delta-skill')).toMatchObject({
      description: 'Project-scoped', scope: 'project'
    })
    expect(c.errors).toEqual([{
      code: 'read-failed', path: '~/.claude/skills', message: 'permission denied'
    }])
  })

  it('preserves a sibling skill when one manifest read is denied (ADR-0005)', async () => {
    await writeFileTree(world.userRoot, {
      'skills/healthy-skill/SKILL.md': skillManifest('healthy-skill', 'Readable sibling')
    })
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const denied = path.join(world.userRoot, 'skills', 'alpha-skill', 'SKILL.md')
    const readFile = fs.readFile
    const read = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (args[0] === denied) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return readFile(...args)
    })

    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)

    expect(read).toHaveBeenCalledWith(denied, 'utf8')
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      'beta-skill', 'delta-skill', 'healthy-skill'
    ])
    expect(skills.find((skill) => skill.name === 'healthy-skill')).toMatchObject({
      description: 'Readable sibling', scope: 'user'
    })
    expect(c.errors).toEqual([{
      code: 'read-failed',
      path: '~/.claude/skills/alpha-skill/SKILL.md',
      message: 'permission denied'
    }])
  })

  it('reads settings layers, including missing files as exists:false', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    expect(c.errors).toEqual([])
    expect(layers).toHaveLength(3)

    const user = layers.find((layer) => layer.info.layer === 'user')!
    expect(user.info.exists).toBe(true)
    expect(user.info.keys).toContain('enabledPlugins')
    expect(user.info.keys).toContain('outputStyle')

    expect(layers.find((layer) => layer.info.layer === 'project')!.info.exists).toBe(true)
    expect(layers.find((layer) => layer.info.layer === 'local')!.info.exists).toBe(true)
  })

  it('names the project every layer, hook and skill belongs to (ADR-0008)', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const owner = 'project:code:X--work-proj'

    // Attribution is a field on the DTO. Nothing downstream has to split
    // `settings:local:X--work-proj` to learn whose layer it is.
    expect(layers.find((layer) => layer.info.layer === 'user')!.info.projectId).toBeNull()
    expect(layers.find((layer) => layer.info.layer === 'project')!.info.projectId).toBe(owner)
    expect(layers.find((layer) => layer.info.layer === 'local')!.info.projectId).toBe(owner)

    // A hook takes the projectId of the layer that arms it.
    const hooks = await hooksFromLayers(layers, world.locator, verified, c)
    for (const hook of hooks) expect(hook.projectId).toBeNull()

    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)
    const delta = skills.find((skill) => skill.name === 'delta-skill')!
    expect(delta.projectId).toBe(owner)
    expect(skills.find((skill) => skill.name === 'alpha-skill')!.projectId).toBeNull()
    expect(skills.find((skill) => skill.name === 'beta-skill')!.projectId).toBeNull()
  })

  it('extracts hooks with event, handler type, matcher presence and source layer', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const hooks = await hooksFromLayers(layers, world.locator, verified, c)
    expect(hooks).toHaveLength(2)
    const submit = hooks.find((hook) => hook.event === 'UserPromptSubmit')!
    // `*` matches everything, so it narrows nothing (Claude's hooks reference).
    expect(submit).toMatchObject({ type: 'command', hasMatcher: false, layer: 'user' })
    expect(JSON.stringify(hooks)).not.toContain('check.js')
  })

  it('joins installed plugins with the settings layers that enable them', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const plugins = await scanPlugins(world.locator, layers, verified, c)
    // The fixture plants one plugin whose installPath escapes the store; it
    // is still listed, with its pointer refused. Everything else is clean.
    expect(c.errors.map((error) => error.code)).toEqual(['out-of-store'])
    expect(plugins).toHaveLength(3)

    const alpha = plugins.find((plugin) => plugin.info.id === 'plugin:alpha@acme')!.info
    expect(alpha.name).toBe('alpha')
    expect(alpha.marketplace).toBe('acme')
    expect(alpha.version).toBe('1.0.0')
    expect(alpha.enabledIn).toHaveLength(1)

    const beta = plugins.find((plugin) => plugin.info.id === 'plugin:beta@acme')!.info
    expect(beta.enabledIn).toEqual([])
  })

  it('reports a corrupt plugin registry as an error, not a crash (ADR-0005)', async () => {
    await writeFileTree(world.userRoot, { 'plugins/installed_plugins.json': '{not json' })
    const c = collector()
    const plugins = await scanPlugins(world.locator, [], [], c)
    expect(plugins).toEqual([])
    expect(c.errors.some((error) => error.code === 'parse-failed')).toBe(true)
  })

  it('names an incomplete plugin installation entry only by a plugin id (ADR-0022)', async () => {
    const install = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')
    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [{ scope: 'user', installPath: install, version: '1.0.0' }],
          'S131 key text': [{ scope: 'user', installPath: install, version: '1.0.0' }],
          'beta@acme': [{ scope: 'nowhere', installPath: install }]
        }
      })
    })
    const c = collector()
    const inventory = await readPluginInventory(world.locator, c)

    // A key outside the `<name>@<marketplace>` grammar is file text, so it is never named.
    expect(c.errors.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'parse-failed', message: 'Incomplete plugin installation entry with an unrecognized id; absence cannot be established.' },
      { code: 'parse-failed', message: 'Incomplete plugin installation entry for beta@acme; absence cannot be established.' }
    ])
    expect(inventory.completeness).toBe('partial')
    expect(Object.keys(inventory.plugins)).toEqual(['alpha@acme'])
  })

  it('catalogs the skills the user placed, in the user store and each project', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)

    const ids = skills.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids).toContain('skill:user-disabled:beta-skill')
    expect(ids).toContain('skill:project/X--work-proj:delta-skill')
    expect(ids.some((id) => id.includes('not-a-skill'))).toBe(false)

    const beta = skills.find((skill) => skill.id === 'skill:user-disabled:beta-skill')!
    expect(beta.enabled).toBe(false)
    expect(beta.description).toBe('Benched skill')
  })

  it('never lists a skill that ships inside a plugin', async () => {
    const c = collector()
    // The fixture's plugins do ship skills; none of them is the user's to
    // move or bench, so none of them crosses into the skills catalogue.
    const layers = await readSettingsLayers(world.locator, verified, c)
    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)
    expect(skills.some((skill) => skill.scope === 'plugin')).toBe(false)
    expect(skills.some((skill) => skill.name === 'gamma-skill')).toBe(false)
    expect(skills.some((skill) => skill.name === 'epsilon-skill')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // enabledPlugins members that are neither true nor false (ADR-0005, ADR-0021)

  /** One member per JSON shape a hand-edited settings file can hold. */
  const UNRECOGNIZED = {
    'str@acme': 'false',
    'num@acme': 0,
    'nul@acme': null,
    'arr@acme': ['alpha@acme'],
    'obj@acme': { enabled: true }
  }

  const layerState = (
    plugins: Awaited<ReturnType<typeof scanPlugins>>,
    key: string,
    layer: string
  ): PluginScopeState['enabled'] => {
    const found = plugins.find((plugin) => plugin.info.id === `plugin:${key}`)
    if (!found) throw new Error(`the scan has no row for ${key}`)
    const scope = found.info.scopes.find((candidate) => candidate.layer === layer)
    if (!scope) throw new Error(`${key} has no ${layer} layer`)
    return scope.enabled
  }

  it('reads an enabledPlugins member that is neither true nor false as unknown', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true, ...UNRECOGNIZED } })
    })
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const plugins = await scanPlugins(world.locator, layers, verified, c)

    // Claude's convention is a boolean (ADR-0006). Kondo cannot know what
    // Claude makes of anything else, so it says so rather than coercing.
    for (const key of Object.keys(UNRECOGNIZED)) {
      expect(layerState(plugins, key, 'user')).toBe('unknown')
      expect(
        plugins.find((plugin) => plugin.info.id === `plugin:${key}`)?.info.enabledIn
      ).toEqual([])
    }
    // The healthy sibling in the same file keeps its state and its listing.
    expect(layerState(plugins, 'alpha@acme', 'user')).toBe(true)
    expect(
      plugins.find((plugin) => plugin.info.id === 'plugin:alpha@acme')?.info.enabledIn
    ).toEqual(['~/.claude/settings.json'])
  })

  it('never lets an unrecognized member win precedence over a layer that speaks', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'beta@acme': false, ...UNRECOGNIZED } })
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ enabledPlugins: { 'beta@acme': 'true' } }),
      '.claude/settings.local.json': writeJson({ enabledPlugins: { 'beta@acme': 3 } })
    })
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const plugins = await scanPlugins(world.locator, layers, verified, c)
    const owner = 'project:code:X--work-proj'

    expect(layerState(plugins, 'beta@acme', 'project')).toBe('unknown')
    expect(layerState(plugins, 'beta@acme', 'local')).toBe('unknown')
    // Two unrecognized layers sit above the only one that states anything, so
    // the user layer's `false` is still what Claude honours here (ADR-0021).
    const beta = plugins.find((plugin) => plugin.info.id === 'plugin:beta@acme')
    expect(beta?.info.effectiveIn.find((state) => state.projectId === owner)).toEqual({
      projectId: owner, layerId: 'settings:user:user', enabled: false
    })
    // A plugin no layer states at all stays absent rather than resolving.
    expect(
      plugins.find((plugin) => plugin.info.id === 'plugin:str@acme')?.info.effectiveIn
    ).toEqual([])
  })

  it('itemizes one unrecognized member per layer without quoting its value (ADR-0022)', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
        enabledPlugins: {
          'alpha@acme': true,
          'str@acme': 'S129 value text',
          'S129 key text': 'S129 value text'
        }
      })
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ enabledPlugins: { 'num@acme': 1 } })
    })
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    await scanPlugins(world.locator, layers, verified, c)

    // A key outside the `<name>@<marketplace>` grammar is file text, so it is
    // never named — the same rule the installation records follow. The layers
    // are walked highest precedence first, so the project file reports before
    // the user one.
    const pathOf = (id: string): string => {
      const layer = layers.find((candidate) => candidate.info.id === id)
      if (!layer) throw new Error(`the scan has no ${id} layer`)
      return layer.info.path
    }
    const reported = c.errors.filter((error) => error.message.includes('enabledPlugins'))
    expect(reported).toEqual([
      {
        code: 'parse-failed',
        path: pathOf('settings:project:X--work-proj'),
        message: 'num@acme in enabledPlugins is neither true nor false; kondo cannot tell whether it is on or off here.'
      },
      {
        code: 'parse-failed',
        path: '~/.claude/settings.json',
        message: 'str@acme in enabledPlugins is neither true nor false; kondo cannot tell whether it is on or off here.'
      },
      {
        code: 'parse-failed',
        path: '~/.claude/settings.json',
        message: 'An enabledPlugins entry with an unrecognized id is neither true nor false; kondo cannot tell whether it is on or off here.'
      }
    ])
    expect(c.errors.some((error) => error.message.includes('S129 value text'))).toBe(false)
    expect(c.errors.some((error) => error.message.includes('S129 key text'))).toBe(false)
  })

  it('refuses to follow a plugin installPath outside the user store', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, [], c)
    const plugins = await scanPlugins(world.locator, layers, verified, c)

    // The check lives where the untrusted path is resolved, so the escaping
    // path is nulled for every consumer rather than at one call site.
    const rogue = plugins.find((plugin) => plugin.info.id === 'plugin:omega@acme')!
    expect(rogue.roots).toEqual([])
    // The record itself survives the refusal: it is a fact of the manifest.
    expect(rogue.info.installations.map((install) => install.followed)).toEqual([false])
    const refusal = c.errors.find((error) => error.code === 'out-of-store')
    expect(refusal?.message).toContain('plugin:omega@acme')
  })
})
