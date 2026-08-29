import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { EntityKind, KondoApi } from '../shared/contract'
import { capabilitiesFor, scopesFor } from '../electron/main/workspace/capabilities'
import { createKindContext, kinds, type KindContext } from '../electron/main/workspace/kinds'
import { collector } from '../electron/main/workspace/scan'
import { scanSessionInventory } from '../electron/main/workspace/sessions'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  makeWorld,
  skillManifest,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The kind registry and the capability matrix. Two things are under test:
 * every kind supplies the same five members, and write permission is a
 * lookup on kind × scope × operation that a single boolean could not hold.
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

  it('every kind supplies discover, read, capabilities, enable and disable', () => {
    const entries = Object.entries(kinds)
    expect(entries.length).toBeGreaterThan(0)
    for (const [name, definition] of entries) {
      expect(typeof definition.discover, `${name}.discover`).toBe('function')
      expect(typeof definition.read, `${name}.read`).toBe('function')
      expect(typeof definition.capabilities, `${name}.capabilities`).toBe('function')
      expect(typeof definition.enable, `${name}.enable`).toBe('function')
      expect(typeof definition.disable, `${name}.disable`).toBe('function')
      expect(definition.scopes.length, `${name}.scopes`).toBeGreaterThan(0)
    }
  })

  it('discovers skills across every scope and resolves one back by its id', async () => {
    const skills = (await kinds.skill.discover(await context())) ?? []
    const ids = skills.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids).toContain('skill:user-disabled:beta-skill')
    expect(ids).toContain('skill:plugin/alpha@acme:gamma-skill')

    const found = await kinds.skill.read('skill:user:alpha-skill', await context())
    expect(found?.name).toBe('alpha-skill')
    expect(await kinds.skill.read('skill:user:not-here', await context())).toBeNull()
  })

  it('returns null for a parent id that no longer resolves (ADR-0008)', async () => {
    expect(await kinds.session.discover(await context('project:code:D--Not-There'))).toBeNull()
    expect(await kinds.session.discover(await context())).toBeNull()
  })

  it('builds a plan only where the matrix permits one', async () => {
    const skills = (await kinds.skill.discover(await context())) ?? []
    const benched = skills.find((skill) => skill.scope === 'user-disabled')!
    expect(benched.capabilities.enable.allowed).toBe(true)
    expect(kinds.skill.enable(benched)?.steps).toEqual([
      { type: 'move', store: 'user', from: 'skills.disabled/beta-skill', to: 'skills/beta-skill' }
    ])
    // The same entity, the direction the matrix refuses: no plan at all.
    expect(kinds.skill.disable(benched)).toBeNull()

    // A kind whose mutation has not shipped keeps its unwired seat.
    const layers = (await kinds.settings.discover(await context())) ?? []
    expect(kinds.settings.disable(layers[0]!)).toBeNull()
  })

  // -------------------------------------------------------------------------
  // The matrix

  it('keys permission on kind, scope and operation rather than one flag', () => {
    // One kind, one operation, opposite answers in two scopes — the pair no
    // single boolean on the entity could have held.
    expect(capabilitiesFor('skill', 'user').disable.allowed).toBe(true)
    expect(capabilitiesFor('skill', 'plugin').disable.allowed).toBe(false)
    // One kind, one scope, opposite answers for the two operations.
    expect(capabilitiesFor('skill', 'user').enable.allowed).toBe(false)
    expect(capabilitiesFor('skill', 'user-disabled').enable.allowed).toBe(true)
    // One scope, one operation, opposite answers for two kinds.
    expect(capabilitiesFor('plugin', 'user').disable.allowed).toBe(true)
    expect(capabilitiesFor('hook', 'user').disable.allowed).toBe(false)
  })

  it('refuses both hook operations because Claude has no convention (ADR-0006)', () => {
    const row = capabilitiesFor('hook', 'user')
    expect(row.enable.allowed).toBe(false)
    expect(row.disable.reason).toContain('no convention')
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
    for (const hook of hooks.data) {
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
})
