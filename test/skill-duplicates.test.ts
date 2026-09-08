import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, SkillDuplicateGroup } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Duplicate skills across scopes, and the one operation that removes one.
 *
 * Two things are proven here and they pull in opposite directions. The
 * listing must find every repeated name and say whether the copies hold the
 * same bytes — and it must not pay for that on the skills whose names do not
 * repeat (ADR-0007). The trash must be a single reversible step (ADR-0001)
 * and must refuse a skill that is not the user's to remove (ADR-0006).
 */

const PLUGIN_SKILL = 'skill:plugin/alpha@acme:gamma-skill'

describe('duplicate skills across scopes', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true } }),
      // Same name, same bytes, two scopes: the redundant copy the owner is
      // looking for.
      'skills/twin-skill/SKILL.md': skillManifest('twin-skill', 'Two of these'),
      'skills/twin-skill/reference/notes.md': '# shared body\n',
      // Same name, different bytes: a group that is NOT safe to thin out.
      'skills/rival-skill/SKILL.md': skillManifest('rival-skill', 'The user copy'),
      // A name that repeats nowhere. Its tree must never be hashed.
      'skills/lonely-skill/SKILL.md': skillManifest('lonely-skill', 'Only one of these'),
      'skills/lonely-skill/reference/notes.md': '# never read for a digest\n',
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
      '.claude/skills/twin-skill/SKILL.md': skillManifest('twin-skill', 'Two of these'),
      '.claude/skills/twin-skill/reference/notes.md': '# shared body\n',
      '.claude/skills/rival-skill/SKILL.md': skillManifest('rival-skill', 'The project copy')
    })
    // The registry carries both halves this suite needs: the project path, so
    // the project verifies whatever characters the tmpdir holds (ADR-0009),
    // and Claude's own `skillUsage` record behind the never-used badge.
    await fs.writeFile(
      world.locator.userConfigFile,
      writeJson({
        projects: { [workdir]: {} },
        skillUsage: {
          'lonely-skill': { usageCount: 4, lastUsedAt: 1_780_000_000_000 },
          // Named there but never actually run: the badge keys on the count,
          // not on the key existing.
          'rival-skill': { usageCount: 0, lastUsedAt: 0 }
        }
      }),
      'utf8'
    )

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const groups = async (): Promise<SkillDuplicateGroup[]> => {
    const scan = await api.skillDuplicates()
    expect(scan.errors).toEqual([])
    return scan.data
  }

  const group = (found: SkillDuplicateGroup[], name: string): SkillDuplicateGroup => {
    const match = found.find((candidate) => candidate.name === name)
    expect(match, `no group named ${name}`).toBeDefined()
    return match as SkillDuplicateGroup
  }

  it('groups a repeated name across scopes and leaves a unique one out', async () => {
    const found = await groups()
    expect(found.map((entry) => entry.name)).toEqual(['rival-skill', 'twin-skill'])

    const twins = group(found, 'twin-skill')
    expect(twins.members.map((member) => member.skill.scope).sort()).toEqual([
      'project',
      'user'
    ])
    expect(twins.members.map((member) => member.skill.id).sort()).toEqual(
      [`skill:project/${flattenPath(workdir)}:twin-skill`, 'skill:user:twin-skill'].sort()
    )
  })

  it('digests every member of a group and says whether the copies match', async () => {
    const found = await groups()

    const twins = group(found, 'twin-skill')
    for (const member of twins.members) expect(member.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(twins.members[0]?.digest).toBe(twins.members[1]?.digest)
    expect(twins.identical).toBe(true)

    // Same name, different bytes. The digest is the only thing keeping this
    // group from reading as a redundant copy.
    const rivals = group(found, 'rival-skill')
    for (const member of rivals.members) expect(member.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(rivals.members[0]?.digest).not.toBe(rivals.members[1]?.digest)
    expect(rivals.identical).toBe(false)
  })

  it('never hashes the tree of a skill whose name does not repeat (ADR-0007)', async () => {
    const readdir = vi.spyOn(fs, 'readdir')
    const readFile = vi.spyOn(fs, 'readFile')
    await groups()

    const lonely = path.join(world.userRoot, 'skills', 'lonely-skill')
    const twin = path.join(world.userRoot, 'skills', 'twin-skill')
    // Digesting a member is a recursive readdir of that member's own root.
    const walked = readdir.mock.calls.map((call) => String(call[0]))
    expect(walked).toContain(twin)
    expect(walked).not.toContain(lonely)
    // And none of its body was opened — only the SKILL.md every listing reads.
    const opened = readFile.mock.calls.map((call) => String(call[0]))
    expect(opened).not.toContain(path.join(lonely, 'reference', 'notes.md'))
    expect(opened).toContain(path.join(twin, 'reference', 'notes.md'))
  })

  it('carries the never-used badge from Claude’s own skillUsage record', async () => {
    const skills = (await api.skillsList()).data
    const neverUsed = (id: string): boolean => {
      const skill = skills.find((candidate) => candidate.id === id)
      expect(skill, `no skill with id ${id}`).toBeDefined()
      return skill?.neverUsed as boolean
    }
    // Counted in the registry, so Claude has loaded it.
    expect(neverUsed('skill:user:lonely-skill')).toBe(false)
    // Named there with a zero count, which is the same as never.
    expect(neverUsed('skill:user:rival-skill')).toBe(true)
    // Absent from the record entirely.
    expect(neverUsed('skill:user:twin-skill')).toBe(true)
  })

  it('answers null for every skill when there is no skillUsage record to read', async () => {
    // A registry with no `skillUsage` key at all: kondo cannot tell, which is
    // not the same as Claude having counted nothing (ADR-0005).
    await fs.writeFile(world.locator.userConfigFile, JSON.stringify({ projects: {} }), 'utf8')
    const skills = (await api.skillsList()).data
    expect(skills.length).toBeGreaterThan(0)
    for (const skill of skills) expect(skill.neverUsed).toBeNull()
  })
})

describe('trashing one skill (ADR-0001)', () => {
  let world: FixtureWorld
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true } }),
      'skills/twin-skill/SKILL.md': skillManifest('twin-skill', 'Two of these'),
      'skills/twin-skill/reference/notes.md': '# shared body\n',
      'skills.disabled/twin-skill/SKILL.md': skillManifest('twin-skill', 'Two of these'),
      'skills.disabled/twin-skill/reference/notes.md': '# shared body\n',
      'skills/benched-skill/SKILL.md': skillManifest('benched-skill', 'On the bench'),
      'skills.disabled/benched-skill/SKILL.md': skillManifest('benched-skill', 'On the bench'),
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
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('is one journaled step, and undo puts the skill back byte for byte', async () => {
    const before = await hashTree(world.userRoot)
    const target = path.join(world.userRoot, 'skills', 'twin-skill')

    const reviewToken = (await api.skillDuplicates()).data.find((group) => group.name === 'twin-skill')!.reviewToken!
    const done = await api.entityMutate('skill:user:twin-skill', { op: 'trash', reviewToken })
    expect(done.errors).toEqual([])
    expect(done.data?.op).toBe('trash')
    expect(done.data?.kind).toBe('skill')
    // One step: nothing is copied first, because the kondo trash IS the copy.
    expect(done.data?.stepCount).toBe(1)
    expect(await exists(target)).toBe(false)
    // Nothing was unlinked — the bytes are in kondo's trash.
    expect((await api.trashSize()).data.bytes).toBeGreaterThan(0)

    const undone = await api.journalUndo(done.data?.id as string)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('trashes a benched skill out of its own directory', async () => {
    const reviewToken = (await api.skillDuplicates()).data.find((group) => group.name === 'benched-skill')!.reviewToken!
    const done = await api.entityMutate('skill:user-disabled:benched-skill', { op: 'trash', reviewToken })
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(1)
    expect(await exists(path.join(world.userRoot, 'skills.disabled', 'benched-skill'))).toBe(
      false
    )
  })

  it('refuses a plugin-shipped skill: it is not kondo’s to remove', async () => {
    const before = await hashTree(world.userRoot)
    const refusal = await api.entityMutate(PLUGIN_SKILL, { op: 'trash' })
    expect(refusal.data).toBeNull()
    // A plugin's skills are never in the user's catalogue (entry 011), so an
    // id naming one does not resolve at all — refused before a plan exists.
    expect(refusal.errors.map((error) => error.code)).toContain('unknown-id')
    // A refusal writes nothing at all.
    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await api.journalList()).data).toEqual([])

    // And the listing that does resolve one carries the matrix's refusal, so
    // whatever surfaces a plugin skill has the reason to show (ADR-0006).
    const shipped = (await api.pluginSkills('plugin:alpha@acme')).data
    expect(shipped.map((skill) => skill.id)).toContain(PLUGIN_SKILL)
    expect(shipped[0]?.capabilities.trash.allowed).toBe(false)
    expect(shipped[0]?.capabilities.trash.reason).toMatch(/follow their plugin/)
  })

  it('refuses an op the seam does not know rather than guessing', async () => {
    const bad = await api.entityMutate('skill:user:twin-skill', { op: 'delete' as never })
    expect(bad.errors[0]?.code).toBe('bad-request')
    expect(bad.errors[0]?.message).toMatch(/enable, disable, move or trash/)
  })
})

describe('reviewed duplicate skill removal (102)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const selected = 'skill:user:twin'
  const other = 'skill:user-disabled:twin'
  const body = 'AAAA'
  const source = (): string => path.join(world.userRoot, 'skills', 'twin')
  const twin = (): string => path.join(world.userRoot, 'skills.disabled', 'twin')
  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'settings.json': '{}',
      'skills/twin/SKILL.md': skillManifest('twin', 'Identical copies'),
      'skills/twin/body.txt': body,
      'skills.disabled/twin/SKILL.md': skillManifest('twin', 'Identical copies'),
      'skills.disabled/twin/body.txt': body,
      'skills/unique/SKILL.md': skillManifest('unique', 'No redundant copy')
    })
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })
  const token = async (): Promise<string> => {
    const result = await api.skillDuplicates()
    expect(result.errors).toEqual([])
    const group = result.data.find((group) => group.name === 'twin')!
    expect(group.identical).toBe(true)
    expect(group.reviewToken).toBeTypeOf('string')
    return group.reviewToken!
  }

  it.each(['selected-bytes', 'other-bytes', 'both-bytes', 'metadata-only', 'removed', 'replaced', 'group-addition'] as const)(
    'A11: refuses the old group after %s, before journaling', async (change) => {
      const pinned = new Date(1_780_000_000_000)
      for (const root of [source(), twin()]) await fs.utimes(path.join(root, 'body.txt'), pinned, pinned)
      const reviewToken = await token()
      if (change === 'selected-bytes' || change === 'both-bytes') {
        await fs.writeFile(path.join(source(), 'body.txt'), 'BBBB')
        await fs.utimes(path.join(source(), 'body.txt'), pinned, pinned)
      }
      if (change === 'other-bytes' || change === 'both-bytes') {
        await fs.writeFile(path.join(twin(), 'body.txt'), 'BBBB')
        await fs.utimes(path.join(twin(), 'body.txt'), pinned, pinned)
      }
      if (change === 'metadata-only') await fs.utimes(path.join(twin(), 'body.txt'), new Date(), new Date())
      if (change === 'removed' || change === 'replaced') {
        const info = await fs.stat(source())
        await fs.rename(source(), path.join(world.base, 'retained-skill'))
        if (change === 'replaced') {
          await writeFileTree(source(), { 'SKILL.md': skillManifest('twin', 'Identical copies'), 'body.txt': body })
          await fs.utimes(source(), info.atime, info.mtime)
        }
      }
      if (change === 'group-addition') {
        const project = path.join(world.base, 'work', 'added-project')
        await writeFileTree(project, {
          '.claude/skills/twin/SKILL.md': skillManifest('twin', 'Identical copies'),
          '.claude/skills/twin/body.txt': body
        })
        await fs.writeFile(world.locator.userConfigFile, writeJson({ projects: { [project]: {} } }))
      }
      const before = await hashTree(world.userRoot)
      const result = await api.entityMutate(selected, { op: 'trash', reviewToken })
      expect(result.data).toBeNull()
      expect(result.errors[0]?.code).toBe('stale-plan')
      expect(await hashTree(world.userRoot)).toBe(before)
      expect((await api.journalList()).data).toEqual([])
      expect(await exists(path.join(world.kondoDataRoot, 'trash'))).toBe(false)
    }
  )

  it('refuses missing/unknown tokens and unique-skill trash, without bypassing the group check', async () => {
    const reviewToken = await token()
    for (const request of [{ op: 'trash' as const }, { op: 'trash' as const, reviewToken: 'unknown' }]) {
      expect((await api.entityMutate(selected, request)).errors[0]?.code).toBe('stale-plan')
    }
    expect((await api.entityMutate('skill:user:unique', { op: 'trash' })).errors[0]?.code).toBe('stale-plan')
    expect((await api.entityMutate('skill:user:unique', { op: 'trash', reviewToken })).errors[0]?.code).toBe('stale-plan')
    expect((await api.journalList()).data).toEqual([])
  })

  it('does not issue a usable token for nonidentical groups', async () => {
    await fs.writeFile(path.join(twin(), 'body.txt'), 'BBBB')
    const group = (await api.skillDuplicates()).data.find((group) => group.name === 'twin')!
    expect(group.identical).toBe(false)
    expect(group.reviewToken).toBeNull()
  })

  it('allows one unchanged removal/Undo and refuses replay after Undo', async () => {
    const before = await hashTree(world.userRoot)
    const reviewToken = await token()
    const result = await api.entityMutate(selected, { op: 'trash', reviewToken })
    expect(result.errors).toEqual([])
    expect(result.data?.stepCount).toBe(1)
    expect(await exists(twin())).toBe(true)
    expect((await api.entityMutate(selected, { op: 'trash', reviewToken })).errors[0]?.code).toBe('stale-plan')
    expect((await api.journalUndo(result.data!.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
    const journal = await hashTree(world.kondoDataRoot)
    expect((await api.entityMutate(selected, { op: 'trash', reviewToken })).errors[0]?.code).toBe('stale-plan')
    expect(await hashTree(world.kondoDataRoot)).toBe(journal)
  })

  it('serializes two distinct valid tokens so concurrent requests cannot remove every copy', async () => {
    const first = await token()
    const second = await token()
    const results = await Promise.all([
      api.entityMutate(selected, { op: 'trash', reviewToken: first }),
      api.entityMutate(other, { op: 'trash', reviewToken: second })
    ])
    expect(results.filter((result) => result.data !== null)).toHaveLength(1)
    expect(results.flatMap((result) => result.errors.map((error) => error.code))).toEqual(['stale-plan'])
    expect((await api.journalList()).data).toHaveLength(1)
    expect([await exists(source()), await exists(twin())].filter(Boolean)).toHaveLength(1)
  })
})
