import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, ToggleOperation } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
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
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/** Settings toggles refuse until concurrency-safe replacement is available.
 * The old directory bench remains reversible through ordinary moves.
 */
const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

const PLUGIN_SKILL = 'skill:plugin/alpha@acme:gamma-skill'

describe('skill enable/disable (ADR-0006)', () => {
  let world: FixtureWorld
  let workdir: string
  let claudeDir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    claudeDir = path.join(workdir, '.claude')
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true } }),
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
    await writeFileTree(workdir, {
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped'),
      'src/secret.ts': 'export const apiKey = "never-read-me"'
    })
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const idsFrom = async (): Promise<string[]> =>
    (await api.skillsList()).data.map((skill) => skill.id)

  // -------------------------------------------------------------------------
  // User scope

  it('refuses disabling a user skill without changing settings or moving its directory', async () => {
    const before = await hashTree(world.base)
    const result = await api.skillToggle('skill:user:alpha-skill', 'disable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
    const alpha = (await api.skillsList()).data.find((skill) => skill.id === 'skill:user:alpha-skill')
    expect(alpha?.enabled).toBe(true)
    expect(alpha?.override).toBeNull()
  })

  // Both directions edit settings, so enabling an overridden skill must
  // preserve the same refusal guarantee as disabling it.
  it('refuses enabling an overridden skill without withdrawing its settings member', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true }, skillOverrides: { 'alpha-skill': 'off' } })
    })
    const before = await hashTree(world.base)
    const result = await api.skillToggle('skill:user:alpha-skill', 'enable')
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
    expect((await api.skillsList()).data.find((skill) => skill.id === 'skill:user:alpha-skill')?.enabled).toBe(false)
    expect((await api.trashSize()).data.entryCount).toBe(0)
  })

  it('refuses a historical settings Undo and preserves the external write and recovery history', async () => {
    const settings = path.join(world.userRoot, 'settings.json')
    const original = await fs.readFile(settings, 'utf8')
    const applied = writeJson({ enabledPlugins: { 'alpha@acme': true }, skillOverrides: { 'alpha-skill': 'off' } })
    const record = {
      id: 'historical-skill-toggle', at: '2026-09-01T00:00:00.000Z', op: 'settings-edit', kind: 'skill',
      entityId: 'skill:user:alpha-skill', summary: 'Disable skill alpha-skill', undoOf: null,
      steps: [{ type: 'splice', store: 'user', from: 'settings.json',
        expectDigest: digestSource(original), resultDigest: digestSource(applied),
        edits: [{ at: 0, remove: original.length, insert: applied }],
        undoEdits: [{ at: 0, remove: applied.length, insert: original }] }]
    }
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': JSON.stringify(record) + '\n' })
    const theirs = writeJson({ enabledPlugins: { 'alpha@acme': true }, skillOverrides: { 'alpha-skill': 'off' }, theme: 'dark' })
    await fs.writeFile(settings, theirs, 'utf8')
    const before = await hashTree(world.base)
    const history = await api.journalList()
    expect(history.errors).toEqual([])
    expect(history.data).toHaveLength(1)

    const undone = await api.journalUndo('journal:historical-skill-toggle')
    expect(undone.data).toBeNull()
    expect(undone.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await fs.readFile(settings, 'utf8')).toBe(theirs)
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual(history.data)
  })
  it('moves a skill parked in skills.disabled back into skills', async () => {
    const result = await api.skillToggle('skill:user-disabled:beta-skill', 'enable')
    expect(result.errors).toEqual([])

    expect(await exists(path.join(world.userRoot, 'skills', 'beta-skill', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(world.userRoot, 'skills.disabled', 'beta-skill'))).toBe(false)
    expect(await idsFrom()).toContain('skill:user:beta-skill')
  })

  it('restores the store byte-for-byte when enabling a benched skill is undone', async () => {
    const before = await hashTree(world.userRoot)
    const done = await api.skillToggle('skill:user-disabled:beta-skill', 'enable')
    expect(done.errors).toEqual([])
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // -------------------------------------------------------------------------
  // Project scope

  it('refuses a confirmed project toggle without creating its missing settings layer', async () => {
    const projectId = `skill:project/${flattenPath(workdir)}:delta-skill`
    expect(await idsFrom()).toContain(projectId)
    const local = path.join(claudeDir, 'settings.local.json')
    const before = await hashTree(world.base)
    const asked = await api.skillToggle(projectId, 'disable')
    expect(asked.data).toBeNull()
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    expect(await exists(local)).toBe(false)

    const disabled = await api.entityMutate(projectId, { op: 'disable', confirm: true })
    expect(disabled.data).toBeNull()
    expect(disabled.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await exists(local)).toBe(false)
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
    expect((await api.skillsList()).data.find((skill) => skill.id === projectId)?.enabled).toBe(true)
  })

  it('opens no write paths for a refused project settings creation', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      const result = await api.entityMutate(`skill:project/${flattenPath(workdir)}:delta-skill`, {
        op: 'disable', confirm: true
      })
      expect(result.data).toBeNull()
      expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    } finally {
      for (const restore of restores) restore()
    }
    expect(touched).toEqual([])
  })

  // -------------------------------------------------------------------------
  // The matrix refuses, not the UI

  it('never offers a plugin-shipped skill, and refuses one named directly', async () => {
    // A plugin's skills are the plugin's: they are not catalogued, so there
    // is no row to press. Naming one anyway resolves against nothing.
    expect(await idsFrom()).not.toContain(PLUGIN_SKILL)

    const before = await hashTree(world.userRoot)
    for (const operation of ['enable', 'disable'] as const) {
      const result = await api.skillToggle(PLUGIN_SKILL, operation)
      expect(result.data).toBeNull()
      expect(result.errors.map((error) => error.code)).toContain('unknown-id')
    }
    expect(await hashTree(world.userRoot)).toBe(before)
    // Refused before anything was planned, so no journal entry exists.
    expect((await api.journalList()).data).toEqual([])
    // And the matrix still answers, for whoever surfaces one elsewhere.
    expect(capabilitiesFor('skill', 'plugin').disable.reason).toContain('Plugin-shipped')
  })

  it('refuses the direction the matrix already calls done', async () => {
    const result = await api.skillToggle('skill:user:alpha-skill', 'enable')
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('not-permitted')
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Ordering (ADR-0001) and the seam (ADR-0008)

  it('refuses an existing settings edit before opening the journal or store for writing', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)
    try {
      const result = await api.skillToggle('skill:user:alpha-skill', 'disable')
      expect(result.data).toBeNull()
      expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    } finally {
      for (const restore of restores) restore()
    }
    expect(ordered).toEqual([])
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a free-form path, an unknown id, and an unknown operation', async () => {
    const asPath = await api.skillToggle(path.join(world.userRoot, 'skills'), 'disable')
    expect(asPath.errors.map((error) => error.code)).toContain('bad-request')

    const ghost = await api.skillToggle('skill:user:not-here', 'disable')
    expect(ghost.errors.map((error) => error.code)).toContain('unknown-id')

    const sideways = await api.skillToggle(
      'skill:user:alpha-skill',
      'sideways' as ToggleOperation
    )
    expect(sideways.errors.map((error) => error.code)).toContain('bad-request')

    expect((await api.journalList()).data).toEqual([])
  })
})
