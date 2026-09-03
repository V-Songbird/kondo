import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { KondoApi, PluginInfo } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  UUID_A,
  UUID_B,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Handing a plugin from one scope to another (ADR-0006): not a relocation —
 * nothing installed moves — but the two statements Claude's `enabledPlugins`
 * convention is made of, a `false` where it was and a `true` where it goes.
 *
 * Both edits are one plan and therefore one journal entry, so ADR-0001's undo
 * puts the pair of files back together or not at all.
 *
 * A project path is reconstructed from its flattened directory name, which
 * cannot round-trip hyphens — the project half needs a hyphen-free tmpdir.
 */
const TMP_OK = !os.tmpdir().includes('-')

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
  let claudeDir: string
  let dirName: string
  let blankClaude: string
  let blankName: string
  let api: KondoApi

  const userSettingsFile = (): string => path.join(world.userRoot, 'settings.json')
  const readUserSettings = (): Promise<string> => fs.readFile(userSettingsFile(), 'utf8')
  const projectSettingsFile = (): string => path.join(claudeDir, 'settings.json')
  const blankLocalFile = (): string => path.join(blankClaude, 'settings.local.json')

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

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  // -------------------------------------------------------------------------
  // The two-step plan

  it.runIf(TMP_OK)('writes false where it was and true where it goes, in one entry', async () => {
    const userBefore = await readUserSettings()
    const projectBefore = await fs.readFile(projectSettingsFile(), 'utf8')

    const done = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    expect(done.errors).toEqual([])
    expect(done.data?.op).toBe('settings-edit')
    expect(done.data?.kind).toBe('plugin')
    // One plan, two writes — the whole point of ADR-0001 here.
    expect(done.data?.stepCount).toBe(2)

    expect(await readUserSettings()).toBe(
      userBefore.replace('"alpha@acme": true', '"alpha@acme": false')
    )
    expect(await fs.readFile(projectSettingsFile(), 'utf8')).toBe(
      projectBefore.replace('"alpha@acme": false', '"alpha@acme": true')
    )
    // One operation, so one entry to undo.
    expect((await api.journalList()).data).toHaveLength(1)
  })

  it.runIf(TMP_OK)('leaves every other key in both files alone', async () => {
    const before = JSON.parse(await readUserSettings()) as Record<string, unknown>
    await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    const after = JSON.parse(await readUserSettings()) as Record<string, unknown>

    expect(after['theme']).toEqual(before['theme'])
    expect(after['enabledPlugins']).toEqual({ 'alpha@acme': false, 'beta@acme': false })
    const project = JSON.parse(await fs.readFile(projectSettingsFile(), 'utf8')) as Record<
      string,
      unknown
    >
    expect(project['permissions']).toEqual({ allow: ['Bash(ls:*)'] })
  })

  it.runIf(TMP_OK)('restores both files byte-for-byte when the move is undone', async () => {
    const userBefore = await hashTree(world.userRoot)
    const projectBefore = await hashTree(claudeDir)

    const done = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    expect(done.errors).toEqual([])
    expect(await hashTree(claudeDir)).not.toBe(projectBefore)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(userBefore)
    expect(await hashTree(claudeDir)).toBe(projectBefore)
  })

  // -------------------------------------------------------------------------
  // A destination settings file is created only on confirmation

  it.runIf(TMP_OK)('refuses a destination with no settings file until told to', async () => {
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

  it.runIf(TMP_OK)('creates the destination layer once confirmed, holding only that key', async () => {
    const before = await readUserSettings()
    const done = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${blankName}`, true)
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(2)

    expect(await fs.readFile(blankLocalFile(), 'utf8')).toBe(
      '{\n  "enabledPlugins": {\n    "alpha@acme": true\n  }\n}\n'
    )
    expect(await readUserSettings()).toBe(
      before.replace('"alpha@acme": true', '"alpha@acme": false')
    )
  })

  it.runIf(TMP_OK)('undoes a created destination layer back out of existence', async () => {
    const userBefore = await hashTree(world.userRoot)
    const done = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${blankName}`, true)
    expect(done.errors).toEqual([])

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await exists(blankLocalFile())).toBe(false)
    expect(await hashTree(world.userRoot)).toBe(userBefore)
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
      expect(reason, kind).toContain('does not move between scopes')
    }
    const hook = capabilitiesFor('hook', 'user').move.reason ?? ''
    expect(hook).not.toContain('Only skills')
    expect(hook).not.toContain('does not move between scopes')
  })

  // -------------------------------------------------------------------------
  // Refusals

  it.runIf(TMP_OK)('refuses a source layer that does not enable the plugin', async () => {
    const before = await readUserSettings()
    const result = await api.pluginMove(BETA, USER_LAYER, `project:code:${dirName}`)
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['not-permitted'])
    expect(result.errors[0]?.message).toContain('does not enable')
    expect(await readUserSettings()).toBe(before)
  })

  it.runIf(TMP_OK)('refuses the same move twice, the source having nothing left', async () => {
    expect((await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)).errors).toEqual([])
    const again = await api.pluginMove(ALPHA, USER_LAYER, `project:code:${dirName}`)
    expect(again.data).toBeNull()
    expect(again.errors.map((error) => error.code)).toEqual(['not-permitted'])
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

  it.runIf(TMP_OK)('refuses a project that has no .claude to write into', async () => {
    const homeless = path.join(world.base, 'work', 'homeless')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(homeless)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A)
    })
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
