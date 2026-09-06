import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  KondoApi,
  PluginInfo,
  PluginScopeState,
  ToggleOperation
} from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  recordWrites,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Enable and disable a plugin through Claude's own convention (ADR-0006):
 * the `enabledPlugins` key of one settings layer, edited in place so the
 * file's other keys and its formatting survive byte-for-byte, journaled
 * first and therefore reversible (ADR-0001).
 *
 * A project path is reconstructed from its flattened directory name, which
 * cannot round-trip hyphens — the project half needs a hyphen-free tmpdir.
 */
const TMP_OK = !os.tmpdir().includes('-')

const ALPHA = 'plugin:alpha@acme'
const GAMMA = 'plugin:gamma@acme'
const USER_LAYER = 'settings:user:user'

// Four-space indent, a key before and a key after, and a nested object: any
// reserialize would visibly rewrite this, so equality proves the splice.
const USER_SETTINGS = `{
    "theme": "dark",
    "env": {
        "KONDO_FIXTURE": "yes"
    },
    "enabledPlugins": {
        "alpha@acme": true,
        "beta@acme": false
    },
    "permissions": {
        "allow": []
    }
}
`

const PROJECT_SETTINGS = `{
  "permissions": { "allow": ["Bash(ls:*)"] }
}
`

describe('plugin enable/disable per settings layer (ADR-0006)', () => {
  let world: FixtureWorld
  let workdir: string
  let claudeDir: string
  let dirName: string
  let api: KondoApi

  const userSettingsFile = (): string => path.join(world.userRoot, 'settings.json')
  const readUserSettings = (): Promise<string> => fs.readFile(userSettingsFile(), 'utf8')

  const plugin = async (id: string): Promise<PluginInfo> => {
    const found = (await api.pluginsList()).data.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`fixture has no ${id}`)
    return found
  }

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    claudeDir = path.join(workdir, '.claude')
    dirName = flattenPath(workdir)
    const installOf = (name: string): string =>
      path.join(world.userRoot, 'plugins', 'cache', 'acme', name, '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${dirName}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': USER_SETTINGS,
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          // Real install paths: `scanPlugins` refuses one that escapes the
          // user store, so a placeholder would read as a rogue plugin.
          'alpha@acme': [{ scope: 'user', installPath: installOf('alpha'), version: '1.0.0' }],
          'beta@acme': [{ scope: 'user', installPath: installOf('beta'), version: '2.0.0' }],
          'gamma@acme': [{ scope: 'user', installPath: installOf('gamma'), version: '3.0.0' }]
        }
      })
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': PROJECT_SETTINGS,
      'src/secret.ts': 'export const apiKey = "never-read-me"'
    })

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  // -------------------------------------------------------------------------
  // The edit touches enabledPlugins and nothing else

  it('flips one value and leaves every other byte of the file alone', async () => {
    const before = await readUserSettings()
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(result.errors).toEqual([])
    expect(result.data?.op).toBe('settings-edit')

    expect(await readUserSettings()).toBe(
      before.replace('"alpha@acme": true', '"alpha@acme": false')
    )
  })

  it('inserts a plugin the layer never mentioned, in the file own indentation', async () => {
    const before = await readUserSettings()
    const result = await api.pluginToggle(GAMMA, USER_LAYER, 'enable')
    expect(result.errors).toEqual([])

    expect(await readUserSettings()).toBe(
      before.replace(
        '"beta@acme": false',
        '"beta@acme": false,\n        "gamma@acme": true'
      )
    )
  })

  it('keeps every unrelated key, value and ordering intact', async () => {
    const before = JSON.parse(await readUserSettings()) as Record<string, unknown>
    await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    const after = JSON.parse(await readUserSettings()) as Record<string, unknown>

    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const key of Object.keys(before)) {
      if (key === 'enabledPlugins') continue
      expect(after[key]).toEqual(before[key])
    }
    // And inside enabledPlugins, only the one plugin moved.
    expect(after['enabledPlugins']).toEqual({ 'alpha@acme': false, 'beta@acme': false })
  })

  it.runIf(TMP_OK)('adds enabledPlugins to a layer that has no such key', async () => {
    const file = path.join(claudeDir, 'settings.json')
    const before = await fs.readFile(file, 'utf8')
    const result = await api.pluginToggle(ALPHA, `settings:project:${dirName}`, 'disable')
    expect(result.errors).toEqual([])

    expect(await fs.readFile(file, 'utf8')).toBe(
      before.replace(
        '"permissions": { "allow": ["Bash(ls:*)"] }',
        '"permissions": { "allow": ["Bash(ls:*)"] },\n  "enabledPlugins": { "alpha@acme": false }'
      )
    )
  })

  // -------------------------------------------------------------------------
  // Which layer wins

  it.runIf(TMP_OK)('ranks the layers local over project over user', async () => {
    expect((await plugin(ALPHA)).scopes.map((scope) => scope.layer)).toEqual([
      'local',
      'project',
      'user'
    ])
  })

  it.runIf(TMP_OK)('names the project each layer belongs to, by id and by label', async () => {
    // Two layers per project all read "project" and "local"; the owning
    // project is the only thing that tells one project's pair from another's,
    // and the id is what tells apart two projects sharing a folder name.
    const scopes = (await plugin(ALPHA)).scopes
    const at = (layer: string): PluginScopeState =>
      scopes.find((scope) => scope.layer === layer) as PluginScopeState
    expect(at('user').projectId).toBeNull()
    expect(at('user').projectLabel).toBeNull()
    expect(at('project').projectId).toBe(`project:code:${dirName}`)
    expect(at('local').projectId).toBe(`project:code:${dirName}`)
    expect(at('project').projectLabel).toBe('proj')
    expect(at('local').projectLabel).toBe('proj')
  })

  it.runIf(TMP_OK)('resolves the winning layer per project, local over project over user', async () => {
    const owner = `project:code:${dirName}`
    const at = (info: PluginInfo, projectId: string | null): string | undefined =>
      info.effectiveIn.find((state) => state.projectId === projectId)?.layerId

    // Only the user layer speaks about alpha to begin with, so it stands both
    // for the user scope and, by falling through, inside the project.
    const first = await plugin(ALPHA)
    expect(at(first, null)).toBe(USER_LAYER)
    expect(at(first, owner)).toBe(USER_LAYER)

    await api.pluginToggle(ALPHA, `settings:project:${dirName}`, 'disable')
    const withProject = await plugin(ALPHA)
    // The project override wins inside that project and nowhere else: the
    // user scope's own answer is untouched.
    expect(at(withProject, owner)).toBe(`settings:project:${dirName}`)
    expect(withProject.effectiveIn.find((state) => state.projectId === owner)?.enabled).toBe(
      false
    )
    expect(at(withProject, null)).toBe(USER_LAYER)
    expect(withProject.scopes.find((scope) => scope.layer === 'user')?.enabled).toBe(true)

    await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable', true)
    const withLocal = await plugin(ALPHA)
    expect(at(withLocal, owner)).toBe(`settings:local:${dirName}`)
    expect(withLocal.effectiveIn.find((state) => state.projectId === owner)?.enabled).toBe(true)
  })

  it('says no layer wins when none mentions the plugin', async () => {
    expect((await plugin(GAMMA)).effectiveIn).toEqual([])
    expect((await plugin(GAMMA)).enabledIn).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A layer is created only on confirmation

  it.runIf(TMP_OK)('refuses to create a missing layer until told to', async () => {
    const local = path.join(claudeDir, 'settings.local.json')
    const asked = await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable')

    expect(asked.data).toBeNull()
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    expect(asked.errors[0]?.message).toContain('settings.local.json')
    expect(await exists(local)).toBe(false)
    // Refused before anything was planned, so no journal entry exists.
    expect((await api.journalList()).data).toEqual([])
  })

  it.runIf(TMP_OK)('creates the layer once confirmed, holding only that key', async () => {
    const local = path.join(claudeDir, 'settings.local.json')
    const result = await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable', true)
    expect(result.errors).toEqual([])

    expect(await fs.readFile(local, 'utf8')).toBe(
      '{\n  "enabledPlugins": {\n    "alpha@acme": true\n  }\n}\n'
    )
    expect((await api.journalList()).data).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Reversibility (ADR-0001)

  it('restores the settings file byte-for-byte when the edit is undone', async () => {
    const before = await hashTree(world.userRoot)
    const done = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // ADR-0010. A whole-file write would discard whatever Claude appended
  // between the scan and the write, and undo it a second time by restoring a
  // snapshot taken before that. The step carries a digest instead.
  it('journals the edit rather than a snapshot, so the undo can invert it', async () => {
    const done = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(done.errors).toEqual([])

    const journal = await fs.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'), 'utf8')
    const record = JSON.parse(journal.trim().split('\n').at(-1) as string)
    const step = record.steps.at(-1)
    expect(step.edits).toHaveLength(1)
    expect(typeof step.expectDigest).toBe('string')
    expect(step.undoEdits).toHaveLength(1)
    // Nothing was parked in the trash, so there is no snapshot to go stale.
    expect(step.displaced).toBeUndefined()
    expect((await api.trashSize()).data.entryCount).toBe(0)
  })

  it('refuses to undo onto a settings file something else has since written', async () => {
    const done = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(done.errors).toEqual([])

    // Claude, mid-session, adding a key of its own to the same file.
    const theirs = (await readUserSettings()).replace('{', '{\n  "theme": "dark",')
    await fs.writeFile(userSettingsFile(), theirs, 'utf8')

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.map((error) => error.code)).toContain('stale-file')
    // The whole point of the guard: their key is still there.
    expect(await readUserSettings()).toBe(theirs)
  })
  it.runIf(TMP_OK)('undoes a created layer back out of existence', async () => {
    const before = await hashTree(claudeDir)
    const done = await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable', true)
    expect(done.errors).toEqual([])

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await exists(path.join(claudeDir, 'settings.local.json'))).toBe(false)
    expect(await hashTree(claudeDir)).toBe(before)
  })

  it('appends the journal entry before the settings file changes', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)
    try {
      const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
      expect(result.errors).toEqual([])
    } finally {
      for (const restore of restores) restore()
    }

    const journalAt = ordered.indexOf(path.join(world.kondoDataRoot, 'journal.jsonl'))
    const storeAt = ordered.findIndex((target) => target.startsWith(userSettingsFile()))
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the settings file was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
  })

  it.runIf(TMP_OK)('never writes outside the project .claude directory', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      await api.pluginToggle(ALPHA, `settings:project:${dirName}`, 'disable')
    } finally {
      for (const restore of restores) restore()
    }

    const inside = (target: string, root: string): boolean => {
      const rel = path.relative(root, target)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    expect(touched.length).toBeGreaterThan(0)
    for (const target of touched) {
      const allowed = inside(target, claudeDir) || inside(target, world.kondoDataRoot)
      expect(allowed, `escaped the boundary: ${target}`).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // Refusals

  it('refuses the direction the layer is already in', async () => {
    const before = await readUserSettings()
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'enable')
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['not-permitted'])
    expect(await readUserSettings()).toBe(before)
  })

  it('refuses a free-form path, an unknown id, an unknown layer and a bad operation', async () => {
    const before = await readUserSettings()

    const asPath = await api.pluginToggle(userSettingsFile(), USER_LAYER, 'disable')
    expect(asPath.errors.map((error) => error.code)).toContain('bad-request')

    const notALayer = await api.pluginToggle(ALPHA, world.userRoot, 'disable')
    expect(notALayer.errors.map((error) => error.code)).toContain('bad-request')

    const ghost = await api.pluginToggle('plugin:nope@acme', USER_LAYER, 'disable')
    expect(ghost.errors.map((error) => error.code)).toContain('unknown-id')

    const ghostLayer = await api.pluginToggle(ALPHA, 'settings:project:nowhere', 'disable')
    expect(ghostLayer.errors.map((error) => error.code)).toContain('unknown-id')

    const sideways = await api.pluginToggle(
      ALPHA,
      USER_LAYER,
      'sideways' as ToggleOperation
    )
    expect(sideways.errors.map((error) => error.code)).toContain('bad-request')

    expect(await readUserSettings()).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a settings file that is not JSON rather than rewriting it', async () => {
    await fs.writeFile(userSettingsFile(), '{ this is not json', 'utf8')
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'enable')

    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('parse-failed')
    expect(await readUserSettings()).toBe('{ this is not json')
  })
})
