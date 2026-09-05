import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slashed } from '../electron/main/workspace/display'
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
  armedHookScripts,
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

    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
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
      }),
      'hooks/present.sh': 'echo hi\n',
      // On disk, armed by nothing — the tidy category's whole subject.
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

    expect(find(hooks, 'SessionStart').script).toEqual({
      path: '~/.claude/hooks/present.sh',
      status: 'present'
    })
    expect(find(hooks, 'PreToolUse').script).toEqual({
      path: '~/.claude/hooks/gone.sh',
      status: 'missing'
    })
    // The token exactly as the command wrote it: a path kondo refused to
    // resolve is not a path it may restate as one of its own (ADR-0002).
    expect(find(hooks, 'Stop').script).toEqual({
      path: '$CLAUDE_PLUGIN_ROOT/scripts/gate.js',
      status: 'unverifiable'
    })
    // An inline command names no script, and null is the honest answer —
    // not a third status covering two different facts.
    expect(find(hooks, 'Notification').script).toBeNull()

    // A project layer's relative path resolves against that project, which
    // is the directory Claude runs its hooks in.
    const guard = find(hooks, 'PostToolUse').script!
    expect(guard.status).toBe('present')
    expect(guard.path).toBe(slashed(path.join(workdir, '.claude', 'hooks', 'guard.sh')))
    expect(find(hooks, 'SubagentStop').script).toEqual({
      path: OUTSIDE,
      status: 'unverifiable'
    })
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
    vi.spyOn(fsp, 'stat').mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' })
    )
    const hooks = await hooksFromLayers(layers, world.locator, verified, c)

    // Every hook is still listed, and the failure is itemized beside them.
    expect(hooks).toHaveLength(6)
    expect(find(hooks, 'SessionStart').script?.status).toBe('missing')
    expect(c.errors.some((error) => error.code === 'stat-failed')).toBe(true)
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

  it('offers a hook script no settings layer runs, and never the armed one', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['unarmed-hook-scripts'].count).toBe(1)
    expect(found['unarmed-hook-scripts'].examples).toEqual(['~/.claude/hooks/unarmed.sh'])
    expect(found['unarmed-hook-scripts'].bytes).toBeGreaterThan(0)

    const offered = (await api.tidyPreview()).data.categories.flatMap((entry) => entry.examples)
    expect(offered).not.toContain('~/.claude/hooks/present.sh')
    // The sweep names paths relative to one store, so a project's own
    // `hooks/` is never a candidate here.
    expect(offered.some((target) => target.includes('guard.sh'))).toBe(false)
  })

  it('counts a script armed from any layer as armed', async () => {
    const { layers } = await layersFor()
    const armed = armedHookScripts(layers, world.locator, verified)

    expect(armed.size).toBe(3)
    expect(armed.has(path.resolve(world.userRoot, 'hooks', 'present.sh').toLowerCase())).toBe(
      true
    )
    // Armed and absent is still armed: the set is what commands name, not
    // what exists.
    expect(armed.has(path.resolve(world.userRoot, 'hooks', 'gone.sh').toLowerCase())).toBe(true)
    expect(armed.has(path.resolve(world.userRoot, 'hooks', 'unarmed.sh').toLowerCase())).toBe(
      false
    )
  })

  it('stops offering a script the moment a layer arms it', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/unarmed.sh' }] }
          ]
        }
      })
    })
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })
    const found = byCategory((await fresh.tidyPreview()).data)

    // `present.sh` is now the unarmed one, and `unarmed.sh` is not offered.
    expect(found['unarmed-hook-scripts'].examples).toEqual(['~/.claude/hooks/present.sh'])
  })
})
