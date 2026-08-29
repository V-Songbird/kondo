import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { CapabilityOperation, KondoApi } from '../shared/contract'
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
 * Enable and disable a skill through Claude's own convention (ADR-0006): the
 * skill directory moves between `skills` and `skills.disabled` in its own
 * scope, journaled first and therefore reversible (ADR-0001). Plugin-shipped
 * skills are refused by the capability matrix, not by the UI.
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

  it('moves a user skill into skills.disabled and leaves it nowhere else', async () => {
    const result = await api.skillToggle('skill:user:alpha-skill', 'disable')
    expect(result.errors).toEqual([])
    expect(result.data?.op).toBe('move')

    expect(await exists(path.join(world.userRoot, 'skills.disabled', 'alpha-skill', 'SKILL.md')))
      .toBe(true)
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(false)
    // A disable is a move, not a trash: nothing was displaced into kondo's.
    expect((await api.trashSize()).data.entryCount).toBe(0)

    const ids = await idsFrom()
    expect(ids).toContain('skill:user-disabled:alpha-skill')
    expect(ids).not.toContain('skill:user:alpha-skill')
  })

  it('moves a disabled user skill back into skills', async () => {
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

  it.runIf(TMP_OK)('toggles a project skill inside its own project only', async () => {
    const projectId = 'skill:project/X--work-proj:delta-skill'.replace(
      'X--work-proj',
      flattenPath(workdir)
    )
    expect(await idsFrom()).toContain(projectId)

    const userBefore = await hashTree(world.userRoot)
    const disabled = await api.skillToggle(projectId, 'disable')
    expect(disabled.errors).toEqual([])

    expect(await exists(path.join(claudeDir, 'skills.disabled', 'delta-skill', 'SKILL.md')))
      .toBe(true)
    expect(await exists(path.join(claudeDir, 'skills', 'delta-skill'))).toBe(false)
    // The user scope is a different store and was not touched.
    expect(await hashTree(world.userRoot)).toBe(userBefore)

    const disabledId = projectId.replace('skill:project/', 'skill:project-disabled/')
    expect(await idsFrom()).toContain(disabledId)

    const enabled = await api.skillToggle(disabledId, 'enable')
    expect(enabled.errors).toEqual([])
    expect(await exists(path.join(claudeDir, 'skills', 'delta-skill', 'SKILL.md'))).toBe(true)
    expect(await idsFrom()).toContain(projectId)
  })

  it.runIf(TMP_OK)('never writes outside the project .claude directory', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      await api.skillToggle(
        `skill:project/${flattenPath(workdir)}:delta-skill`,
        'disable'
      )
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

  it('refuses a plugin-shipped skill at the capability matrix', async () => {
    const before = await hashTree(world.userRoot)
    for (const operation of ['enable', 'disable'] as const) {
      const result = await api.skillToggle(PLUGIN_SKILL, operation)
      expect(result.data).toBeNull()
      expect(result.errors.map((error) => error.code)).toContain('not-permitted')
      expect(result.errors[0]?.message).toContain('Plugin-shipped')
    }
    expect(await hashTree(world.userRoot)).toBe(before)
    // Refused before anything was planned, so no journal entry exists.
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses the direction the matrix already calls done', async () => {
    const result = await api.skillToggle('skill:user:alpha-skill', 'enable')
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('not-permitted')
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Ordering (ADR-0001) and the seam (ADR-0008)

  it('appends the journal entry before the skill directory moves', async () => {
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
      target.startsWith(path.join(world.userRoot, 'skills'))
    )
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the skill directory was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
  })

  it('refuses a free-form path, an unknown id, and an unknown operation', async () => {
    const asPath = await api.skillToggle(path.join(world.userRoot, 'skills'), 'disable')
    expect(asPath.errors.map((error) => error.code)).toContain('bad-request')

    const ghost = await api.skillToggle('skill:user:not-here', 'disable')
    expect(ghost.errors.map((error) => error.code)).toContain('unknown-id')

    const sideways = await api.skillToggle(
      'skill:user:alpha-skill',
      'sideways' as CapabilityOperation
    )
    expect(sideways.errors.map((error) => error.code)).toContain('bad-request')

    expect((await api.journalList()).data).toEqual([])
  })
})
