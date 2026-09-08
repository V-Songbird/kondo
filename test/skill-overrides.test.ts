import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, SkillInfo } from '../shared/contract'
import { collector } from '../electron/main/workspace/scan'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  readSettingsLayers,
  scanSkills,
  type VerifiedProject
} from '../electron/main/workspace/user-store'
import {
  flattenPath,
  healthyTranscript,
  hashTree,
  makeWorld,
  registerProjects,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

/**
 * `skillOverrides` — Claude's documented per-skill switch (entry 029). Claude
 * has two independent per-skill mechanisms, so a skill sitting in `skills/`
 * can still be switched off by a settings layer. These pin all three halves of reading it: precedence (local
 * over project over user), the effective state that falls out, and the
 * refusal, which has to name the layer that caused it (ADR-0006).
 */

/** A skill's row from the catalogue, by name. */
const byName = (skills: SkillInfo[], name: string): SkillInfo =>
  skills.find((skill) => skill.name === name) as SkillInfo

describe('skillOverrides (entry 029)', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')

    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'A user skill'),
      'skills.disabled/beta-skill/SKILL.md': skillManifest('beta-skill', 'Benched')
    })
    await writeFileTree(workdir, {
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project skill')
    })
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  /** The catalogue as the readers build it, layers and all. */
  const catalogue = async (): Promise<SkillInfo[]> => {
    const c = collector()
    const verified: VerifiedProject[] = [{ dirName: flattenPath(workdir), absPath: workdir }]
    const layers = await readSettingsLayers(world.locator, verified, c)
    return scanSkills(world.locator, verified, layers, new Set(), c)
  }

  /** Write `skillOverrides` into one of the three layers. */
  const override = async (
    layer: 'user' | 'project' | 'local',
    overrides: Record<string, string>
  ): Promise<void> => {
    const body = writeJson({ skillOverrides: overrides })
    if (layer === 'user') {
      await writeFileTree(world.userRoot, { 'settings.json': body })
      return
    }
    const file = layer === 'project' ? 'settings.json' : 'settings.local.json'
    await writeFileTree(workdir, { [`.claude/${file}`]: body })
  }

  // -------------------------------------------------------------------------
  // Precedence: local > project > user (domain.md)

  it('resolves a project skill through local, then project, then user', async () => {
    // All three speak at once: the highest-precedence layer is the answer,
    // and the row says which layer that was rather than only what it said.
    await override('user', { 'delta-skill': 'off' })
    await override('project', { 'delta-skill': 'name-only' })
    await override('local', { 'delta-skill': 'user-invocable-only' })

    const local = byName(await catalogue(), 'delta-skill')
    expect(local.override?.value).toBe('user-invocable-only')
    expect(local.override?.layer).toBe('local')
    expect(local.override?.layerId).toBe(`settings:local:${flattenPath(workdir)}`)

    // Take the winner away and the next layer down decides — a silent layer
    // cannot win over one that speaks, so this is precedence and not order.
    await writeFileTree(workdir, { '.claude/settings.local.json': writeJson({}) })
    const project = byName(await catalogue(), 'delta-skill')
    expect(project.override?.value).toBe('name-only')
    expect(project.override?.layer).toBe('project')

    await writeFileTree(workdir, { '.claude/settings.json': writeJson({}) })
    const user = byName(await catalogue(), 'delta-skill')
    expect(user.override?.value).toBe('off')
    expect(user.override?.layer).toBe('user')
  })

  it('resolves a user skill against the user layer alone', async () => {
    // A user skill loads in every project, so no single project's layer
    // speaks for it — the user layer is the one statement true everywhere.
    await override('local', { 'alpha-skill': 'off' })
    await override('user', { 'alpha-skill': 'name-only' })

    const alpha = byName(await catalogue(), 'alpha-skill')
    expect(alpha.override?.value).toBe('name-only')
    expect(alpha.override?.layer).toBe('user')
    expect(alpha.enabled).toBe(true)
  })

  it('says nothing when no layer states the skill', async () => {
    await override('user', { 'some-other-skill': 'off' })
    const alpha = byName(await catalogue(), 'alpha-skill')
    expect(alpha.override).toBeNull()
    expect(alpha.enabled).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Effective state

  it('reads a skill switched off by an override as off, not as enabled', async () => {
    await override('user', { 'alpha-skill': 'off' })
    const alpha = byName(await catalogue(), 'alpha-skill')

    // It is in `skills/` — the bench says nothing about it — and it is still
    // off, because Claude will not load it.
    expect(alpha.scope).toBe('user')
    expect(alpha.enabled).toBe(false)
    expect(alpha.override?.value).toBe('off')
  })

  it('leaves the two middle values enabled: neither is a disabling', async () => {
    // `name-only` drops the description, `user-invocable-only` hides it from
    // the model but keeps `/name`. Claude still loads both (domain.md).
    for (const value of ['name-only', 'user-invocable-only']) {
      await override('user', { 'alpha-skill': value })
      const alpha = byName(await catalogue(), 'alpha-skill')
      expect(alpha.enabled).toBe(true)
      expect(alpha.override?.value).toBe(value)
    }
  })

  it('keeps a benched skill off whatever the override says', async () => {
    await override('user', { 'beta-skill': 'on' })
    const beta = byName(await catalogue(), 'beta-skill')
    expect(beta.scope).toBe('user-disabled')
    expect(beta.enabled).toBe(false)
  })

  // -------------------------------------------------------------------------
  // The refusal names the layer (ADR-0006)

  it('refuses to disable a skill an override already switched off, by layer', async () => {
    await override('user', { 'alpha-skill': 'off' })
    const result = await api.entityMutate('skill:user:alpha-skill', { op: 'disable' })

    expect(result.data).toBeNull()
    const error = result.errors[0]
    expect(error?.code).toBe('not-permitted')
    // The layer, not just "it is off": that file is the only thing a user
    // could edit to change the answer.
    expect(error?.message).toContain('settings.json')
    expect(error?.message).toContain('skillOverrides')
  })

  it('restores a benched skill while refusing to withdraw its settings override', async () => {
    await override('user', { 'beta-skill': 'off' })
    const back = await api.entityMutate('skill:user-disabled:beta-skill', { op: 'enable' })
    expect(back.errors).toEqual([])
    expect(back.data?.op).toBe('move')

    const beta = byName((await api.skillsList()).data, 'beta-skill')
    expect(beta.scope).toBe('user')
    expect(beta.enabled).toBe(false)
    expect(beta.capabilities.enable.allowed).toBe(true)
    expect(beta.capabilities.disable.allowed).toBe(false)
    expect(beta.capabilities.disable.reason).toContain('settings.json')
    const before = await hashTree(world.base)
    const history = (await api.journalList()).data
    expect(history).toHaveLength(1)

    const on = await api.entityMutate('skill:user:beta-skill', { op: 'enable' })
    expect(on.data).toBeNull()
    expect(on.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(byName((await api.skillsList()).data, 'beta-skill').enabled).toBe(false)
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual(history)
  })

  it('lists inherited global skills and refuses a confirmed project-only settings creation (entry 062)', async () => {
    const projectId = `project:code:${flattenPath(workdir)}`
    const detail = (await api.projectDetail(projectId)).data!
    const alpha = detail.inheritedSkills.find((entry) => entry.skill.name === 'alpha-skill')!
    expect(alpha.choice).toBe('inherit')
    expect(alpha.enabledHere).toBe(true)
    expect(alpha.capabilities.disable.allowed).toBe(true)
    expect(alpha.capabilities.enable.allowed).toBe(false)
    expect(detail.inheritedSkills.map((entry) => entry.skill.scope)).toEqual(['user'])
    expect(detail.inheritedSkills.some((entry) => entry.skill.name === 'delta-skill')).toBe(false)
    const before = await hashTree(world.base)

    const asked = await api.entityMutate('skill:user:alpha-skill', { op: 'disable', targetId: projectId })
    expect(asked.errors.map((error) => error.code)).toEqual(['needs-confirmation'])
    const off = await api.entityMutate('skill:user:alpha-skill', {
      op: 'disable', targetId: projectId, confirm: true
    })
    expect(off.data).toBeNull()
    expect(off.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
    const after = (await api.projectDetail(projectId)).data!
    expect(after.inheritedSkills).toEqual(detail.inheritedSkills)
    expect(byName((await api.skillsList()).data, 'alpha-skill').enabled).toBe(true)
  })

  // A project layer may be written concurrently by Claude; both directions
  // must refuse without touching even unrelated settings members.
  it('refuses both project-only toggle directions and preserves unrelated settings bytes', async () => {
    const projectId = `project:code:${flattenPath(workdir)}`
    const local = path.join(workdir, '.claude', 'settings.local.json')
    for (const [op, settings] of [
      ['disable', writeJson({ theme: 'dark' })],
      ['enable', writeJson({ theme: 'dark', skillOverrides: { 'alpha-skill': 'off' } })]
    ] as const) {
      await writeFileTree(workdir, { '.claude/settings.local.json': settings })
      const before = await hashTree(world.base)
      const result = await api.entityMutate('skill:user:alpha-skill', { op, targetId: projectId })
      expect(result.data).toBeNull()
      expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
      expect(await fs.readFile(local, 'utf8')).toBe(settings)
      expect(await hashTree(world.base)).toBe(before)
      expect((await api.journalList()).data).toEqual([])
    }
  })
  it('never withdraws a Global off from a project page', async () => {
    await override('user', { 'alpha-skill': 'off' })
    const projectId = `project:code:${flattenPath(workdir)}`
    const detail = (await api.projectDetail(projectId)).data!
    const alpha = detail.inheritedSkills.find((entry) => entry.skill.name === 'alpha-skill')!
    // Off, but not by this project: the project says nothing, so its own
    // toggle is still "off here", and there is no "follows global" to press.
    expect(alpha.choice).toBe('inherit')
    expect(alpha.enabledHere).toBe(false)
    expect(alpha.capabilities.enable.allowed).toBe(false)
    const refused = await api.entityMutate('skill:user:alpha-skill', { op: 'enable', targetId: projectId })
    expect(refused.data).toBeNull()
    expect(refused.errors[0]?.code).toBe('not-permitted')
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a multi-layer enable before withdrawing any override (entry 045)', async () => {
    await override('user', { 'delta-skill': 'off', 'alpha-skill': 'name-only' })
    await override('local', { 'delta-skill': 'off' })
    const id = `skill:project/${flattenPath(workdir)}:delta-skill`
    expect(byName((await api.skillsList()).data, 'delta-skill').enabled).toBe(false)
    const before = await hashTree(world.base)
    const result = await api.entityMutate(id, { op: 'enable' })
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
    expect(byName((await api.skillsList()).data, 'delta-skill').enabled).toBe(false)
  })

  it('refuses a settings toggle even when no override stands in the way', async () => {
    await override('user', { 'delta-skill': 'off' })
    const before = await hashTree(world.base)
    const result = await api.entityMutate('skill:user:alpha-skill', { op: 'disable' })
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('names the project layer when that is the one that switched it off', async () => {
    await override('local', { 'delta-skill': 'off' })
    const skills = await catalogue()
    const delta = byName(skills, 'delta-skill')
    expect(delta.enabled).toBe(false)
    expect(delta.capabilities.disable.reason).toContain('settings.local.json')
  })

  // -------------------------------------------------------------------------
  // Degrading, never dying (ADR-0005)

  it('treats a value Claude does not define as the layer saying nothing', async () => {
    await override('user', { 'alpha-skill': 'sideways' })
    const alpha = byName(await catalogue(), 'alpha-skill')
    expect(alpha.override).toBeNull()
    expect(alpha.enabled).toBe(true)
  })

  it('survives a settings layer that is not JSON, and reports it', async () => {
    await writeFileTree(world.userRoot, { 'settings.json': '{not json' })
    const c = collector()
    const verified: VerifiedProject[] = [{ dirName: flattenPath(workdir), absPath: workdir }]
    const layers = await readSettingsLayers(world.locator, verified, c)
    const skills = await scanSkills(world.locator, verified, layers, new Set(), c)

    expect(byName(skills, 'alpha-skill').override).toBeNull()
    expect(byName(skills, 'alpha-skill').enabled).toBe(true)
    expect(c.errors.some((error) => error.code === 'parse-failed')).toBe(true)
  })

  it('survives a skillOverrides that is not an object', async () => {
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ skillOverrides: ['alpha-skill'] })
    })
    const alpha = byName(await catalogue(), 'alpha-skill')
    expect(alpha.override).toBeNull()
    expect(alpha.enabled).toBe(true)
  })
})
