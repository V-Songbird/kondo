import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createLocator } from '../electron/main/workspace/locator'
import { createMutations, type Mutations } from '../electron/main/workspace/mutations'
import {
  exists,
  hashTree,
  makeWorld,
  recordWrites,
  skillManifest,
  writeFileTree,
  type FixtureWorld
} from './helpers'

/**
 * The ADR-0001 safety invariants docs/testing.md defers to the first
 * mutation. These tests must never be deleted: they are the whole of the
 * promise that every mutation kondo performs can be undone.
 */

describe('mutation safety invariants (ADR-0001)', () => {
  let world: FixtureWorld
  let mutations: Mutations

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills/beta-skill/SKILL.md': skillManifest('beta-skill', 'Second skill'),
      'settings.json': '{\n  "outputStyle": "quiet"\n}\n'
    })
    mutations = createMutations(world.locator)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('appends the journal entry before the store is touched', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)

    try {
      const result = await mutations.mutate({
        op: 'trash',
        kind: 'skill',
        entityId: 'skill:user:beta-skill',
        summary: 'Trash beta-skill',
        steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
      })
      expect(result.errors).toEqual([])
    } finally {
      for (const restore of restores) restore()
    }

    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const journalAt = ordered.findIndex((target) => target === journalFile)
    const storeAt = ordered.findIndex(
      (target) => target === world.userRoot || target.startsWith(world.userRoot + path.sep)
    )
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the store was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
  })

  it('refuses a step whose source is missing, leaving the store untouched', async () => {
    const before = await hashTree(world.userRoot)
    const result = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Move a skill that is not there',
      steps: [{ type: 'move', store: 'user', from: 'skills/ghost-skill', to: 'skills/moved' }]
    })
    expect(result.errors.map((error) => error.code)).toContain('read-failed')
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('leaves the store untouched when the journal write fails', async () => {
    const before = await hashTree(world.userRoot)
    vi.spyOn(fsp, 'open').mockRejectedValue(new Error('journal is not writable'))
    const result = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('read-failed')
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('restores a multi-step mutation byte-for-byte', async () => {
    const before = await hashTree(world.userRoot)
    const done = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Move alpha-skill, trash beta-skill, rewrite settings',
      steps: [
        { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' },
        { type: 'trash', store: 'user', from: 'skills/beta-skill' },
        { type: 'write', store: 'user', at: 'settings.json', content: '{ "outputStyle": "loud" }' },
        { type: 'write', store: 'user', at: 'brand-new.json', content: '{}' }
      ]
    })
    expect(done.errors).toEqual([])
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('keeps displaced bytes in kondo trash instead of deleting them', async () => {
    const done = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect(done.errors).toEqual([])
    const journalId = done.data!.id.slice('journal:'.length)
    const kept = path.join(
      world.kondoDataRoot,
      'trash',
      journalId,
      'user',
      'skills',
      'beta-skill',
      'SKILL.md'
    )
    expect(await exists(kept)).toBe(true)
    expect(await exists(path.join(world.userRoot, 'skills', 'beta-skill'))).toBe(false)

    const size = await mutations.trashSize()
    expect(size.data.bytes).toBeGreaterThan(0)
    expect(size.data.entryCount).toBe(1)
  })

  it('journals the undo and marks the original undone', async () => {
    const done = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    const undone = await mutations.undo(done.data!.id)
    expect(undone.data!.isUndo).toBe(true)

    const listed = await mutations.list()
    expect(listed.errors).toEqual([])
    expect(listed.data).toHaveLength(2)
    // Newest first.
    expect(listed.data[0]!.id).toBe(undone.data!.id)
    expect(listed.data[1]!.undoneBy).toBe(undone.data!.id)

    const twice = await mutations.undo(done.data!.id)
    expect(twice.data).toBeNull()
    expect(twice.errors.map((error) => error.code)).toContain('bad-request')
  })

  it('never writes outside a known store root or kondo data', async () => {
    const touched: string[] = []
    const restores = recordWrites(touched)

    try {
      const done = await mutations.mutate({
        op: 'move',
        kind: 'skill',
        entityId: 'skill:user:alpha-skill',
        summary: 'A sweep across every step kind',
        steps: [
          { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' },
          { type: 'trash', store: 'user', from: 'skills/beta-skill' },
          { type: 'write', store: 'user', at: 'settings.json', content: '{}' }
        ]
      })
      await mutations.undo(done.data!.id)
      await mutations.list()
      await mutations.trashSize()
    } finally {
      for (const restore of restores) restore()
    }

    const inside = (target: string, root: string): boolean => {
      const rel = path.relative(root, target)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    expect(touched.length).toBeGreaterThan(0)
    for (const target of touched) {
      const allowed =
        inside(target, world.userRoot) ||
        inside(target, world.desktopRoot) ||
        inside(target, world.kondoDataRoot)
      expect(allowed, `escaped the write boundary: ${target}`).toBe(true)
    }
  })

  it('refuses a step that escapes its store root, before journaling', async () => {
    const result = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Escape attempt',
      steps: [{ type: 'trash', store: 'user', from: '../outside' }]
    })
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('out-of-store')
    expect(await exists(path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(false)
  })

  it('refuses an unknown store root', async () => {
    const result = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Unknown store',
      steps: [{ type: 'trash', store: 'nowhere', from: 'skills/alpha-skill' }]
    })
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('out-of-store')
  })

  it('skips a corrupt journal line and reports it, never fatal (ADR-0005)', async () => {
    await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    await fsp.appendFile(
      path.join(world.kondoDataRoot, 'journal.jsonl'),
      'this is not json\n',
      'utf8'
    )

    const listed = await mutations.list()
    expect(listed.data).toHaveLength(1)
    expect(listed.errors.map((error) => error.code)).toContain('parse-failed')
  })

  it('reports an unknown journal id rather than guessing', async () => {
    const result = await mutations.undo('journal:000000000-deadbeef')
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('unknown-id')
  })

  it('resolves kondo data outside every store root on all three platforms', () => {
    const cases = [
      {
        home: path.join('C:', 'Users', 'x'),
        appData: path.join('C:', 'Users', 'x', 'AppData', 'Roaming'),
        userData: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'Kondo'),
        platform: 'win32' as const
      },
      {
        home: '/Users/x',
        appData: null,
        userData: '/Users/x/Library/Application Support/Kondo',
        platform: 'darwin' as const
      },
      {
        home: '/home/x',
        appData: null,
        userData: '/home/x/.config/Kondo',
        platform: 'linux' as const
      }
    ]
    const outside = (target: string, root: string): boolean => {
      const rel = path.relative(root, target)
      return rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))
    }
    for (const scenario of cases) {
      const locator = createLocator({ ...scenario, env: {} })
      expect(outside(locator.kondoDataRoot, locator.userRoot), scenario.platform).toBe(true)
      expect(outside(locator.kondoDataRoot, locator.desktopRoot!), scenario.platform).toBe(true)
    }
  })
})
