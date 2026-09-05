import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { KondoApi, ToggleOperation } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  recordWrites,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Enable and disable a skill through Claude's own convention (ADR-0006,
 * entry 045): `skillOverrides[<name>] = "off"` spliced into a settings layer
 * of the skill's scope, and the member taken away again to enable — journaled
 * first and therefore reversible (ADR-0001). A skill already parked in
 * `skills.disabled/` (kondo's old bench) is offered the way back into
 * `skills/`. Plugin-shipped skills are refused by the capability matrix, not
 * by the UI.
 */

// A project path is reconstructed from its flattened directory name, which
// cannot round-trip hyphens — the project half needs a hyphen-free tmpdir.
const TMP_OK = !os.tmpdir().includes('-')

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

  it('disables a user skill by writing skillOverrides off into settings.json, moving nothing', async () => {
    const settings = path.join(world.userRoot, 'settings.json')
    const before = await fs.readFile(settings, 'utf8')
    const result = await api.skillToggle('skill:user:alpha-skill', 'disable')
    expect(result.errors).toEqual([])
    expect(result.data?.op).toBe('settings-edit')
    expect(result.data?.summary).toContain('settings.json')

    // The directory did not move: Claude's switch is the settings key.
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(world.userRoot, 'skills.disabled', 'alpha-skill'))).toBe(false)

    // One member added; the key that was there keeps its bytes.
    const after = await fs.readFile(settings, 'utf8')
    expect(JSON.parse(after)).toEqual({
      enabledPlugins: { 'alpha@acme': true },
      skillOverrides: { 'alpha-skill': 'off' }
    })
    expect(after).toContain(before.slice(before.indexOf('"enabledPlugins"'), before.indexOf('}')))

    const alpha = (await api.skillsList()).data.find((skill) => skill.id === 'skill:user:alpha-skill')
    expect(alpha?.enabled).toBe(false)
    expect(alpha?.override?.value).toBe('off')
    // The row now offers the way back, which is the withdrawal of that member.
    expect(alpha?.capabilities.enable.allowed).toBe(true)
    expect(alpha?.capabilities.disable.allowed).toBe(false)

    const on = await api.skillToggle('skill:user:alpha-skill', 'enable')
    expect(on.errors).toEqual([])
    expect(JSON.parse(await fs.readFile(settings, 'utf8'))).toEqual({
      enabledPlugins: { 'alpha@acme': true },
      skillOverrides: {}
    })
  })

  it('moves a skill parked in skills.disabled back into skills', async () => {
    const result = await api.skillToggle('skill:user-disabled:beta-skill', 'enable')
    expect(result.errors).toEqual([])

    expect(await exists(path.join(world.userRoot, 'skills', 'beta-skill', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(world.userRoot, 'skills.disabled', 'beta-skill'))).toBe(false)
    expect(await idsFrom()).toContain('skill:user:beta-skill')
  })

  it('restores the store byte-for-byte when the toggle is undone', async () => {
    const before = await hashTree(world.userRoot)
    const done = await api.skillToggle('skill:user:alpha-skill', 'disable')
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // -------------------------------------------------------------------------
  // Project scope

  it.runIf(TMP_OK)('toggles a project skill in its own settings.local.json, asking before creating it', async () => {
    const projectId = 'skill:project/X--work-proj:delta-skill'.replace(
      'X--work-proj',
      flattenPath(workdir)
    )
    expect(await idsFrom()).toContain(projectId)
    const local = path.join(claudeDir, 'settings.local.json')

    // No layer file yet: nothing licenses conjuring one out of a toggle.
    const userBefore = await hashTree(world.userRoot)
    const asked = await api.skillToggle(projectId, 'disable')
    expect(asked.data).toBeNull()
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    expect(await exists(local)).toBe(false)

    const disabled = await api.entityMutate(projectId, { op: 'disable', confirm: true })
    expect(disabled.errors).toEqual([])
    expect(JSON.parse(await fs.readFile(local, 'utf8'))).toEqual({
      skillOverrides: { 'delta-skill': 'off' }
    })
    // Still in skills/, still the same id; the user scope was not touched.
    expect(await exists(path.join(claudeDir, 'skills', 'delta-skill', 'SKILL.md'))).toBe(true)
    expect(await idsFrom()).toContain(projectId)
    expect(await hashTree(world.userRoot)).toBe(userBefore)
    const delta = (await api.skillsList()).data.find((skill) => skill.id === projectId)
    expect(delta?.enabled).toBe(false)

    const enabled = await api.skillToggle(projectId, 'enable')
    expect(enabled.errors).toEqual([])
    expect(JSON.parse(await fs.readFile(local, 'utf8'))).toEqual({ skillOverrides: {} })
    expect((await api.skillsList()).data.find((skill) => skill.id === projectId)?.enabled).toBe(
      true
    )
  })

  it.runIf(TMP_OK)('never writes outside the project .claude directory', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      await api.entityMutate(`skill:project/${flattenPath(workdir)}:delta-skill`, {
        op: 'disable',
        confirm: true
      })
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

  it('appends the journal entry before the settings file is written', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)
    try {
      const result = await api.skillToggle('skill:user:alpha-skill', 'disable')
      expect(result.errors).toEqual([])
    } finally {
      for (const restore of restores) restore()
    }

    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const journalAt = ordered.indexOf(journalFile)
    const storeAt = ordered.findIndex((target) =>
      target.startsWith(path.join(world.userRoot, 'settings.json'))
    )
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the settings file was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
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
