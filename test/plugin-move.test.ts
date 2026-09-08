import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, PluginInfo } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
import { digestSource } from '../electron/main/workspace/mutations'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  registerProjects,
  UUID_A,
  UUID_B,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * A plugin move plans settings edits in two scopes. Entry 098 refuses the
 * complete plan, including confirmed creation, before either layer changes.
 */

const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

const ALPHA = 'plugin:alpha@acme'
const BETA = 'plugin:beta@acme'
const USER_LAYER = 'settings:user:user'

const USER_SETTINGS = `{
    "theme": "dark",
    "enabledPlugins": {
        "alpha@acme": true,
        "beta@acme": false
    }
}
`

// States a value for alpha, so this is the layer the destination policy picks
// — the same rule the scope's own toggle target follows.
const PROJECT_SETTINGS = `{
  "permissions": { "allow": ["Bash(ls:*)"] },
  "enabledPlugins": { "alpha@acme": false }
}
`

describe('moving a plugin between scopes (ADR-0006)', () => {
  let world: FixtureWorld
  let workdir: string
  let dirName: string
  let blankClaude: string
  let blankName: string
  let api: KondoApi

  const userSettingsFile = (): string => path.join(world.userRoot, 'settings.json')
  const readUserSettings = (): Promise<string> => fs.readFile(userSettingsFile(), 'utf8')
  const blankLocalFile = (): string => path.join(blankClaude, 'settings.local.json')

  const plugin = async (id: string): Promise<PluginInfo> => {
    const found = (await api.pluginsList()).data.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`fixture has no ${id}`)
    return found
  }

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    dirName = flattenPath(workdir)
    const blankDir = path.join(world.base, 'work', 'blank')
    blankClaude = path.join(blankDir, '.claude')
    blankName = flattenPath(blankDir)
    const installOf = (name: string): string =>
      path.join(world.userRoot, 'plugins', 'cache', 'acme', name, '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${dirName}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${blankName}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      'settings.json': USER_SETTINGS,
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [{ scope: 'user', installPath: installOf('alpha'), version: '1.0.0' }],
          'beta@acme': [{ scope: 'user', installPath: installOf('beta'), version: '2.0.0' }]
        }
      })
    })
    await writeFileTree(workdir, { '.claude/settings.json': PROJECT_SETTINGS })
    // A verified project with a store and not one settings file in it: the
    // destination whose layer has to be created before it can hold anything.
    await fs.mkdir(blankClaude, { recursive: true })
    await registerProjects(world, [workdir, blankDir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  // -------------------------------------------------------------------------
  // The two-step plan

  it('refuses both settings edits without modifying either scope', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('preserves every key and formatting in both refused move layers', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it.each([false, true])('preserves both historical move layers during refused Undo, created destination: %s', async (created) => {
    const userAfter = USER_SETTINGS.replace('"alpha@acme": true', '"alpha@acme": false')
    const projectAfter = PROJECT_SETTINGS.replace('"alpha@acme": false', '"alpha@acme": true')
    const destination = created ? blankLocalFile() : path.join(workdir, '.claude', 'settings.json')
    await fs.writeFile(userSettingsFile(), userAfter)
    await fs.writeFile(destination, projectAfter)
    const sourceStep = {
      type: 'splice', store: 'user', from: 'settings.json',
      expectDigest: digestSource(USER_SETTINGS), resultDigest: digestSource(userAfter),
      edits: [{ at: 0, remove: USER_SETTINGS.length, insert: userAfter }],
      undoEdits: [{ at: 0, remove: userAfter.length, insert: USER_SETTINGS }]
    }
    const destinationStep = created
      ? { type: 'write', store: 'project:' + blankName, from: 'settings.local.json' }
      : { type: 'splice', store: 'project:' + dirName, from: 'settings.json',
          expectDigest: digestSource(PROJECT_SETTINGS), resultDigest: digestSource(projectAfter),
          edits: [{ at: 0, remove: PROJECT_SETTINGS.length, insert: projectAfter }],
          undoEdits: [{ at: 0, remove: projectAfter.length, insert: PROJECT_SETTINGS }] }
    await writeFileTree(world.kondoDataRoot, {
      'journal.jsonl': JSON.stringify({
        id: UUID_A, at: '2026-09-08T00:00:00.000Z', op: 'settings-edit', kind: 'plugin',
        entityId: ALPHA, summary: 'Move alpha', undoOf: null,
        steps: [sourceStep, destinationStep]
      }) + '\n'
    })
    const before = await hashTree(world.base)
    const history = await api.journalList()
    expect(history.errors).toEqual([])
    expect(history.data.map((entry) => entry.id)).toEqual(['journal:' + UUID_A])
    const undone = await api.journalUndo('journal:' + UUID_A)
    expect(undone.data).toBeNull()
    expect(undone.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect(await fs.readFile(destination, 'utf8')).toBe(projectAfter)
    expect(await api.journalList()).toEqual(history)
  })

  // -------------------------------------------------------------------------
  // A destination settings file is created only on confirmation

  it('refuses a destination with no settings file until told to', async () => {
    const userBefore = await readUserSettings()
    const asked = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${blankName}`)

    expect(asked.data).toBeNull()
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    expect(asked.errors[0]?.message).toContain('settings.local.json')
    // Nothing written anywhere: not the file it asked about, and not the
    // source it would have withdrawn from.
    expect(await exists(blankLocalFile())).toBe(false)
    expect(await readUserSettings()).toBe(userBefore)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses confirmed destination creation before changing the source', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${blankName}`, true)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('leaves the destination absent and history empty after refusal', async () => {
    const before = await hashTree(world.base)
    const result = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${blankName}`, true)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  // -------------------------------------------------------------------------
  // The capability the matrix now allows

  it('allows move on a plugin in every settings layer', async () => {
    for (const scope of ['user', 'project', 'local']) {
      const row = capabilitiesFor('plugin', scope)
      expect(row.move.allowed, scope).toBe(true)
      expect(row.move.reason, scope).toBeNull()
    }
    expect((await plugin(ALPHA)).capabilities.move.allowed).toBe(true)
  })

  it('no longer tells anyone that only skills move', () => {
    // A hook is not on this list any more (entry 036): its `hooks` object is
    // read in every layer, so a move is a two-layer settings edit kondo has
    // not built rather than one Claude's conventions forbid.
    for (const kind of ['settings', 'session', 'mcp'] as const) {
      const scope = kind === 'session' ? 'code' : 'user'
      const reason = capabilitiesFor(kind, scope).move.reason ?? ''
      expect(reason, kind).not.toContain('Only skills')
      expect(reason, kind).toContain('not something kondo can move')
    }
    const hook = capabilitiesFor('hook', 'user').move.reason ?? ''
    expect(hook).not.toContain('Only skills')
    expect(hook).not.toContain('not something kondo can move')
  })

  // -------------------------------------------------------------------------
  // Refusals

  it('refuses a source layer that does not enable the plugin', async () => {
    const before = await readUserSettings()
    const result = await api.pluginMove(BETA, USER_LAYER, `project:code:${dirName}`)
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['not-permitted'])
    expect(result.errors[0]?.message).toContain('does not enable')
    expect(await readUserSettings()).toBe(before)
  })

  it('repeated refused moves preserve the enabled source and empty history', async () => {
    const before = await hashTree(world.base)
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await api.pluginMove(ALPHA, USER_LAYER, 'project:code:' + dirName)
      expect(result.data).toBeNull()
      expect(result.errors).toEqual([
        expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
      ])
    }
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a destination nothing in the scan answers to', async () => {
    const result = await api.pluginMove(ALPHA, USER_LAYER, 'project:code:nowhere')
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['unknown-id'])
  })

  it('validates the ids at the seam', async () => {
    expect((await api.pluginMove('not-a-plugin', USER_LAYER, 'user')).errors[0]?.code).toBe(
      'bad-request'
    )
    expect((await api.pluginMove(ALPHA, 'nope', 'user')).errors[0]?.code).toBe('bad-request')
    expect((await api.pluginMove(ALPHA, USER_LAYER, '')).errors[0]?.code).toBe('bad-request')
  })

  it('refuses a project that has no .claude to write into', async () => {
    const homeless = path.join(world.base, 'work', 'homeless')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(homeless)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A)
    })
    await registerProjects(world, [workdir, path.dirname(blankClaude), homeless])
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })
    const result = await fresh.pluginMove(
      ALPHA,
      USER_LAYER,
      `project:code:${flattenPath(homeless)}`
    )
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['bad-request'])
    expect(result.errors[0]?.message).toContain('no .claude directory')
  })
})
