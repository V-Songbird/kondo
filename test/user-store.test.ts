import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { collector } from '../electron/main/workspace/scan'
import {
  hooksFromLayers,
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
    await world.cleanup()
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

  it('extracts hooks with event, matcher, and source layer', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const hooks = hooksFromLayers(layers)
    expect(hooks).toHaveLength(2)
    const submit = hooks.find((hook) => hook.event === 'UserPromptSubmit')!
    expect(submit.matcher).toBe('*')
    expect(submit.command).toBe('node check.js')
    expect(submit.layer).toBe('user')
  })

  it('joins installed plugins with the settings layers that enable them', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const plugins = await scanPlugins(world.locator, layers, c)
    expect(c.errors).toEqual([])
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
    const plugins = await scanPlugins(world.locator, [], c)
    expect(plugins).toEqual([])
    expect(c.errors.some((error) => error.code === 'parse-failed')).toBe(true)
  })

  it('catalogs skills across user, disabled, plugin, and project scopes', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    const plugins = await scanPlugins(world.locator, layers, c)
    const skills = await scanSkills(world.locator, verified, plugins, c)

    const ids = skills.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids).toContain('skill:user-disabled:beta-skill')
    expect(ids).toContain('skill:plugin/alpha@acme:gamma-skill')
    expect(ids).toContain('skill:project/X--work-proj:delta-skill')
    expect(ids.some((id) => id.includes('not-a-skill'))).toBe(false)

    const beta = skills.find((skill) => skill.id === 'skill:user-disabled:beta-skill')!
    expect(beta.enabled).toBe(false)
    expect(beta.description).toBe('Benched skill')

    const epsilon = skills.find((skill) => skill.id === 'skill:plugin/beta@acme:epsilon-skill')!
    expect(epsilon.enabled).toBe(false)
  })

  it('refuses to follow a plugin installPath outside the user store', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, [], c)
    const plugins = await scanPlugins(world.locator, layers, c)
    const skills = await scanSkills(world.locator, [], plugins, c)

    expect(skills.some((skill) => skill.id.includes('rogue-skill'))).toBe(false)
    const refusal = c.errors.find((error) => error.code === 'out-of-store')
    expect(refusal?.message).toContain('plugin:omega@acme')
  })
})
