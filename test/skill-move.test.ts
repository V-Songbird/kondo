import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
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
  UUID_B,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * Moving a skill between scopes — the feature kondo is named for. One
 * journaled operation (ADR-0001) whose order is the whole guarantee: copy,
 * verify the copy, and only then displace the source into kondo's trash. No
 * intermediate state can lose the skill, and `undo` puts it back.
 */

const PLUGIN_SKILL = 'skill:plugin/alpha@acme:gamma-skill'
const USER = 'user'

describe('skill move between scopes (ADR-0001)', () => {
  let world: FixtureWorld
  let workdir: string
  let otherdir: string
  let claudeDir: string
  let otherClaudeDir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    otherdir = path.join(world.base, 'work', 'other')
    claudeDir = path.join(workdir, '.claude')
    otherClaudeDir = path.join(otherdir, '.claude')
    const pluginInstall = path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')

    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${flattenPath(otherdir)}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true } }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills/alpha-skill/reference/notes.md': '# a second file, so a partial copy shows\n',
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
    // A second project, so project → project is a real direction and not two
    // halves of the same store.
    await writeFileTree(otherdir, {
      '.claude/skills/.keep': '',
      'src/other.ts': 'export const other = 1'
    })
    await registerProjects(world, [workdir, otherdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const idsFrom = async (): Promise<string[]> =>
    (await api.skillsList()).data.map((skill) => skill.id)

  const projectId = (dir: string): string => `project:code:${flattenPath(dir)}`

  it('refuses a move into a project the registry names but has no .claude', async () => {
    // A project Claude has run in that carries no store of its own. It is a
    // real member of the project set — not an omission — and it is still not
    // somewhere kondo can put a skill (ADR-0002).
    const bare = path.join(world.base, 'work', 'bare')
    await writeFileTree(bare, { 'README.md': 'known to Claude, no store inside' })
    await registerProjects(world, [workdir, otherdir, bare])
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })

    const listed = (await fresh.sessionProjects()).data.find(
      (project) => project.dirName === flattenPath(bare)
    )!
    expect(listed.sources).toEqual(['registry'])
    expect(listed.location).toBe('here')
    expect(listed.hasStore).toBe(false)

    const refusal = await fresh.skillMove('skill:user:alpha-skill', projectId(bare))
    expect(refusal.data).toBeNull()
    expect(refusal.errors[0]?.code).toBe('bad-request')
    // The refusal names the directory that would have to exist first, rather
    // than reporting an id nobody has heard of.
    expect(refusal.errors[0]?.message).toContain(path.join(bare, '.claude'))
    // Nothing was written, and the skill is where it was.
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
    expect(await exists(path.join(bare, '.claude'))).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // The three directions

  it('moves a user skill into a project, trashing the source it copied from', async () => {
    const result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    expect(result.errors).toEqual([])
    expect(result.data?.op).toBe('move')

    // Present at the destination, whole — both files, not just the manifest.
    expect(await exists(path.join(claudeDir, 'skills', 'alpha-skill', 'SKILL.md'))).toBe(true)
    expect(
      await exists(path.join(claudeDir, 'skills', 'alpha-skill', 'reference', 'notes.md'))
    ).toBe(true)
    // Absent from the source.
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(false)
    // And the source's bytes are in kondo's trash, never deleted (ADR-0001).
    const trashed = path.join(
      world.kondoDataRoot,
      'trash',
      result.data!.id.slice('journal:'.length),
      'user',
      'skills',
      'alpha-skill',
      'SKILL.md'
    )
    expect(await exists(trashed)).toBe(true)
    expect((await api.trashSize()).data.entryCount).toBe(1)

    const ids = await idsFrom()
    expect(ids).toContain(`skill:project/${flattenPath(workdir)}:alpha-skill`)
    expect(ids).not.toContain('skill:user:alpha-skill')
  })

  it('moves a project skill into the user scope', async () => {
    const result = await api.skillMove(
      `skill:project/${flattenPath(workdir)}:delta-skill`,
      USER
    )
    expect(result.errors).toEqual([])

    expect(await exists(path.join(world.userRoot, 'skills', 'delta-skill', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(claudeDir, 'skills', 'delta-skill'))).toBe(false)
    expect(await idsFrom()).toContain('skill:user:delta-skill')
  })

  it('moves a project skill into another project', async () => {
    const result = await api.skillMove(
      `skill:project/${flattenPath(workdir)}:delta-skill`,
      projectId(otherdir)
    )
    expect(result.errors).toEqual([])

    expect(await exists(path.join(otherClaudeDir, 'skills', 'delta-skill', 'SKILL.md')))
      .toBe(true)
    expect(await exists(path.join(claudeDir, 'skills', 'delta-skill'))).toBe(false)
    expect(await idsFrom()).toContain(`skill:project/${flattenPath(otherdir)}:delta-skill`)
  })

  it('carries a benched skill across still benched (ADR-0006)', async () => {
    const result = await api.skillMove('skill:user-disabled:beta-skill', projectId(workdir))
    expect(result.errors).toEqual([])

    // The state travels with the skill: it lands in the destination's
    // skills.disabled, not in its skills.
    expect(await exists(path.join(claudeDir, 'skills.disabled', 'beta-skill', 'SKILL.md')))
      .toBe(true)
    expect(await exists(path.join(claudeDir, 'skills', 'beta-skill'))).toBe(false)
    expect(await idsFrom()).toContain(
      `skill:project-disabled/${flattenPath(workdir)}:beta-skill`
    )
  })

  // ---------------------------------------------------------------------------
  // Refusals — neither side is modified

  it('refuses a destination that already holds that skill name', async () => {
    await writeFileTree(claudeDir, {
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'A different alpha')
    })
    const userBefore = await hashTree(world.userRoot)
    const projectBefore = await hashTree(claudeDir)

    const result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('bad-request')
    expect(result.errors[0]?.message).toContain('will not merge')

    // Neither side moved, and no journal entry was written.
    expect(await hashTree(world.userRoot)).toBe(userBefore)
    expect(await hashTree(claudeDir)).toBe(projectBefore)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a name the destination holds in its skills.disabled', async () => {
    await writeFileTree(claudeDir, {
      'skills.disabled/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'Benched there')
    })
    const result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    expect(result.errors.map((error) => error.code)).toContain('bad-request')
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
  })

  it('never offers a plugin-shipped skill, and refuses one named directly', async () => {
    // Moving a plugin's own skill out of its tree would break the plugin, so
    // it is never catalogued and there is nothing to pick a destination for.
    expect(await idsFrom()).not.toContain(PLUGIN_SKILL)

    const before = await hashTree(world.userRoot)
    const result = await api.skillMove(PLUGIN_SKILL, USER)
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('unknown-id')

    expect(await hashTree(world.userRoot)).toBe(before)
    // Refused before anything was planned, so no journal entry exists.
    expect((await api.journalList()).data).toEqual([])
    // And the matrix still refuses the scope, for whoever surfaces one later.
    expect(capabilitiesFor('skill', 'plugin').move.reason).toContain('Plugin-shipped')
  })

  it('refuses the scope the skill is already in, and an unknown one', async () => {
    const same = await api.skillMove('skill:user:alpha-skill', USER)
    expect(same.errors.map((error) => error.code)).toContain('bad-request')
    expect(same.errors[0]?.message).toContain('already in that scope')

    const ghost = await api.skillMove('skill:user:alpha-skill', 'project:code:D--Not-There')
    expect(ghost.errors.map((error) => error.code)).toContain('unknown-id')

    const asPath = await api.skillMove(
      'skill:user:alpha-skill',
      path.join(world.userRoot, 'skills')
    )
    expect(asPath.errors.map((error) => error.code)).toContain('unknown-id')

    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
    expect((await api.journalList()).data).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Order is the invariant

  it('leaves the source in place and unmodified when the copy does not verify', async () => {
    const before = await hashTree(world.userRoot)
    const original = fs.copyFile
    const corrupted = 'fixture: the copied reference lost its original bytes\n'
    let intercepted = false
    // The explicit walker copies one validated file at a time. Damage only
    // the destination reference; verification must refuse to release the source.
    Object.defineProperty(fs, 'copyFile', {
      value: async (...args: Parameters<typeof original>) => {
        await original(...args)
        const [from, to] = args
        if (String(from) === path.join(world.userRoot, 'skills', 'alpha-skill', 'reference', 'notes.md')) {
          intercepted = true
          await fs.writeFile(to, corrupted)
        }
      },
      configurable: true,
      writable: true
    })

    let result
    try {
      result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    } finally {
      Object.defineProperty(fs, 'copyFile', { value: original, configurable: true, writable: true })
    }

    expect(intercepted, 'the per-file copy corruption probe did not run').toBe(true)
    expect(result.data).toMatchObject({ outcome: 'none', failed: true })
    expect(result.errors[0]?.message).toContain('does not match its source')
    expect(result.errors[0]?.message).toContain('nothing was removed')

    // The source survives byte-for-byte — it was never the thing at risk.
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill', 'SKILL.md')))
      .toBe(true)
    // And no half-copy is left sitting at the destination.
    expect(await exists(path.join(claudeDir, 'skills', 'alpha-skill'))).toBe(false)
    // The failed copy remains recoverable in this journal entry's trash.
    const history = await api.journalList()
    expect(history.errors).toEqual([])
    const failed = history.data.find((entry) => entry.failed)
    expect(failed).toBeDefined()
    const kept = path.join(
      world.kondoDataRoot,
      'trash',
      failed!.id.slice('journal:'.length),
      `project-${flattenPath(workdir)}`,
      'skills',
      'alpha-skill'
    )
    expect(await fs.readFile(path.join(kept, 'reference', 'notes.md'), 'utf8')).toBe(corrupted)
    expect(await fs.readFile(path.join(kept, 'SKILL.md'), 'utf8')).toBe(
      skillManifest('alpha-skill', 'First skill')
    )
  })

  it('appends the journal entry before the destination is written', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)
    try {
      const result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
      expect(result.errors).toEqual([])
    } finally {
      for (const restore of restores) restore()
    }

    const journalAt = ordered.indexOf(path.join(world.kondoDataRoot, 'journal.jsonl'))
    const storeAt = ordered.findIndex((target) => target.startsWith(claudeDir))
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the destination was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
  })

  it('118: rejects a structurally different copy with the same old digest and retains both versions', async () => {
    const source = path.join(world.userRoot, 'skills', 'alpha-skill')
    await fs.writeFile(path.join(source, 'a'), 'bc')
    const before = await hashTree(world.userRoot)
    const copyFile = fs.copyFile.bind(fs)
    let injected = false
    vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to, mode) => {
      await copyFile(from, to, mode)
      if (String(from) === path.join(source, 'a')) {
        injected = true
        await fs.rename(to, path.join(path.dirname(String(to)), 'ab'))
        await fs.writeFile(path.join(path.dirname(String(to)), 'ab'), 'c')
      }
    })
    const result = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    expect(injected).toBe(true)
    expect(result.errors[0]?.message).toContain('does not match its source')
    expect(result.data).toMatchObject({ outcome: 'none', failed: true })
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fs.readFile(path.join(source, 'a'), 'utf8')).toBe('bc')
    expect(await exists(path.join(source, 'ab'))).toBe(false)
    expect(await exists(path.join(claudeDir, 'skills', 'alpha-skill'))).toBe(false)
    const kept = path.join(world.kondoDataRoot, 'trash', result.data!.id.slice(8),
      `project-${flattenPath(workdir)}`, 'skills', 'alpha-skill')
    expect(await fs.readFile(path.join(kept, 'ab'), 'utf8')).toBe('c')
    expect(await exists(path.join(kept, 'a'))).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Undo (ADR-0001)

  it('undoes the whole move: the skill is back, the copy is gone', async () => {
    const source = path.join(world.userRoot, 'skills', 'alpha-skill')
    const binary = Buffer.from([0, 255, 68, 70, 128, 13, 10])
    await fs.writeFile(path.join(source, 'binary'), binary)
    await fs.writeFile(path.join(source, 'empty-file'), '')
    await fs.mkdir(path.join(source, 'empty-directory'))
    const userBefore = await hashTree(world.userRoot)
    const projectBefore = await hashTree(claudeDir)

    const done = await api.skillMove('skill:user:alpha-skill', projectId(workdir))
    expect(done.errors).toEqual([])
    expect(await hashTree(world.userRoot)).not.toBe(userBefore)
    const destination = path.join(claudeDir, 'skills', 'alpha-skill')
    expect(await fs.readFile(path.join(destination, 'binary'))).toEqual(binary)
    expect(await fs.readFile(path.join(destination, 'empty-file'))).toEqual(Buffer.alloc(0))
    expect(await fs.readdir(path.join(destination, 'empty-directory'))).toEqual([])

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])

    // Back at its original scope, byte-for-byte...
    expect(await hashTree(world.userRoot)).toBe(userBefore)
    expect(await fs.readFile(path.join(source, 'binary'))).toEqual(binary)
    expect(await fs.readFile(path.join(source, 'empty-file'))).toEqual(Buffer.alloc(0))
    expect(await fs.readdir(path.join(source, 'empty-directory'))).toEqual([])
    // ...and the destination is exactly as it was, with no leftover copy and
    // no empty directory the move had to create.
    expect(await hashTree(claudeDir)).toBe(projectBefore)
    expect(await exists(path.join(claudeDir, 'skills', 'alpha-skill'))).toBe(false)
    expect(await idsFrom()).toContain('skill:user:alpha-skill')
  })
})
