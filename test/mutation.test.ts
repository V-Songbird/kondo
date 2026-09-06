import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slashed } from '../electron/main/workspace/display'
import fsp from 'node:fs/promises'
import type { PathLike } from 'node:fs'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createLocator } from '../electron/main/workspace/locator'
import {
  createMutations,
  digestSource,
  type Mutations
} from '../electron/main/workspace/mutations'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  hashTree,
  makeWorld,
  recordWrites,
  skillManifest,
  writeFileTree,
  writeJson,
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

  // Entry 073. The window between an operation and its undo belongs to
  // whoever else writes there; a rename would have destroyed their bytes
  // with nothing in the journal saying so.
  it('displaces what took the restore path rather than renaming over it', async () => {
    const done = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect(done.errors).toEqual([])

    // Someone puts a different beta-skill back at the same path.
    const theirs = skillManifest('beta-skill', 'Rewritten while trashed')
    await writeFileTree(world.userRoot, { 'skills/beta-skill/SKILL.md': theirs })

    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    const undoId = undone.data!.id.slice('journal:'.length)

    // The recorded bytes came back...
    const restored = path.join(world.userRoot, 'skills', 'beta-skill', 'SKILL.md')
    expect(await fsp.readFile(restored, 'utf8')).toBe(
      skillManifest('beta-skill', 'Second skill')
    )
    // ...and theirs is in this undo's own trash, not gone.
    const displaced = path.join(
      world.kondoDataRoot,
      'trash',
      undoId,
      'user',
      'skills',
      'beta-skill',
      'SKILL.md'
    )
    expect(await fsp.readFile(displaced, 'utf8')).toBe(theirs)
    // And the undo entry says so, rather than displacing bytes silently:
    // reversing a bare trash carries no step at all.
    expect(undone.data!.stepCount).toBe(1)
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

  it('undoes a mutation whose later step failed, leaving nothing half-done', async () => {
    const before = await hashTree(world.userRoot)
    const rename = fsp.rename.bind(fsp)
    const failing = vi
      .spyOn(fsp, 'rename')
      .mockImplementation(async (from: PathLike, to: PathLike): Promise<void> => {
        if (String(to).includes('skills.disabled')) throw new Error('the volume went away')
        return rename(from, to)
      })

    const done = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Trash beta-skill, then move alpha-skill',
      steps: [
        { type: 'trash', store: 'user', from: 'skills/beta-skill' },
        { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' }
      ]
    })
    expect(done.data).toBeNull()
    expect(done.errors).not.toEqual([])
    failing.mockRestore()

    // The list must not offer this as a finished operation.
    const listed = await mutations.list()
    const entry = listed.data.find((row) => !row.isUndo)!
    expect(entry.failed).toBe(true)

    const undone = await mutations.undo(entry.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('undoes a mutation whose trash step itself failed', async () => {
    const before = await hashTree(world.userRoot)
    const rename = fsp.rename.bind(fsp)
    const failing = vi
      .spyOn(fsp, 'rename')
      .mockImplementation(async (from: PathLike, to: PathLike): Promise<void> => {
        if (String(from).includes('beta-skill')) throw new Error('the volume went away')
        return rename(from, to)
      })

    const done = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:alpha-skill',
      summary: 'Move alpha-skill, then trash beta-skill',
      steps: [
        { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' },
        { type: 'trash', store: 'user', from: 'skills/beta-skill' }
      ]
    })
    expect(done.data).toBeNull()
    failing.mockRestore()

    const listed = await mutations.list()
    const entry = listed.data.find((row) => !row.isUndo)!
    expect(entry.failed).toBe(true)

    const undone = await mutations.undo(entry.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('reports an emptied trash rather than silently skipping a lost restore', async () => {
    const done = await mutations.mutate({
      op: 'trash',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect(done.errors).toEqual([])
    await mutations.emptyTrash()

    const result = await mutations.undo(done.data!.id)
    expect(result.data).toBeNull()
    expect(result.errors[0]!.message).toContain('emptied')
  })

  it('leaves a write target in place when the bytes it displaced are not there', async () => {
    const before = await hashTree(world.userRoot)
    const rename = fsp.rename.bind(fsp)
    const failing = vi
      .spyOn(fsp, 'rename')
      .mockImplementation(async (from: PathLike, to: PathLike): Promise<void> => {
        if (String(from).includes('beta-skill')) throw new Error('the volume went away')
        return rename(from, to)
      })

    const done = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:beta-skill',
      summary: 'Trash beta-skill, then rewrite settings',
      steps: [
        { type: 'trash', store: 'user', from: 'skills/beta-skill' },
        { type: 'write', store: 'user', at: 'settings.json', content: '{ "outputStyle": "loud" }' }
      ]
    })
    expect(done.data).toBeNull()
    failing.mockRestore()

    const listed = await mutations.list()
    const entry = listed.data.find((row) => !row.isUndo)!
    expect(entry.failed).toBe(true)

    // The write never ran, so nothing was displaced into the trash. The undo
    // refuses rather than skipping in silence, and — the invariant — leaves
    // the store exactly as it found it instead of taking settings.json away.
    const undone = await mutations.undo(entry.id)
    expect(undone.data).toBeNull()
    expect(undone.errors[0]!.message).toContain('emptied')
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('keeps the written bytes when an emptied trash has nothing to restore', async () => {
    const done = await mutations.mutate({
      op: 'move',
      kind: 'skill',
      entityId: 'skill:user:settings',
      summary: 'Rewrite settings',
      steps: [{ type: 'write', store: 'user', at: 'settings.json', content: '{ "outputStyle": "loud" }' }]
    })
    expect(done.errors).toEqual([])
    await mutations.emptyTrash()

    const result = await mutations.undo(done.data!.id)
    expect(result.data).toBeNull()
    expect(result.errors[0]!.message).toContain('emptied')
    // Worse than not undoing at all would be losing the current bytes too.
    expect(await fsp.readFile(path.join(world.userRoot, 'settings.json'), 'utf8')).toBe(
      '{ "outputStyle": "loud" }'
    )
  })

  // -------------------------------------------------------------------------
  // The splice step (ADR-0010)

  const settingsFile = (): string => path.join(world.userRoot, 'settings.json')
  const readSettings = (): Promise<string> => fsp.readFile(settingsFile(), 'utf8')

  const spliceQuietToLoud = async (
    source: string,
    expectDigest = digestSource(source)
  ): Promise<Awaited<ReturnType<Mutations['mutate']>>> =>
    mutations.mutate({
      op: 'settings-edit',
      kind: 'settings',
      entityId: 'settings:user:user',
      summary: 'Splice outputStyle',
      steps: [
        {
          type: 'splice',
          store: 'user',
          at: 'settings.json',
          expectDigest,
          edits: [{ at: source.indexOf('quiet'), remove: 'quiet'.length, insert: 'loud' }]
        }
      ]
    })

  it('changes only the span a splice names, and undoes by inverting it', async () => {
    const before = await readSettings()
    const beforeTree = await hashTree(world.userRoot)

    const done = await spliceQuietToLoud(before)
    expect(done.errors).toEqual([])
    expect(await readSettings()).toBe(before.replace('quiet', 'loud'))

    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await readSettings()).toBe(before)
    // The inverse went onto the file's current bytes, and nothing was parked
    // in the trash to restore from: undo is the edits run backwards.
    expect(await hashTree(world.userRoot)).toBe(beforeTree)
    expect((await mutations.trashSize()).data.entryCount).toBe(0)
  })

  it('refuses a splice whose file has moved on, writing nothing at all', async () => {
    const before = await readSettings()
    const beforeTree = await hashTree(world.userRoot)

    const result = await spliceQuietToLoud(before, digestSource('{}\n'))
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('stale-file')
    expect(await hashTree(world.userRoot)).toBe(beforeTree)
    // Refused before the journal, so there is no entry claiming it happened.
    expect(await exists(path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(false)
  })

  it('refuses to undo a splice onto bytes something else has since written', async () => {
    const done = await spliceQuietToLoud(await readSettings())
    expect(done.errors).toEqual([])

    // Claude, mid-session, rewriting the same file.
    const theirs = '{\n  "outputStyle": "loud",\n  "theme": "dark"\n}\n'
    await fsp.writeFile(settingsFile(), theirs, 'utf8')

    const undone = await mutations.undo(done.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.map((error) => error.code)).toContain('stale-file')
    // The whole point: their bytes are still there.
    expect(await readSettings()).toBe(theirs)
  })

  it('holds the user-config store to the one file it is (ADR-0003)', async () => {
    await fsp.writeFile(world.locator.userConfigFile, '{}\n', 'utf8')
    const result = await mutations.mutate({
      op: 'settings-edit',
      kind: 'settings',
      entityId: 'settings:user:user',
      summary: 'Reach past the registry',
      steps: [
        {
          type: 'splice',
          store: 'user-config',
          at: '.bashrc',
          expectDigest: digestSource('{}\n'),
          edits: []
        }
      ]
    })
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('out-of-store')
  })

  it('never writes outside a known store root or kondo data', async () => {
    const registry = '{\n  "numStartups": 41\n}\n'
    await fsp.writeFile(world.locator.userConfigFile, registry, 'utf8')
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
          { type: 'write', store: 'user', at: 'settings.json', content: '{}' },
          {
            type: 'splice',
            store: 'user-config',
            at: path.basename(world.locator.userConfigFile),
            expectDigest: digestSource(registry),
            edits: [{ at: registry.indexOf('41'), remove: 2, insert: '42' }]
          }
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
        inside(target, world.kondoDataRoot) ||
        // The registry, and the temporary sibling a splice replaces it
        // through — it has to share a filesystem with the file, so it lives
        // beside it and is renamed or removed within the step (ADR-0010).
        target.startsWith(world.locator.userConfigFile)
      expect(allowed, `escaped the write boundary: ${target}`).toBe(true)
    }
    // And the temporary is gone: nothing kondo wrote outlives the step but
    // the registry itself.
    expect(
      (await fsp.readdir(world.home)).filter((name) => name.includes('.kondo-'))
    ).toEqual([])
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

  it('isolates valid JSON with invalid journal fields and still restores healthy entries', async () => {
    const before = await hashTree(world.userRoot)
    const first = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:alpha-skill', summary: 'Trash alpha-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/alpha-skill' }]
    })
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const record = JSON.parse(await fsp.readFile(journalFile, 'utf8')) as Record<string, unknown>
    const malformed: unknown[] = [
      null, false, 7, 'history', [], {},
      { ...record, id: 7 },
      { ...record, at: null },
      { ...record, op: 'erase' },
      { ...record, kind: 'unsupported' },
      { ...record, entityId: null },
      { ...record, summary: [] },
      { ...record, steps: {} },
      { ...record, undoOf: undefined },
      { ...record, undoOf: {} },
      { ...record, failedOf: null }
    ]
    await fsp.appendFile(journalFile, malformed.map((entry) => JSON.stringify(entry) + '\n').join(''))
    const second = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill', summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    const originalJournal = await fsp.readFile(journalFile, 'utf8')
    const listed = await mutations.list()
    expect(listed.data.map((entry) => entry.id)).toEqual([second.data!.id, first.data!.id])
    expect(listed.errors.map((error) => [error.code, error.path])).toEqual(
      malformed.map((_, index) => ['parse-failed', `journal.jsonl:${index + 2}`])
    )

    for (const entry of listed.data) {
      const undone = await mutations.undo(entry.id)
      expect(undone.data?.isUndo).toBe(true)
      expect(undone.errors).toEqual(listed.errors)
      const duplicateUndo = await mutations.undo(entry.id)
      expect(duplicateUndo.data).toBeNull()
      expect(duplicateUndo.errors).toEqual([
        ...listed.errors,
        expect.objectContaining({ code: 'bad-request' })
      ])
    }
    expect(await hashTree(world.userRoot)).toBe(before)
    // Corruption is reported, never repaired by rewriting the append-only file.
    expect((await fsp.readFile(journalFile, 'utf8')).startsWith(originalJournal)).toBe(true)
  })

  it('drops a whole entry with a malformed step before undo can touch any of its files', async () => {
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill', summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const record = JSON.parse(await fsp.readFile(journalFile, 'utf8')) as Record<string, unknown>
    const writeStep = { type: 'write', store: 'user', from: 'settings.json' }
    const spliceStep = {
      ...writeStep, type: 'splice', expectDigest: digestSource('a'), resultDigest: digestSource('b'),
      edits: [{ at: 0, remove: 1, insert: 'b' }], undoEdits: [{ at: 0, remove: 1, insert: 'a' }]
    }
    const malformedSteps: unknown[] = [
      null, {}, { ...writeStep, type: 'erase' },
      { ...writeStep, store: null },
      { ...writeStep, from: 7 },
      { ...writeStep, type: 'move' },
      { ...writeStep, type: 'copy', to: 'settings-copy.json' },
      { ...writeStep, type: 'trash' },
      { ...writeStep, displaced: 7 },
      { ...writeStep, created: [null] },
      { ...writeStep, toStore: [] },
      { ...spliceStep, expectDigest: null },
      { ...spliceStep, resultDigest: undefined },
      { ...spliceStep, edits: {} },
      { ...spliceStep, edits: [null] },
      { ...spliceStep, edits: [{ at: -1, remove: 0, insert: '' }] },
      { ...spliceStep, undoEdits: undefined },
      { ...spliceStep, undoEdits: [{ at: 0, remove: 1.5, insert: '' }] },
      { ...spliceStep, undoEdits: [{ at: 0, remove: 1, insert: false }] }
    ]
    const malformedRecords = malformedSteps.map((step, index) => ({
      ...record, id: `malformed-${index}`, steps: [step, writeStep]
    }))
    await fsp.appendFile(journalFile, malformedRecords.map((entry) => JSON.stringify(entry) + '\n').join(''))
    const before = await hashTree(world.userRoot)
    const originalJournal = await fsp.readFile(journalFile, 'utf8')
    const listed = await mutations.list()
    expect(listed.data.map((entry) => entry.id)).toEqual([done.data!.id])
    expect(listed.errors).toHaveLength(malformedRecords.length)
    for (const record of malformedRecords) {
      const undone = await mutations.undo(`journal:${record.id}`)
      expect(undone.data).toBeNull()
      expect(undone.errors).toEqual([
        ...listed.errors,
        expect.objectContaining({ code: 'unknown-id', path: `journal:${record.id}` })
      ])
    }
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fsp.readFile(journalFile, 'utf8')).toBe(originalJournal)
  })

  it('keeps historical optional fields and extra metadata compatible across all step kinds', async () => {
    await writeFileTree(world.userRoot, { 'other-settings.json': '{ "mode": "quiet" }' })
    const before = await hashTree(world.userRoot)
    const source = await fsp.readFile(path.join(world.userRoot, 'other-settings.json'), 'utf8')
    const done = await mutations.mutate({
      op: 'move', kind: 'skill', entityId: 'skill:user:alpha-skill', summary: 'Historical mixed entry',
      steps: [
        { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills/moved-skill' },
        { type: 'copy', store: 'user', from: 'skills/beta-skill', toStore: 'user', to: 'skills/copied-skill' },
        { type: 'trash', store: 'user', from: 'skills/beta-skill' },
        { type: 'write', store: 'user', at: 'settings.json', content: '{}' },
        { type: 'write', store: 'user', at: 'new-settings.json', content: '{}' },
        {
          type: 'splice', store: 'user', at: 'other-settings.json', expectDigest: digestSource(source),
          edits: [{ at: source.indexOf('quiet'), remove: 5, insert: 'loud' }]
        }
      ]
    })
    expect(done.errors).toEqual([])
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const record = JSON.parse(await fsp.readFile(journalFile, 'utf8')) as {
      steps: Array<Record<string, unknown>>
    }
    for (const step of record.steps) delete step.created
    await fsp.writeFile(journalFile, JSON.stringify({ ...record, extraMetadata: 'preserved' }) + '\n')

    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
    const listed = await mutations.list()
    expect(listed.errors).toEqual([])
    expect(listed.data[0]?.isUndo).toBe(true)
    expect(listed.data[1]?.undoneBy).toBe(undone.data!.id)
  })

  it('does not repeat a completed undo when its journal summary becomes corrupt', async () => {
    const done = await mutations.mutate({
      op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user', summary: 'Write settings',
      steps: [{ type: 'write', store: 'user', at: 'settings.json', content: '{}' }]
    })
    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    await fsp.writeFile(settingsFile(), '{ "theme": "a later edit" }')
    const before = await hashTree(world.userRoot)
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const records = (await fsp.readFile(journalFile, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    records[1]!.summary = null
    const damaged = records.map((record) => JSON.stringify(record) + '\n').join('')
    await fsp.writeFile(journalFile, damaged)

    const listed = await mutations.list()
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]?.undoneBy).toBeNull()
    const repeated = await mutations.undo(done.data!.id)
    expect(repeated.data).toBeNull()
    expect(repeated.errors).toEqual([
      ...listed.errors,
      expect.objectContaining({ code: 'read-failed', message: expect.stringContaining('damaged history entry') })
    ])
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fsp.readFile(journalFile, 'utf8')).toBe(damaged)

    const unrelated = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill', summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect((await mutations.undo(unrelated.data!.id)).data?.isUndo).toBe(true)
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('keeps a damaged failure marker from making its operation safe to undo', async () => {
    const failing = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('fixture volume unavailable'))
    const failed = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill', summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }]
    })
    expect(failed.data).toBeNull()
    failing.mockRestore()
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const records = (await fsp.readFile(journalFile, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    records[1]!.summary = null
    const damaged = records.map((record) => JSON.stringify(record) + '\n').join('')
    await fsp.writeFile(journalFile, damaged)
    const before = await hashTree(world.userRoot)

    const refused = await mutations.undo(`journal:${String(records[0]!.id)}`)
    expect(refused.data).toBeNull()
    expect(refused.errors.map((error) => error.code)).toEqual(['parse-failed', 'read-failed'])
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fsp.readFile(journalFile, 'utf8')).toBe(damaged)
  })

  it('follows a damaged marker failure link to the operation its undo could not finish', async () => {
    const done = await spliceQuietToLoud(await readSettings())
    await fsp.writeFile(settingsFile(), '{ "theme": "a later edit" }')
    expect((await mutations.undo(done.data!.id)).errors[0]?.code).toBe('stale-file')
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const records = (await fsp.readFile(journalFile, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    // Only failedOf remains readable: it names the undo, whose valid entry
    // still identifies the original operation that must stay protected.
    records[2]!.summary = null
    delete records[2]!.undoOf
    const damaged = records.map((record) => JSON.stringify(record) + '\n').join('')
    await fsp.writeFile(journalFile, damaged)
    const before = await hashTree(world.userRoot)

    const listed = await mutations.list()
    expect(listed.data.find((entry) => entry.id === done.data!.id)?.undoneBy).toBeNull()
    const refused = await mutations.undo(done.data!.id)
    expect(refused.data).toBeNull()
    expect(refused.errors.map((error) => error.code)).toEqual(['parse-failed', 'read-failed'])
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fsp.readFile(journalFile, 'utf8')).toBe(damaged)
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
      // The registry's own root: a directory, so a splice step can name it,
      // and holding the file rather than being it (ADR-0010).
      expect(path.dirname(locator.userConfigFile)).toBe(locator.userConfigRoot)
    }
  })
})

/**
 * Configuration orphans: members Claude still reads with nothing behind them,
 * previewed without a write and removed by splice (ADR-0010). The registry
 * and the settings layer below are both written with formatting no
 * reserialize could reproduce, so byte equality is what proves the edit was
 * a splice and not a rewrite.
 */
describe('configuration orphans (ADR-0010)', () => {
  let world: FixtureWorld
  let live: string
  let dead: string
  let api: KondoApi

  const USER_SETTINGS = [
    '{',
    '    "theme": "dark",',
    '    "enabledPlugins": {',
    '        "alpha@acme": true,',
    '        "ghost@acme": true,',
    '        "phantom@acme": false',
    '    },',
    '    "skillOverrides": {',
    '        "alpha-skill": "off",',
    '        "vanished-skill": "off"',
    '    }',
    '}',
    ''
  ].join('\n')

  const registrySource = (): string =>
    [
      '{',
      '  "numStartups": 41,',
      '  "projects": {',
      `    ${JSON.stringify(live)}: { "allowedTools": [] },`,
      `    ${JSON.stringify(dead)}: {`,
      '      "mcpServers": {',
      '        "ghost-server": { "type": "stdio", "command": "node",',
      '          "env": { "API_KEY": "sk-never-surface-me" } }',
      '      },',
      '      "lastCost": 1.5',
      '    }',
      '  },',
      '  "mcpServers": { "keeper": { "type": "stdio", "command": "node" } }',
      '}',
      ''
    ].join('\n')

  const readRegistry = (): Promise<string> =>
    fsp.readFile(world.locator.userConfigFile, 'utf8')
  const readSettings = (): Promise<string> =>
    fsp.readFile(path.join(world.userRoot, 'settings.json'), 'utf8')

  const orphan = async (kind: string, name: string): Promise<string> => {
    const found = (await api.configOrphansPreview()).data.find(
      (row) => row.kind === kind && row.name.includes(name)
    )
    if (!found) throw new Error(`fixture has no ${kind} orphan for ${name}`)
    return found.id
  }

  beforeEach(async () => {
    world = await makeWorld()
    live = path.join(world.base, 'work', 'alive')
    dead = path.join(world.base, 'work', 'buried')
    await fsp.mkdir(live, { recursive: true })

    await writeFileTree(world.userRoot, {
      'settings.json': USER_SETTINGS,
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'A skill that is here'),
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'alpha@acme': [
            {
              scope: 'user',
              version: '1.0.0',
              installPath: path.join(world.userRoot, 'plugins', 'cache', 'acme', 'alpha', '1.0.0')
            }
          ]
        }
      })
    })
    await fsp.writeFile(world.locator.userConfigFile, registrySource(), 'utf8')
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('names every orphan and nothing that is still standing', async () => {
    const preview = await api.configOrphansPreview()
    expect(preview.errors).toEqual([])
    expect(
      preview.data.map((row) => `${row.kind}:${row.name}`).sort()
    ).toEqual([
      'enabled-plugin:ghost@acme',
      'enabled-plugin:phantom@acme',
      `mcp-declaration:ghost-server`,
      `project-entry:${slashed(dead)}`,
      'skill-override:vanished-skill'
    ].sort())
  })

  it('never surfaces an env or headers value from a declaration', async () => {
    const preview = await api.configOrphansPreview()
    expect(JSON.stringify(preview)).not.toContain('sk-never-surface-me')
    expect(JSON.stringify(preview)).not.toContain('API_KEY')
  })

  it('lists an uninstalled enabledPlugins key as a plugin row of its own', async () => {
    const plugins = await api.pluginsList()
    const ghost = plugins.data.find((row) => row.id === 'plugin:ghost@acme')
    expect(ghost?.installed).toBe(false)
    expect(ghost?.version).toBeNull()
    expect(plugins.data.find((row) => row.id === 'plugin:alpha@acme')?.installed).toBe(true)
  })

  it('splices a dead registry entry out and leaves every other byte alone', async () => {
    const before = await readRegistry()
    const result = await api.configOrphansRemove([await orphan('project-entry', slashed(dead))])
    expect(result.errors).toEqual([])
    expect(result.data?.stepCount).toBe(1)

    const after = await readRegistry()
    // The whole member and the comma that joined it to the live entry, and
    // not one byte more: every other key keeps its place and its spacing.
    const live_end = '{ "allowedTools": [] }'
    expect(after).toBe(
      before.slice(0, before.indexOf(live_end) + live_end.length) +
        before.slice(before.indexOf('\n  },\n  "mcpServers"'))
    )
    expect(JSON.parse(after)).toMatchObject({ numStartups: 41 })

    const undone = await api.journalUndo(result.data!.id)
    expect(undone.errors).toEqual([])
    expect(await readRegistry()).toBe(before)
  })

  it('removes two adjacent members of one object in one step', async () => {
    const result = await api.configOrphansRemove([
      await orphan('enabled-plugin', 'ghost@acme'),
      await orphan('enabled-plugin', 'phantom@acme')
    ])
    expect(result.errors).toEqual([])
    expect(await readSettings()).toBe(
      USER_SETTINGS.replace(
        '        "alpha@acme": true,\n        "ghost@acme": true,\n        "phantom@acme": false\n',
        '        "alpha@acme": true\n'
      )
    )

    const undone = await api.journalUndo(result.data!.id)
    expect(undone.errors).toEqual([])
    expect(await readSettings()).toBe(USER_SETTINGS)
  })

  it('takes a project entry and its declaration out as one member, not two', async () => {
    const result = await api.configOrphansRemove([
      await orphan('project-entry', slashed(dead)),
      await orphan('mcp-declaration', 'ghost-server')
    ])
    expect(result.errors).toEqual([])
    // One step over one file: the wider member covered the narrower one.
    expect(result.data?.stepCount).toBe(1)
    expect(await readRegistry()).not.toContain('ghost-server')
    expect(await readRegistry()).toContain('"keeper"')
  })

  it('spans two files in one journal entry, so one undo puts both back', async () => {
    const registry = await readRegistry()
    const settings = await readSettings()

    const result = await api.configOrphansRemove([
      await orphan('project-entry', slashed(dead)),
      await orphan('skill-override', 'vanished-skill')
    ])
    expect(result.errors).toEqual([])
    expect(result.data?.stepCount).toBe(2)
    expect(await readRegistry()).not.toBe(registry)
    expect(await readSettings()).not.toBe(settings)

    const undone = await api.journalUndo(result.data!.id)
    expect(undone.errors).toEqual([])
    expect(await readRegistry()).toBe(registry)
    expect(await readSettings()).toBe(settings)
  })

  it('refuses to undo onto a registry Claude has since rewritten', async () => {
    const result = await api.configOrphansRemove([await orphan('project-entry', slashed(dead))])
    expect(result.errors).toEqual([])

    // Claude, mid-session, writing the same 2 MB file (ADR-0009).
    const theirs = (await readRegistry()).replace('"numStartups": 41', '"numStartups": 42')
    await fsp.writeFile(world.locator.userConfigFile, theirs, 'utf8')

    const undone = await api.journalUndo(result.data!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors.map((error) => error.code)).toContain('stale-file')
    // Their bytes stand. The entry stays in the journal, honest about why it
    // could not be reversed rather than reversing onto bytes it never saw.
    expect(await readRegistry()).toBe(theirs)
  })

  it('reports an id the current scan does not hold rather than guessing', async () => {
    const result = await api.configOrphansRemove(['orphan:project-entry:user-config:projects/nope'])
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('unknown-id')
  })

  it('writes no journal entry when nothing was chosen', async () => {
    const result = await api.configOrphansRemove([])
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([])
    expect((await api.journalList()).data).toHaveLength(0)
  })
})
