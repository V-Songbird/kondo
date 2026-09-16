import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  KondoApi,
  PluginInfo,
  PluginScopeState,
  ToggleOperation
} from '../shared/contract'
import { digestSource } from '../electron/main/workspace/mutations'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  recordWrites,
  registerProjects,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Settings planning and discovery remain available, but entry 098 refuses
 * apply and historical Undo before changing any fixture files or journal.
 */

const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

/** Claude's own manifest inside a plugin, relative to the plugin's folder. */
const PLUGIN_MANIFEST = '.claude-plugin/plugin.json'

const ALPHA = 'plugin:alpha@acme'
const GAMMA = 'plugin:gamma@acme'
const USER_LAYER = 'settings:user:user'

// Non-default formatting makes accidental settings rewrites visible.
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
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  // -------------------------------------------------------------------------
  // Refusal leaves the entire fixture unchanged

  it('refuses an existing plugin toggle without changing any fixture bytes', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses inserting an unmentioned plugin without creating history', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle(GAMMA, USER_LAYER, 'enable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses enabling an explicitly disabled plugin without changing its settings', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle('plugin:beta@acme', USER_LAYER, 'enable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses adding enabledPlugins to a project settings file', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle(ALPHA, `settings:project:${dirName}`, 'disable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Which layer wins

  it('ranks the layers local over project over user', async () => {
    expect((await plugin(ALPHA)).scopes.map((scope) => scope.layer)).toEqual([
      'local',
      'project',
      'user'
    ])
  })

  it('names the project each layer belongs to, by id and by label', async () => {
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

  it('resolves the winning layer per project, local over project over user', async () => {
    const owner = `project:code:${dirName}`
    const at = (info: PluginInfo, projectId: string | null): string | undefined =>
      info.effectiveIn.find((state) => state.projectId === projectId)?.layerId

    // Only the user layer speaks about alpha to begin with, so it stands both
    // for the user scope and, by falling through, inside the project.
    const first = await plugin(ALPHA)
    expect(at(first, null)).toBe(USER_LAYER)
    expect(at(first, owner)).toBe(USER_LAYER)

    await fs.writeFile(path.join(claudeDir, 'settings.json'), writeJson({ enabledPlugins: { 'alpha@acme': false } }))
    const withProject = await plugin(ALPHA)
    // The project override wins inside that project and nowhere else: the
    // user scope's own answer is untouched.
    expect(at(withProject, owner)).toBe(`settings:project:${dirName}`)
    expect(withProject.effectiveIn.find((state) => state.projectId === owner)?.enabled).toBe(
      false
    )
    expect(at(withProject, null)).toBe(USER_LAYER)
    expect(withProject.scopes.find((scope) => scope.layer === 'user')?.enabled).toBe(true)

    await fs.writeFile(path.join(claudeDir, 'settings.local.json'), writeJson({ enabledPlugins: { 'alpha@acme': true } }))
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

  it('refuses to create a missing layer until told to', async () => {
    const local = path.join(claudeDir, 'settings.local.json')
    const asked = await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable')

    expect(asked.data).toBeNull()
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    expect(asked.errors[0]?.message).toContain('settings.local.json')
    expect(await exists(local)).toBe(false)
    // Refused before anything was planned, so no journal entry exists.
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses creating a missing settings layer even after confirmation', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle(ALPHA, `settings:local:${dirName}`, 'enable', true)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Refused applies and preserved historical Undo entries

  it('preserves existing recovery history when a new toggle is refused', async () => {
    await writeFileTree(world.kondoDataRoot, {
      'journal.jsonl': JSON.stringify({
        id: UUID_A, at: '2026-09-08T00:00:00.000Z', op: 'settings-edit', kind: 'plugin',
        entityId: ALPHA, summary: 'Historical settings creation', undoOf: null,
        steps: [{ type: 'write', store: 'user', from: 'settings.json' }]
      }) + '\n'
    })
    const before = await hashTree(world.base)
    const history = await api.journalList()
    expect(history.errors).toEqual([])
    expect(history.data.map((entry) => entry.id)).toEqual(['journal:' + UUID_A])
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect(await api.journalList()).toEqual(history)
  })

  // Refusal must not create a success record or a displaced-file snapshot.
  it('does not create a journal or trash snapshot for a refused toggle', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it.each([false, true])('refuses historical splice Undo with external changes: %s', async (externalChange) => {
    const applied = USER_SETTINGS.replace('"alpha@acme": true', '"alpha@acme": false')
    const current = externalChange ? applied.replace('"dark"', '"external-theme"') : applied
    await fs.writeFile(userSettingsFile(), current)
    await writeFileTree(world.kondoDataRoot, {
      'journal.jsonl': JSON.stringify({
        id: UUID_A, at: '2026-09-08T00:00:00.000Z', op: 'settings-edit', kind: 'plugin',
        entityId: ALPHA, summary: 'Disable alpha', undoOf: null,
        steps: [{ type: 'splice', store: 'user', from: 'settings.json',
          expectDigest: digestSource(USER_SETTINGS), resultDigest: digestSource(applied),
          edits: [{ at: 0, remove: USER_SETTINGS.length, insert: applied }],
          undoEdits: [{ at: 0, remove: applied.length, insert: USER_SETTINGS }] }]
      }) + '\n'
    })
    const before = await hashTree(world.base)
    expect((await api.journalList()).data.map((entry) => entry.id)).toEqual(['journal:' + UUID_A])
    const undone = await api.journalUndo('journal:' + UUID_A)
    expect(undone.data).toBeNull()
    expect(undone.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect(await readUserSettings()).toBe(current)
    expect((await api.journalList()).data.map((entry) => entry.id)).toEqual(['journal:' + UUID_A])
  })
  it('preserves a historically created layer and its Undo history', async () => {
    const local = path.join(claudeDir, 'settings.local.json')
    await fs.writeFile(local, writeJson({ enabledPlugins: { 'alpha@acme': true } }))
    await writeFileTree(world.kondoDataRoot, {
      'journal.jsonl': JSON.stringify({
        id: UUID_A, at: '2026-09-08T00:00:00.000Z', op: 'settings-edit', kind: 'plugin',
        entityId: ALPHA, summary: 'Enable alpha', undoOf: null,
        steps: [{ type: 'write', store: 'project:' + dirName, from: 'settings.local.json' }]
      }) + '\n'
    })
    const before = await hashTree(world.base)
    const undone = await api.journalUndo('journal:' + UUID_A)
    expect(undone.data).toBeNull()
    expect(undone.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await exists(local)).toBe(true)
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data.map((entry) => entry.id)).toEqual(['journal:' + UUID_A])
  })

  it('refuses before opening any settings or journal file for writing', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      const result = await api.pluginToggle(ALPHA, USER_LAYER, 'disable')
      expect(result.data).toBeNull()
      expect(result.errors[0]?.message).toBe(SETTINGS_REFUSAL)
    } finally {
      for (const restore of restores) restore()
    }
    expect(touched).toEqual([])
  })

  it('does not write inside or outside the project when its settings toggle is refused', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      const result = await api.pluginToggle(ALPHA, 'settings:project:' + dirName, 'disable')
      expect(result.data).toBeNull()
      expect(result.errors[0]?.message).toBe(SETTINGS_REFUSAL)
    } finally {
      for (const restore of restores) restore()
    }
    expect(touched).toEqual([])
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

  it('gives a skills-directory plugin the same per-layer control as an installed one', async () => {
    // It loads with no installation record at all (domain.md), so its control
    // has to come from the settings layers alone, exactly as alpha's does.
    const folder = path.join(world.userRoot, 'skills', 'handy')
    await writeFileTree(folder, { [PLUGIN_MANIFEST]: writeJson({ name: 'handy' }) })
    const handy = await plugin('plugin:handy@skills-dir')

    expect(handy.source).toBe('skills-dir')
    expect(handy.installations).toEqual([])
    expect(handy.installed).toBe(true)
    expect(handy.scopes.map((scope) => scope.layer)).toEqual(
      (await plugin(ALPHA)).scopes.map((scope) => scope.layer)
    )

    const detail = await api.projectDetail(`project:code:${dirName}`)
    const here = detail.data?.plugins.find((state) => state.pluginId === handy.id)
    expect(here?.source).toBe('skills-dir')
    expect(here?.choice).toBe('inherit')
    expect(here?.capabilities.disable.allowed).toBe(true)
  })
})
