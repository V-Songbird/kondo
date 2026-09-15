import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  HookInfo,
  KondoApi,
  TidyCategory,
  TidyCategoryPreview,
  TidyPreview
} from '../shared/contract'
import { collector } from '../electron/main/workspace/scan'
import {
  hooksFromLayers,
  readSettingsLayers,
  type SettingsLayer,
  type VerifiedProject
} from '../electron/main/workspace/user-store'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  flattenPath,
  makeWorld,
  registerProjects,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Hooks: whose project each one belongs to, and whether the script it runs
 * is actually there. A settings layer arming a script that is not on disk is
 * a hook Claude fails every time it fires, and nothing else in the store
 * says so — but finding that out may not cost a look outside the boundary
 * ADR-0002 draws, so a path kondo cannot place is reported and never statted.
 */

/** A command whose script kondo may not resolve: it names a shell variable. */
const PLUGIN_COMMAND = 'node "$CLAUDE_PLUGIN_ROOT/scripts/gate.js"'

/** An absolute path in neither store — refused on the string, never probed. */
const OUTSIDE =
  process.platform === 'win32' ? 'C:\\elsewhere\\hooks\\rogue.sh' : '/elsewhere/hooks/rogue.sh'

function byCategory(preview: TidyPreview): Record<TidyCategory, TidyCategoryPreview> {
  const found = {} as Record<TidyCategory, TidyCategoryPreview>
  for (const entry of preview.categories) found[entry.category] = entry
  return found
}

describe('hooks, their scripts, and the scripts nothing arms', () => {
  let world: FixtureWorld
  let workdir: string
  let verified: VerifiedProject[]
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    verified = [{ dirName: flattenPath(workdir), absPath: workdir }]

    const settings = writeJson({
      hooks: {
        // Armed and there.
        SessionStart: [
          { hooks: [{ type: 'command', command: '~/.claude/hooks/present.sh' }] }
        ],
        // Armed and gone — the finding this whole field exists for.
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/gone.sh' }] }
        ],
        // A path kondo does not expand.
        Stop: [{ hooks: [{ type: 'command', command: PLUGIN_COMMAND }] }],
        // No script at all: an inline command names none, and null says so.
        Notification: [{ hooks: [{ type: 'command', command: 'echo hello' }] }]
      }
    })
    await writeFileTree(world.userRoot, {
      'settings.json': settings,
      'hooks/present.sh': 'echo hi\n',
      // No inventoried declaration names this file; it must still be kept.
      'hooks/unarmed.sh': 'echo nobody runs me\n'
    })

    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({
        hooks: {
          // Relative, and a project layer's hook runs with that project as
          // its directory — so this one does resolve, inside `.claude`.
          PostToolUse: [
            { hooks: [{ type: 'command', command: '.claude/hooks/guard.sh' }] }
          ],
          SubagentStop: [{ hooks: [{ type: 'command', command: OUTSIDE }] }]
        }
      }),
      '.claude/hooks/guard.sh': 'echo guard\n'
    })
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const layersFor = async (): Promise<{ layers: SettingsLayer[]; hooks: HookInfo[] }> => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    return { layers, hooks: await hooksFromLayers(layers, world.locator, verified, c) }
  }

  const find = (hooks: HookInfo[], event: string): HookInfo =>
    hooks.find((hook) => hook.event === event)!

  // -------------------------------------------------------------------------
  // Script health

  it('reports a script that is there, one that is gone, and one it may not place', async () => {
    const { hooks } = await layersFor()

    expect(find(hooks, 'SessionStart').script).toBe('present')
    expect(find(hooks, 'PreToolUse').script).toBe('missing')
    // A variable kondo does not expand is reported, never resolved (ADR-0002).
    expect(find(hooks, 'Stop').script).toBe('unverifiable')
    // An inline command names no script, and null is the honest answer —
    // not a third status covering two different facts.
    expect(find(hooks, 'Notification').script).toBeNull()

    // A project layer's relative path resolves against that project, which
    // is the directory Claude runs its hooks in.
    expect(find(hooks, 'PostToolUse').script).toBe('present')
    expect(find(hooks, 'SubagentStop').script).toBe('unverifiable')
    expect(find(hooks, 'PreToolUse')).toMatchObject({ type: 'command', hasMatcher: true })

    // Only statuses cross: no command, script token or resolved path (ADR-0022).
    const serialized = JSON.stringify(hooks)
    for (const fragment of ['present.sh', 'gone.sh', 'CLAUDE_PLUGIN_ROOT', 'gate.js', 'echo hello', 'guard.sh', 'rogue.sh', 'Bash']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it('never stats a path outside the stores, even to find out it is absent', async () => {
    const stat = vi.spyOn(fsp, 'stat')
    await layersFor()

    const probed = stat.mock.calls
      .map((call) => call[0])
      .filter((target): target is string => typeof target === 'string')
    expect(probed.some((target) => target.includes('present.sh'))).toBe(true)
    // Both unverifiable rows: the variable was never expanded and the
    // outside path was never followed.
    expect(probed.some((target) => target.includes('elsewhere'))).toBe(false)
    expect(probed.some((target) => target.includes('CLAUDE_PLUGIN_ROOT'))).toBe(false)
    expect(probed.some((target) => target.includes('gate.js'))).toBe(false)
  })

  it('degrades rather than dies when a script cannot be statted (ADR-0005)', async () => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, verified, c)
    // Node's own message names the path, which the command chose.
    vi.spyOn(fsp, 'stat').mockImplementation(async (target) => {
      throw Object.assign(new Error(`EACCES: permission denied, stat '${String(target)}'`), { code: 'EACCES' })
    })
    const hooks = await hooksFromLayers(layers, world.locator, verified, c)

    // Every hook is still listed, and the failure is itemized beside them.
    expect(hooks).toHaveLength(6)
    expect(find(hooks, 'SessionStart').script).toBe('missing')
    // The error names the settings file in Kondo's words, never the script (ADR-0022).
    expect(c.errors).toContainEqual({
      code: 'stat-failed',
      path: '~/.claude/settings.json',
      message: 'Kondo could not check a script this settings file names.'
    })
    const serialized = JSON.stringify(c.errors)
    for (const fragment of ['present.sh', 'guard.sh', 'EACCES', 'permission denied']) {
      expect(serialized).not.toContain(fragment)
    }
  })

  // -------------------------------------------------------------------------
  // Grouping

  it('returns hooks grouped by the project whose layer arms them', async () => {
    const groups = (await api.hooksList()).data
    expect(groups).toHaveLength(2)

    const [global, project] = groups
    expect(global!.projectId).toBeNull()
    expect(global!.label).toBe('Global')
    expect(global!.hooks.map((hook) => hook.event).sort()).toEqual(
      ['Notification', 'PreToolUse', 'SessionStart', 'Stop'].sort()
    )

    expect(project!.projectId).toBe(`project:code:${flattenPath(workdir)}`)
    // The folder name, so a row says which project without splitting an id.
    expect(project!.label).toBe('proj')
    expect(project!.hooks.map((hook) => hook.event).sort()).toEqual([
      'PostToolUse',
      'SubagentStop'
    ])
    for (const hook of project!.hooks) {
      expect(hook.projectId).toBe(`project:code:${flattenPath(workdir)}`)
    }
  })

  // -------------------------------------------------------------------------
  // Scripts nothing arms

  it('retains scripts even when no inventoried settings layer names them', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['unarmed-hook-scripts'].count).toBe(0)
    expect(found['unarmed-hook-scripts'].examples).toEqual([])
    expect(found['unarmed-hook-scripts'].bytes).toBe(0)
    expect(found['unarmed-hook-scripts'].blocked).toContain('cannot establish')

    const offered = (await api.tidyPreview()).data.categories.flatMap((entry) => entry.examples)
    expect(offered).not.toContain('~/.claude/hooks/present.sh')
    // The sweep names paths relative to one store, so a project's own
    // `hooks/` is never a candidate here.
    expect(offered.some((target) => target.includes('guard.sh'))).toBe(false)
  })

  it('retains all scripts after the declared references change', async () => {
    const settings = writeJson({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/unarmed.sh' }] }
        ]
      }
    })
    await writeFileTree(world.userRoot, { 'settings.json': settings })
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })
    const found = byCategory((await fresh.tidyPreview()).data)

    expect(found['unarmed-hook-scripts'].examples).toEqual([])
    expect(found['unarmed-hook-scripts'].blocked).toContain('cannot establish')
  })
})
