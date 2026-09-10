import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slashed } from '../electron/main/workspace/display'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import type { PathLike } from 'node:fs'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createLocator } from '../electron/main/workspace/locator'
import {
  createMutations,
  digestSource,
  applyEdits,
  invertEdits,
  type MutationPlan,
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

/** Synthetic pre-098 history; never enable the blocked runtime to build fixtures. */
async function settingsHistory(world: FixtureWorld, type: 'write' | 'splice' = 'splice') {
  const source = await fsp.readFile(path.join(world.userRoot, 'settings.json'), 'utf8')
  const edits = [{ at: source.indexOf('quiet'), remove: 5, insert: 'loud' }]
  const next = applyEdits(source, edits)!
  const step = type === 'splice'
    ? { type, store: 'user', from: 'settings.json', edits, undoEdits: invertEdits(source, edits),
        expectDigest: digestSource(source), resultDigest: digestSource(next) }
    : { type, store: 'user', from: 'settings.json', displaced: 'user/settings.json' }
  const record = { id: 'fixture-settings', at: '2026-09-01T00:00:00.000Z',
    op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user',
    summary: 'Historical settings edit', steps: [step], undoOf: null }
  await writeFileTree(world.kondoDataRoot, {
    'journal.jsonl': JSON.stringify(record) + '\n',
    ...(type === 'write' ? { 'trash/fixture-settings/user/settings.json': source } : {})
  })
  await fsp.writeFile(path.join(world.userRoot, 'settings.json'), next)
  return { id: 'journal:fixture-settings', record, source, next }
}

describe('logical copy fingerprint recovery (118)', () => {
  let world: FixtureWorld
  const manifest = skillManifest('twin', 'Synthetic upgrade fixture')
  const legacyDigest = createHash('sha256').update('SKILL.md').update(manifest).update('abc').digest('hex')
  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, { 'source/SKILL.md': manifest, 'source/a': 'bc' })
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  const seedLegacyCopy = async (complete = false): Promise<void> => {
    const intent = { id: 'old-copy', at: '2026-09-01T00:00:00.000Z', op: 'move', kind: 'skill',
      entityId: 'skill:user:twin', summary: 'Copy twin before upgrade', undoOf: null, version: 2,
      steps: [{ type: 'copy', store: 'user', from: 'source', toStore: 'desktop', to: 'destination' }],
      actions: [{ type: 'copy', step: 0, from: { store: 'user', relative: 'source' },
        to: { store: 'desktop', relative: 'destination' } }],
      progress: { next: 0, pending: null, state: 'running' } }
    const { actions: _actions, ...metadata } = intent
    const pending = { ...metadata, id: 'old-pending', steps: [], progressOf: intent.id,
      progress: { next: 0, pending: legacyDigest, state: 'running' } }
    const rows = [JSON.stringify(intent), JSON.stringify(pending)]
    if (complete) rows.push(JSON.stringify({ ...pending, id: 'old-complete',
      progress: { next: 1, pending: null, state: 'complete' } }))
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': rows.join('\n') + '\n' })
  }

  it.each(['identical', 'colliding', 'destination-only', 'source-only', 'neither'] as const)(
    'keeps an old pending copy uncertain after upgrade with %s endpoints', async (shape) => {
      if (shape !== 'source-only' && shape !== 'neither') {
        await writeFileTree(world.desktopRoot, { 'destination/SKILL.md': manifest,
          ...(shape === 'colliding' ? { 'destination/ab': 'c' } : { 'destination/a': 'bc' }) })
      }
      if (shape === 'destination-only' || shape === 'neither') {
        await fsp.rename(path.join(world.userRoot, 'source'), path.join(world.userRoot, 'retained-source'))
      }
      await seedLegacyCopy()
      const before = await hashTree(world.base)
      const journal = await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'))
      const writes: string[] = []
      const restores = recordWrites(writes)
      try {
        for (let retry = 0; retry < 2; retry++) {
          const restarted = createMutations(world.locator)
          const listed = await restarted.list()
          expect(listed.errors).toEqual([])
          expect(listed.data[0]).toMatchObject({ outcome: 'uncertain', recovery: 'blocked', undoneBy: null })
          expect(listed.data[0]?.undoBlockedReason).toContain('older fingerprint')
          const result = await restarted.undo('journal:old-copy')
          expect(result.data).toBeNull()
          expect(result.errors[0]?.message).toContain('Recovery is uncertain')
          expect(result.errors[0]?.message).toContain('older fingerprint')
        }
      } finally { for (const restore of restores) restore() }
      expect(writes).toEqual([])
      expect(await hashTree(world.base)).toBe(before)
      expect(await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'))).toEqual(journal)
      expect(await exists(path.join(world.kondoDataRoot, 'trash'))).toBe(false)
    }
  )

  it('keeps confirmed historical copies undoable without reinterpreting their old pending hash', async () => {
    await writeFileTree(world.desktopRoot, { 'destination/SKILL.md': manifest, 'destination/a': 'bc' })
    await seedLegacyCopy(true)
    const journal = await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'), 'utf8')
    const restarted = createMutations(world.locator)
    expect((await restarted.list()).data[0]).toMatchObject({ outcome: 'complete', recovery: 'available' })
    const result = await restarted.undo('journal:old-copy')
    expect(result.errors).toEqual([])
    expect(result.data?.outcome).toBe('complete')
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'a'), 'utf8')).toBe('bc')
    expect(await exists(path.join(world.desktopRoot, 'destination'))).toBe(false)
    expect((await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'), 'utf8')).startsWith(journal)).toBe(true)
  })

  it.each(['before-effect', 'after-effect', 'changed-copy'] as const)('reconciles a new framed copy after restart at %s', async (phase) => {
    const binary = Buffer.from([0, 255, 0, 128, 13, 10])
    await fsp.writeFile(path.join(world.userRoot, 'source', 'binary'), binary)
    await fsp.writeFile(path.join(world.userRoot, 'source', 'empty'), '')
    await fsp.mkdir(path.join(world.userRoot, 'source', 'empty-dir'))
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const open = fsp.open.bind(fsp)
    const copyFile = fsp.copyFile.bind(fsp)
    let copied = false
    let interrupted = false
    vi.spyOn(fsp, 'copyFile').mockImplementation(async (...args) => { await copyFile(...args); copied = true })
    vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) !== journal) return open(...args)
      if (phase !== 'before-effect' && copied) {
        interrupted = true
        throw new Error('fixture lost copy confirmation')
      }
      const handle = await open(...args)
      if (phase === 'before-effect') {
        const sync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await sync()
          const last = JSON.parse((await fsp.readFile(journal, 'utf8')).trim().split('\n').at(-1)!) as { progress: { pending: string | null } }
          if (last.progress.pending !== null) {
            interrupted = true
            throw new Error('fixture interrupted after pending copy sync')
          }
        })
      }
      return handle
    })
    const result = await createMutations(world.locator).mutate({ op: 'move', kind: 'skill',
      entityId: 'skill:user:twin', summary: 'Copy before interruption', steps: [
        { type: 'copy', store: 'user', from: 'source', toStore: 'desktop', to: 'destination' },
        { type: 'trash', store: 'user', from: 'source' }
      ] })
    expect(interrupted).toBe(true)
    expect(copied).toBe(phase !== 'before-effect')
    expect(result.data?.outcome).toBe('uncertain')
    vi.restoreAllMocks()
    const last = JSON.parse((await fsp.readFile(journal, 'utf8')).trim().split('\n').at(-1)!) as { progress: { pending: string } }
    expect(last.progress.pending).toMatch(/^tree-v2:[a-f0-9]{64}$/)
    if (phase === 'changed-copy') {
      const destination = path.join(world.desktopRoot, 'destination')
      await fsp.rename(path.join(destination, 'a'), path.join(destination, 'ab'))
      await fsp.writeFile(path.join(destination, 'ab'), 'c')
      const savedJournal = await fsp.readFile(journal)
      const writes: string[] = []
      const restores = recordWrites(writes)
      try {
        const refused = await createMutations(world.locator).undo(result.data!.id)
        expect(refused.data).toBeNull()
        expect(refused.errors[0]?.message).toContain('Recovery is uncertain')
      } finally { for (const restore of restores) restore() }
      expect(writes).toEqual([])
      expect(await fsp.readFile(journal)).toEqual(savedJournal)
      expect(await fsp.readFile(path.join(destination, 'ab'), 'utf8')).toBe('c')
      expect(await fsp.readFile(path.join(world.userRoot, 'source', 'a'), 'utf8')).toBe('bc')
      return
    }
    const restarted = createMutations(world.locator)
    expect((await restarted.list()).errors).toEqual([])
    const restored = await restarted.undo(result.data!.id)
    if (phase === 'after-effect') {
      expect(restored.errors).toEqual([])
      expect(restored.data?.outcome).toBe('complete')
    } else {
      expect(restored.data).toBeNull()
      expect(restored.errors[0]?.message).toContain('no completed changes')
    }
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'a'), 'utf8')).toBe('bc')
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'binary'))).toEqual(binary)
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'empty'))).toEqual(Buffer.alloc(0))
    expect(await fsp.readdir(path.join(world.userRoot, 'source', 'empty-dir'))).toEqual([])
    expect(await exists(path.join(world.desktopRoot, 'destination'))).toBe(false)
  })
})

describe('physical move fingerprint recovery (121)', () => {
  let world: FixtureWorld
  const legacyDigest = 'a'.repeat(64)
  const bytes = Buffer.from([0, 255, 128, 13, 10, 42])

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, { 'source/data.bin': '' })
    await fsp.writeFile(path.join(world.userRoot, 'source', 'data.bin'), bytes)
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  const moveIntent = () => ({
    id: 'old-move', at: '2026-09-01T00:00:00.000Z', op: 'trash', kind: 'skill',
    entityId: 'skill:user:physical', summary: 'Trash physical tree', undoOf: null, version: 2,
    steps: [{ type: 'trash', store: 'user', from: 'source', displaced: 'user/source' }],
    actions: [{ type: 'move', step: 0, from: { store: 'user', relative: 'source' },
      to: { store: 'user', relative: 'user/source', trashId: 'old-move' } }],
    progress: { next: 0, pending: null, state: 'running' }
  })

  const progressRow = <T extends { id: string; actions: unknown }>(
    intent: T,
    id: string,
    progress: { next: number; pending: string | null; state: 'running' | 'failed' | 'complete' }
  ) => {
    const { actions: _actions, ...metadata } = intent
    return { ...metadata, id, steps: [], progressOf: intent.id, progress }
  }

  const saveJournal = async (rows: unknown[]): Promise<Buffer> => {
    const journal = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': journal.toString('utf8') })
    return journal
  }

  const expectRefusalWithoutEffects = async (id: string, message: string, journal: Buffer): Promise<void> => {
    const source = path.join(world.userRoot, 'source', 'data.bin')
    const sourceBytes = await fsp.readFile(source)
    const journalPath = path.join(world.kondoDataRoot, 'journal.jsonl')
    const writes: string[] = []
    const restores = recordWrites(writes)
    const open = vi.spyOn(fsp, 'open')
    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      const mutations = createMutations(world.locator)
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ outcome: 'uncertain', recovery: 'blocked' })
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move')?.undoBlockedReason)
        .toContain(message)
      const refused = await mutations.undo(id)
      expect(refused.data).toBeNull()
      expect(refused.errors[0]?.message).toContain(message)
      expect(open).not.toHaveBeenCalled()
      expect(readFile.mock.calls.every(([file]) => String(file) === journalPath)).toBe(true)
    } finally {
      readFile.mockRestore()
      open.mockRestore()
      for (const restore of restores) restore()
    }
    expect(writes).toEqual([])
    expect(await fsp.readFile(source)).toEqual(sourceBytes)
    expect(await exists(path.join(world.kondoDataRoot, 'trash', 'old-move', 'user', 'source'))).toBe(false)
    expect(await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'))).toEqual(journal)
  }

  it('persists typed physical fingerprints for forward moves and Undo', async () => {
    const mutations = createMutations(world.locator)
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:physical',
      summary: 'Trash physical tree', steps: [{ type: 'trash', store: 'user', from: 'source' }] })
    expect(done.errors).toEqual([])
    expect((await mutations.undo(done.data!.id)).errors).toEqual([])
    const rows = (await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { progress?: { pending: string | null } })
    const pending = rows.flatMap((row) => row.progress?.pending ? [row.progress.pending] : [])
    expect(pending).toHaveLength(2)
    expect(pending.every((value) => /^physical-v2:[a-f0-9]{64}$/.test(value))).toBe(true)
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'data.bin'))).toEqual(bytes)
  })

  it('refuses a bare legacy pending forward move before endpoint reads or journal writes', async () => {
    const intent = moveIntent()
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'old-pending', { next: 0, pending: legacyDigest, state: 'running' })
    ])
    await expectRefusalWithoutEffects('journal:old-move', 'older fingerprint', journal)
  })

  it('refuses a destination-only legacy pending forward move without reinterpreting its bytes', async () => {
    const intent = moveIntent()
    const source = path.join(world.userRoot, 'source')
    const saved = path.join(world.kondoDataRoot, 'trash', intent.id, 'user', 'source')
    await fsp.mkdir(path.dirname(saved), { recursive: true })
    await fsp.rename(source, saved)
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'old-pending', { next: 0, pending: legacyDigest, state: 'running' })
    ])
    const savedBytes = await fsp.readFile(path.join(saved, 'data.bin'))
    const journalPath = path.join(world.kondoDataRoot, 'journal.jsonl')
    const writes: string[] = []
    const restores = recordWrites(writes)
    const open = vi.spyOn(fsp, 'open')
    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      const mutations = createMutations(world.locator)
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ outcome: 'uncertain', recovery: 'blocked',
          undoBlockedReason: expect.stringContaining('older fingerprint') })
      const refused = await mutations.undo('journal:old-move')
      expect(refused.data).toBeNull()
      expect(refused.errors[0]?.message).toContain('older fingerprint')
      expect(open).not.toHaveBeenCalled()
      expect(readFile.mock.calls.every(([file]) => String(file) === journalPath)).toBe(true)
    } finally {
      readFile.mockRestore()
      open.mockRestore()
      for (const restore of restores) restore()
    }
    expect(writes).toEqual([])
    expect(await exists(source)).toBe(false)
    expect(await fsp.readFile(path.join(saved, 'data.bin'))).toEqual(savedBytes)
    expect(await fsp.readFile(journalPath)).toEqual(journal)
  })

  it.each([
    ['move', `tree-v2:${legacyDigest}`],
    ['copy', `physical-v2:${legacyDigest}`]
  ] as const)('refuses a %s action carrying the other fingerprint format', async (type, pending) => {
    const intent = type === 'move' ? moveIntent() : {
      ...moveIntent(),
      steps: [{ type: 'copy', store: 'user', from: 'source', toStore: 'desktop', to: 'destination' }],
      actions: [{ type: 'copy', step: 0, from: { store: 'user', relative: 'source' },
        to: { store: 'desktop', relative: 'destination' } }]
    }
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'wrong-pending', { next: 0, pending, state: 'running' })
    ])
    await expectRefusalWithoutEffects('journal:old-move', 'does not match its recorded', journal)
  })

  it('rejects a completed copy history that cleared mismatched typed evidence', async () => {
    const intent = {
      ...moveIntent(),
      steps: [{ type: 'copy', store: 'user', from: 'source', toStore: 'desktop', to: 'destination' }],
      actions: [{ type: 'copy', step: 0, from: { store: 'user', relative: 'source' },
        to: { store: 'desktop', relative: 'destination' } }]
    }
    await writeFileTree(world.desktopRoot, { 'destination/data.bin': 'unrelated destination bytes' })
    const source = path.join(world.userRoot, 'source', 'data.bin')
    const destination = path.join(world.desktopRoot, 'destination', 'data.bin')
    const sourceBytes = await fsp.readFile(source)
    const destinationBytes = await fsp.readFile(destination)
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'wrong-pending', {
        next: 0, pending: `physical-v2:${legacyDigest}`, state: 'running'
      }),
      progressRow(intent, 'forged-completion', { next: 1, pending: null, state: 'complete' })
    ])
    const journalPath = path.join(world.kondoDataRoot, 'journal.jsonl')
    const writes: string[] = []
    const restores = recordWrites(writes)
    const open = vi.spyOn(fsp, 'open')
    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      const mutations = createMutations(world.locator)
      const listed = await mutations.list()
      expect(listed.errors.map((error) => error.code)).toContain('parse-failed')
      expect(listed.data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ outcome: 'uncertain', recovery: 'blocked', undoneBy: null })
      const refused = await mutations.undo('journal:old-move')
      expect(refused.data).toBeNull()
      expect(refused.errors.at(-1)?.message).toContain('damaged history')
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move')?.undoneBy).toBeNull()
      expect(open).not.toHaveBeenCalled()
      expect(readFile.mock.calls.every(([file]) => String(file) === journalPath)).toBe(true)
    } finally {
      readFile.mockRestore()
      open.mockRestore()
      for (const restore of restores) restore()
    }
    expect(writes).toEqual([])
    expect(await fsp.readFile(source)).toEqual(sourceBytes)
    expect(await fsp.readFile(destination)).toEqual(destinationBytes)
    expect(await fsp.readFile(journalPath)).toEqual(journal)
  })

  it('rejects a completed Undo that cleared mismatched typed evidence', async () => {
    const intent = moveIntent()
    const source = path.join(world.userRoot, 'source')
    const saved = path.join(world.kondoDataRoot, 'trash', intent.id, 'user', 'source')
    await fsp.mkdir(path.dirname(saved), { recursive: true })
    await fsp.rename(source, saved)
    const undo = {
      ...intent, id: 'old-undo', steps: [], undoOf: intent.id,
      actions: [{ type: 'move', step: 0,
        from: { store: 'user', relative: 'user/source', trashId: intent.id },
        to: { store: 'user', relative: 'source' } }],
      progress: { next: 0, pending: null, state: 'running' }
    }
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'old-forward-pending', { next: 0, pending: legacyDigest, state: 'running' }),
      progressRow(intent, 'old-forward-complete', { next: 1, pending: null, state: 'complete' }),
      undo,
      progressRow(undo, 'wrong-undo-pending', {
        next: 0, pending: `tree-v2:${legacyDigest}`, state: 'running'
      }),
      progressRow(undo, 'forged-undo-completion', { next: 1, pending: null, state: 'complete' })
    ])
    const savedBytes = await fsp.readFile(path.join(saved, 'data.bin'))
    const writes: string[] = []
    const restores = recordWrites(writes)
    try {
      const mutations = createMutations(world.locator)
      const listed = await mutations.list()
      expect(listed.errors.map((error) => error.code)).toContain('parse-failed')
      expect(listed.data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ outcome: 'uncertain', recovery: 'blocked', undoneBy: null })
      expect((await mutations.undo('journal:old-move')).data).toBeNull()
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move')?.undoneBy).toBeNull()
    } finally { for (const restore of restores) restore() }
    expect(writes).toEqual([])
    expect(await exists(source)).toBe(false)
    expect(await fsp.readFile(path.join(saved, 'data.bin'))).toEqual(savedBytes)
    expect(await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'))).toEqual(journal)
  })

  it('rejects a failed clear of mismatched Undo evidence before replay can move an occupant', async () => {
    const intent = moveIntent()
    const source = path.join(world.userRoot, 'source')
    const saved = path.join(world.kondoDataRoot, 'trash', intent.id, 'user', 'source')
    await fsp.mkdir(path.dirname(saved), { recursive: true })
    await fsp.rename(source, saved)
    await writeFileTree(source, { 'data.bin': 'current occupant bytes' })
    const undo = {
      ...intent, id: 'old-undo', undoOf: intent.id,
      steps: [{ type: 'trash', store: 'user', from: 'source', displaced: 'user/source' }],
      actions: [
        { type: 'move', step: 0, from: { store: 'user', relative: 'source' },
          to: { store: 'user', relative: 'user/source', trashId: 'old-undo' } },
        { type: 'move', step: 0,
          from: { store: 'user', relative: 'user/source', trashId: intent.id },
          to: { store: 'user', relative: 'source' } }
      ],
      progress: { next: 0, pending: null, state: 'running' }
    }
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'old-forward-pending', { next: 0, pending: legacyDigest, state: 'running' }),
      progressRow(intent, 'old-forward-complete', { next: 1, pending: null, state: 'complete' }),
      undo,
      progressRow(undo, 'wrong-undo-pending', {
        next: 0, pending: `tree-v2:${legacyDigest}`, state: 'running'
      }),
      progressRow(undo, 'forged-failed-clear', { next: 0, pending: null, state: 'failed' })
    ])
    const occupant = await fsp.readFile(path.join(source, 'data.bin'))
    const savedBytes = await fsp.readFile(path.join(saved, 'data.bin'))
    const journalPath = path.join(world.kondoDataRoot, 'journal.jsonl')
    const writes: string[] = []
    const restores = recordWrites(writes)
    const open = vi.spyOn(fsp, 'open')
    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      const mutations = createMutations(world.locator)
      const listed = await mutations.list()
      expect(listed.errors.map((error) => error.code)).toContain('parse-failed')
      expect(listed.data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ recovery: 'blocked', undoneBy: null })
      expect((await mutations.undo('journal:old-move')).data).toBeNull()
      expect(open).not.toHaveBeenCalled()
      expect(readFile.mock.calls.every(([file]) => String(file) === journalPath)).toBe(true)
    } finally {
      readFile.mockRestore()
      open.mockRestore()
      for (const restore of restores) restore()
    }
    expect(writes).toEqual([])
    expect(await fsp.readFile(path.join(source, 'data.bin'))).toEqual(occupant)
    expect(await fsp.readFile(path.join(saved, 'data.bin'))).toEqual(savedBytes)
    expect(await exists(path.join(world.kondoDataRoot, 'trash', undo.id))).toBe(false)
    expect(await fsp.readFile(journalPath)).toEqual(journal)
  })

  it('refuses a legacy pending Undo while keeping its saved bytes and journal exact', async () => {
    const intent = moveIntent()
    const saved = path.join(world.kondoDataRoot, 'trash', intent.id, 'user', 'source')
    await fsp.mkdir(path.dirname(saved), { recursive: true })
    await fsp.rename(path.join(world.userRoot, 'source'), saved)
    const undo = {
      ...intent, id: 'old-undo', steps: [], undoOf: intent.id,
      actions: [{ type: 'move', step: 0,
        from: { store: 'user', relative: 'user/source', trashId: intent.id },
        to: { store: 'user', relative: 'source' } }],
      progress: { next: 0, pending: null, state: 'running' }
    }
    const journal = await saveJournal([
      intent,
      progressRow(intent, 'old-forward-pending', { next: 0, pending: legacyDigest, state: 'running' }),
      progressRow(intent, 'old-forward-complete', { next: 1, pending: null, state: 'complete' }),
      undo,
      progressRow(undo, 'old-undo-pending', { next: 0, pending: legacyDigest, state: 'running' })
    ])
    const savedBytes = await fsp.readFile(path.join(saved, 'data.bin'))
    const writes: string[] = []
    const restores = recordWrites(writes)
    const open = vi.spyOn(fsp, 'open')
    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      const mutations = createMutations(world.locator)
      expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move'))
        .toMatchObject({ recovery: 'blocked', undoBlockedReason: expect.stringContaining('older fingerprint') })
      const refused = await mutations.undo('journal:old-move')
      expect(refused.data).toMatchObject({ id: 'journal:old-undo', outcome: 'uncertain', failed: true })
      expect(refused.errors[0]?.message).toContain('older fingerprint')
      expect(open).not.toHaveBeenCalled()
      expect(readFile.mock.calls.every(([file]) => String(file) === path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(true)
    } finally {
      readFile.mockRestore()
      open.mockRestore()
      for (const restore of restores) restore()
    }
    expect(writes).toEqual([])
    expect(await exists(path.join(world.userRoot, 'source'))).toBe(false)
    expect(await fsp.readFile(path.join(saved, 'data.bin'))).toEqual(savedBytes)
    expect(await fsp.readFile(path.join(world.kondoDataRoot, 'journal.jsonl'))).toEqual(journal)
  })

  it('keeps a completed legacy move usable after its old pending checkpoint', async () => {
    const intent = moveIntent()
    const saved = path.join(world.kondoDataRoot, 'trash', intent.id, 'user', 'source')
    await fsp.mkdir(path.dirname(saved), { recursive: true })
    await fsp.rename(path.join(world.userRoot, 'source'), saved)
    await saveJournal([
      intent,
      progressRow(intent, 'old-pending', { next: 0, pending: legacyDigest, state: 'running' }),
      progressRow(intent, 'old-complete', { next: 1, pending: null, state: 'complete' })
    ])
    const mutations = createMutations(world.locator)
    expect((await mutations.list()).data.find((row) => row.id === 'journal:old-move'))
      .toMatchObject({ outcome: 'complete', recovery: 'available' })
    const undone = await mutations.undo('journal:old-move')
    expect(undone.errors).toEqual([])
    expect(await fsp.readFile(path.join(world.userRoot, 'source', 'data.bin'))).toEqual(bytes)
    expect(await exists(saved)).toBe(false)
  })
})

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
      summary: 'Move alpha-skill, copy then trash beta-skill',
      steps: [
        { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' },
        { type: 'copy', store: 'user', from: 'skills/beta-skill', toStore: 'user', to: 'copies/beta-skill' },
        { type: 'trash', store: 'user', from: 'skills/beta-skill' }
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

  it('keeps an Undo with no effects retryable after restarting (099)', async () => {
    const before = await hashTree(world.userRoot)
    const done = await mutations.mutate({ op: 'trash', kind: 'skill',
      entityId: 'skill:user:beta-skill', summary: 'Trash beta-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }] })
    const rename = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('fixture restore denied'))
    const refused = await mutations.undo(done.data!.id)
    expect(refused.errors).not.toEqual([])
    rename.mockRestore()
    mutations = createMutations(world.locator)
    expect((await mutations.list()).data.find((entry) => entry.id === done.data!.id)?.undoneBy).toBeNull()
    expect((await mutations.undo(done.data!.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('resumes a partial Undo without touching an already restored and subsequently edited file', async () => {
    const done = await mutations.mutate({ op: 'trash', kind: 'skill',
      entityId: 'skill:user:alpha-skill', summary: 'Trash two skills',
      steps: ['alpha-skill', 'beta-skill'].map((name) => ({ type: 'trash' as const, store: 'user', from: `skills/${name}` })) })
    const rename = fsp.rename.bind(fsp)
    const stop = vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === path.join(world.userRoot, 'skills', 'alpha-skill')) throw new Error('fixture second restore denied')
      return rename(from, to)
    })
    const partial = await mutations.undo(done.data!.id)
    expect(partial.data).toMatchObject({ isUndo: true, outcome: 'partial', failed: true })
    expect((await mutations.list()).data.find((row) => row.id === done.data!.id)).toMatchObject({ undoneBy: null, recovery: 'partial' })
    stop.mockRestore()
    const changed = path.join(world.userRoot, 'skills', 'beta-skill', 'SKILL.md')
    await fsp.writeFile(changed, 'external edit after completed restore')
    mutations = createMutations(world.locator)
    const resumed = await mutations.undo(done.data!.id)
    expect(resumed.data).toMatchObject({ id: partial.data!.id, outcome: 'complete', failed: false })
    expect(resumed.errors).toEqual([])
    expect(await fsp.readFile(changed, 'utf8')).toBe('external edit after completed restore')
    expect(await exists(path.join(world.userRoot, 'skills', 'alpha-skill'))).toBe(true)
    expect((await mutations.list()).data).toHaveLength(2)
  })

  it('resumes after displacing an occupant without displacing it again or losing either version', async () => {
    const original = path.join(world.userRoot, 'skills', 'beta-skill', 'SKILL.md')
    const originalBytes = await fsp.readFile(original, 'utf8')
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill',
      summary: 'Trash beta', steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }] })
    await writeFileTree(world.userRoot, { 'skills/beta-skill/SKILL.md': 'new occupant' })
    const rename = fsp.rename.bind(fsp)
    const stop = vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes(done.data!.id.slice(8))) throw new Error('fixture saved restore denied')
      return rename(from, to)
    })
    const partial = await mutations.undo(done.data!.id)
    expect(partial.data?.outcome).toBe('partial')
    const occupant = path.join(world.kondoDataRoot, 'trash', partial.data!.id.slice(8), 'user', 'skills', 'beta-skill', 'SKILL.md')
    expect(await fsp.readFile(occupant, 'utf8')).toBe('new occupant')
    expect(await exists(original)).toBe(false)
    stop.mockRestore()
    const resumed = await createMutations(world.locator).undo(done.data!.id)
    expect(resumed.errors).toEqual([])
    expect(await fsp.readFile(original, 'utf8')).toBe(originalBytes)
    expect(await fsp.readFile(occupant, 'utf8')).toBe('new occupant')
  })

  it.each(['pending', 'effect', 'close'] as const)('recovers a restart at Undo %s without assuming a journal error means no effects', async (phase) => {
    const before = await hashTree(world.userRoot)
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill',
      summary: 'Trash beta', steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }] })
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const open = fsp.open.bind(fsp)
    const rename = fsp.rename.bind(fsp)
    let moved = false
    let injected = false
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      moved = true
    })
    vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) !== journal) return open(...args)
      const lines = (await fsp.readFile(journal, 'utf8')).trim().split('\n')
      const last = JSON.parse(lines.at(-1)!) as { undoOf: string | null; progress?: { next: number; pending: string | null } }
      if ((phase === 'effect' && moved) || (phase === 'close' && last.undoOf && last.progress?.next === 1)) {
        injected = true
        throw new Error('fixture interrupted before checkpoint publication')
      }
      const handle = await open(...args)
      if (phase === 'pending') {
        const sync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await sync()
          const raw = (await fsp.readFile(journal, 'utf8')).trim().split('\n')
          const current = JSON.parse(raw.at(-1)!) as { undoOf: string | null; progress?: { pending: string | null } }
          if (current.undoOf && current.progress?.pending) {
            injected = true
            throw new Error('fixture interrupted after pending intent sync')
          }
        })
      }
      return handle
    })
    const interrupted = await mutations.undo(done.data!.id)
    expect(injected).toBe(true)
    expect(interrupted.data).toMatchObject({ outcome: 'uncertain', failed: true })
    expect(moved).toBe(phase !== 'pending')
    vi.restoreAllMocks()
    mutations = createMutations(world.locator)
    expect((await mutations.list()).data.find((entry) => entry.id === done.data!.id)?.undoneBy).toBeNull()
    const observed = vi.spyOn(fsp, 'rename')
    const resumed = await mutations.undo(done.data!.id)
    expect(resumed.errors).toEqual([])
    expect(resumed.data?.outcome).toBe('complete')
    expect(observed).toHaveBeenCalledTimes(phase === 'pending' ? 1 : 0)
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('keeps ambiguous pending Undo bytes and refuses replay after restart', async () => {
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill',
      summary: 'Trash beta', steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }] })
    const rename = fsp.rename.bind(fsp)
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      await writeFileTree(world.userRoot, { 'skills/beta-skill/SKILL.md': 'external changed restored bytes' })
      throw new Error('fixture lost acknowledgement after restore')
    })
    const interrupted = await mutations.undo(done.data!.id)
    expect(interrupted.data?.outcome).toBe('uncertain')
    vi.restoreAllMocks()
    const before = await hashTree(world.base)
    const moves = vi.spyOn(fsp, 'rename')
    const retry = await createMutations(world.locator).undo(done.data!.id)
    expect(retry.data?.outcome).toBe('uncertain')
    expect(retry.errors[0]?.message).toContain('Recovery is uncertain')
    expect(moves).not.toHaveBeenCalled()
    expect(await hashTree(world.base)).toBe(before)
  })

  it('recovers an uncheckpointed forward effect without executing remaining forward steps', async () => {
    const before = await hashTree(world.userRoot)
    const open = fsp.open.bind(fsp)
    const rename = fsp.rename.bind(fsp)
    let moved = false
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => { await rename(from, to); moved = true })
    vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (moved && String(args[0]).endsWith('journal.jsonl')) throw new Error('fixture journal unavailable after move')
      return open(...args)
    })
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:alpha-skill',
      summary: 'Trash two skills', steps: ['alpha-skill', 'beta-skill'].map((name) =>
        ({ type: 'trash' as const, store: 'user', from: `skills/${name}` })) })
    expect(done.data?.outcome).toBe('uncertain')
    expect(await exists(path.join(world.userRoot, 'skills', 'beta-skill'))).toBe(true)
    vi.restoreAllMocks()
    const observed = vi.spyOn(fsp, 'rename')
    const undone = await createMutations(world.locator).undo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(observed).toHaveBeenCalledOnce()
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('does not consume an original through a failed legacy Undo or its failure marker', async () => {
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const legacy = { id: 'legacy', at: '2026-09-01T00:00:00Z', op: 'trash', kind: 'skill',
      entityId: 'skill:user:beta-skill', summary: 'Legacy trash', undoOf: null,
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill', displaced: 'user/skills/beta-skill' }] }
    const undo = { ...legacy, id: 'legacy-undo', undoOf: legacy.id, steps: [] }
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': [legacy, undo,
      { ...undo, id: 'failure', failedOf: undo.id }].map((row) => JSON.stringify(row)).join('\n') + '\n' })
    const before = await hashTree(world.base)
    const listed = await mutations.list()
    expect(listed.data).toHaveLength(2)
    expect(listed.data.find((row) => row.id === 'journal:legacy')).toMatchObject({ undoneBy: null, recovery: 'blocked' })
    expect((await mutations.undo('journal:legacy')).errors[0]?.message).toContain('without recording')
    expect(await hashTree(world.base)).toBe(before)
    expect(await fsp.readFile(journal, 'utf8')).toContain('"failedOf":"legacy-undo"')
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
    expect(done.data).toMatchObject({ outcome: 'partial', failed: true })
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
    expect(done.data).toMatchObject({ outcome: 'partial', failed: true })
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

  // Settings writes are suspended. Historical state is built directly in the
  // fixture so recovery coverage never bypasses the production restriction.
  const settingsFile = (): string => path.join(world.userRoot, 'settings.json')
  const readSettings = (): Promise<string> => fsp.readFile(settingsFile(), 'utf8')
  const spliceQuietToLoud = (source: string, expectDigest = digestSource(source)) =>
    mutations.mutate({ op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user',
      summary: 'Splice outputStyle', steps: [{ type: 'splice', store: 'user', at: 'settings.json',
        expectDigest, edits: [{ at: source.indexOf('quiet'), remove: 5, insert: 'loud' }] }] })
  const expectUnavailable = (result: Awaited<ReturnType<Mutations['mutate']>>) => {
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted',
      message: expect.stringContaining('temporarily unavailable') })])
  }

  it('retains reversible byte edits without permitting publication', async () => {
    const source = await readSettings()
    const edits = [{ at: source.indexOf('quiet'), remove: 5, insert: 'loud' }]
    const next = applyEdits(source, edits)!
    expect(next).toBe(source.replace('quiet', 'loud'))
    expect(applyEdits(next, invertEdits(source, edits)!)).toBe(source)
    const before = await hashTree(world.base)
    expectUnavailable(await spliceQuietToLoud(source))
    expect(await hashTree(world.base)).toBe(before)
  })

  it.each(['write', 'splice'] as const)('refuses a %s before any journal or temporary I/O (A2)', async (type) => {
    const source = await readSettings()
    // These are the old race/failure phases. None is reachable under refusal.
    const open = vi.spyOn(fsp, 'open').mockRejectedValue(new Error('journal/temp open must not run'))
    const write = vi.spyOn(fsp, 'writeFile').mockRejectedValue(new Error('write must not run'))
    const rename = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('publication must not run'))
    const rm = vi.spyOn(fsp, 'rm').mockRejectedValue(new Error('cleanup must not run'))
    const before = await hashTree(world.base)
    const result = type === 'splice' ? await spliceQuietToLoud(source) : await mutations.mutate({
      op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user', summary: 'Write settings',
      steps: [{ type, store: 'user', at: 'settings.json', content: '{}' }]
    })
    expectUnavailable(result)
    expect(open).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(rm).not.toHaveBeenCalled()
    expect(await hashTree(world.base)).toBe(before)
    expect((await mutations.list()).data).toEqual([])
  })

  it.each(['write', 'splice'] as const)('refuses missing %s targets without creating ancestors', async (type) => {
    const before = await hashTree(world.base)
    const result = await mutations.mutate({ op: 'settings-edit', kind: 'settings',
      entityId: 'settings:user:user', summary: 'Create missing settings',
      steps: [type === 'write'
        ? { type, store: 'user', at: 'new/nested/settings.json', content: '{}' }
        : { type, store: 'user', at: 'new/nested/settings.json', expectDigest: digestSource('{}'), edits: [] }]
    })
    expectUnavailable(result)
    expect(await hashTree(world.base)).toBe(before)
    expect(await exists(path.join(world.userRoot, 'new'))).toBe(false)
  })

  it.each(['write', 'splice'] as const)('refuses the whole mixed %s plan before a move or preflight', async (type) => {
    const source = await readSettings()
    const settingsStep = type === 'write'
      ? { type, store: 'user', at: 'settings.json', content: '{}' }
      : { type, store: 'user', at: 'settings.json', expectDigest: digestSource(source), edits: [] }
    const move = { type: 'move' as const, store: 'user', from: 'skills/alpha-skill', to: 'skills/moved' }
    const before = await hashTree(world.base)
    const preflight = vi.fn(async () => null)
    for (const steps of [[move, settingsStep], [settingsStep, move]]) {
      expectUnavailable(await mutations.mutate({ op: 'move', kind: 'skill',
        entityId: 'skill:user:alpha-skill', summary: 'Mixed move and settings edit', steps, preflight }))
    }
    expect(preflight).not.toHaveBeenCalled()
    expect(await hashTree(world.base)).toBe(before)
  })

  it.each(['planning', 'preflight'] as const)('refuses settings steps appended during %s before journaling', async (phase) => {
    const plan: MutationPlan = { op: 'move', kind: 'skill', entityId: 'skill:user:alpha-skill',
      summary: 'Mutable internal request', steps: [{ type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills/moved' }] }
    let appended = false
    const append = () => {
      if (appended) return
      appended = true
      plan.steps.push({ type: 'write', store: 'user', at: 'settings.json', content: '{}' })
    }
    if (phase === 'preflight') plan.preflight = async () => { append(); return null }
    else {
      const lstat = fsp.lstat.bind(fsp)
      vi.spyOn(fsp, 'lstat').mockImplementation(async (...args: Parameters<typeof fsp.lstat>) => {
        const info = await lstat(...args)
        append()
        return info
      })
    }
    const before = await hashTree(world.base)
    // Hashing must precede the watched planning seam.
    appended = false
    if (plan.steps.length > 1) plan.steps.pop()
    expectUnavailable(await mutations.mutate(plan))
    expect(appended).toBe(true)
    expect(await hashTree(world.base)).toBe(before)
    expect((await mutations.list()).data).toEqual([])
  })

  it('retains unrelated history read errors alongside the settings refusal', async () => {
    const historical = await settingsHistory(world)
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    await fsp.appendFile(journal, 'broken history line\n')
    const before = await hashTree(world.base)
    const result = await mutations.undo(historical.id)
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toEqual(['parse-failed', 'not-permitted'])
    expect(await hashTree(world.base)).toBe(before)
  })

  it.each(['in-place', 'atomic'] as const)('preserves a queued external %s write and permits the unrelated move and Undo', async (mode) => {
    const source = await readSettings()
    let release!: () => void
    let entered!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const moving = mutations.mutate({ op: 'move', kind: 'skill', entityId: 'skill:user:alpha-skill',
      summary: 'Unrelated move', steps: [{ type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills/moved' }],
      preflight: async () => { entered(); await paused; return null } })
    await ready
    const denied = spliceQuietToLoud(source)
    const external = '{ "outputStyle": "external", "other": 999 }\n'
    try {
      if (mode === 'atomic') {
        const temp = settingsFile() + '.external'
        await fsp.writeFile(temp, external)
        await fsp.rename(temp, settingsFile())
      } else await fsp.writeFile(settingsFile(), external)
    } finally { release() }
    const moved = await moving
    expect(moved.errors).toEqual([])
    expectUnavailable(await denied)
    expect(await readSettings()).toBe(external)
    expect((await mutations.list()).data).toHaveLength(1)
    expect((await mutations.undo(moved.data!.id)).errors).toEqual([])
    expect(await readSettings()).toBe(external)
    expect(await exists(path.join(world.userRoot, 'skills/alpha-skill'))).toBe(true)
  })

  it.each(['write', 'splice'] as const)('retains historical %s recovery and leaves retries unrecorded', async (type) => {
    const historical = await settingsHistory(world, type)
    const before = await hashTree(world.base)
    const listed = await mutations.list()
    expect(listed.data[0]).toMatchObject({ id: historical.id, undoneBy: null, failed: false })
    for (let retry = 0; retry < 3; retry++) expectUnavailable(await mutations.undo(historical.id))
    expect(await hashTree(world.base)).toBe(before)
    expect(await mutations.list()).toEqual(listed)
  })

  it.each(['write', 'splice'] as const)('refuses historical %s Undo before publication after an external write during history read (A2)', async (type) => {
    const historical = await settingsHistory(world, type)
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const journal = await fsp.readFile(journalFile, 'utf8')
    const external = '{ "outputStyle": "external", "other": 999 }\n'
    const readFile = fsp.readFile.bind(fsp)
    let injected = false
    vi.spyOn(fsp, 'readFile').mockImplementation(async (...args: Parameters<typeof fsp.readFile>) => {
      const bytes = await readFile(...args)
      if (String(args[0]) === journalFile && !injected) {
        injected = true
        const candidate = settingsFile() + '.external'
        await fsp.writeFile(candidate, external)
        await fsp.rename(candidate, settingsFile())
      }
      return bytes
    })
    const open = vi.spyOn(fsp, 'open')
    expectUnavailable(await mutations.undo(historical.id))
    expect(injected).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(await readSettings()).toBe(external)
    expect(await fsp.readFile(journalFile, 'utf8')).toBe(journal)
    expect((await mutations.list()).data[0]?.undoneBy).toBeNull()
  })

  it.each(['not-run', 'partial', 'emptied'] as const)('leaves a historical %s settings operation intact on Undo refusal', async (phase) => {
    const historical = await settingsHistory(world, 'write')
    if (phase === 'not-run') {
      await fsp.writeFile(settingsFile(), historical.source)
      await fsp.rm(path.join(world.kondoDataRoot, 'trash'), { recursive: true })
    } else if (phase === 'partial') {
      const kept = path.join(world.kondoDataRoot, 'trash/fixture-settings/user/skills/beta-skill')
      await fsp.mkdir(path.dirname(kept), { recursive: true })
      await fsp.rename(path.join(world.userRoot, 'skills/beta-skill'), kept)
      const record = { ...historical.record, steps: [
        { type: 'trash', store: 'user', from: 'skills/beta-skill', displaced: 'user/skills/beta-skill' },
        ...historical.record.steps] }
      await fsp.writeFile(path.join(world.kondoDataRoot, 'journal.jsonl'),
        JSON.stringify(record) + '\n' + JSON.stringify({ ...record, id: 'fixture-failure', steps: [], failedOf: record.id }) + '\n')
    } else await mutations.emptyTrash()
    const before = await hashTree(world.base)
    expectUnavailable(await mutations.undo(historical.id))
    expect(await hashTree(world.base)).toBe(before)
    if (phase === 'partial') expect((await mutations.list()).data[0]?.failed).toBe(true)
  })

  it('does not clean up an old temporary sibling or existing recovery bytes on refusal', async () => {
    const historical = await settingsHistory(world)
    const temporary = settingsFile() + '.kondo-old-attempt'
    await fsp.writeFile(temporary, 'unclassified recovery bytes')
    const before = await hashTree(world.base)
    expectUnavailable(await spliceQuietToLoud(historical.source))
    expectUnavailable(await mutations.undo(historical.id))
    expect(await hashTree(world.base)).toBe(before)
  })

  it.for(['file', 'directory'] as const)('preserves an in-store %s link and referent through refused apply and Undo', async (kind, ctx) => {
    const historical = await settingsHistory(world)
    const backing = path.join(world.userRoot, 'backing')
    await fsp.mkdir(backing)
    await fsp.rename(settingsFile(), path.join(backing, 'settings.json'))
    const link = kind === 'file' ? settingsFile() : path.join(world.userRoot, 'linked')
    const referent = kind === 'file' ? path.join(backing, 'settings.json') : backing
    try { await fsp.symlink(referent, link, kind === 'file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir') }
    catch (cause) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((cause as NodeJS.ErrnoException).code ?? '')) ctx.skip('Fixture symlink unavailable')
      throw cause
    }
    const originalLink = await fsp.readlink(link)
    expectUnavailable(await mutations.mutate({ op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user',
      summary: 'Linked settings', steps: [{ type: 'splice', store: 'user', at: kind === 'file' ? 'settings.json' : 'linked/settings.json',
        expectDigest: digestSource(historical.next), edits: [] }] }))
    expectUnavailable(await mutations.undo(historical.id))
    expect(await fsp.readFile(path.join(backing, 'settings.json'), 'utf8')).toBe(historical.next)
    expect((await fsp.lstat(link)).isSymbolicLink()).toBe(true)
    expect(await fsp.readlink(link)).toBe(originalLink)
    expect(await fsp.readdir(backing)).toEqual(['settings.json'])
  })

  it('refuses stale settings without requiring a digest or a successful filesystem read', async () => {
    const source = await readSettings()
    const before = await hashTree(world.base)
    const read = vi.spyOn(fsp, 'readFile').mockRejectedValue(new Error('fixture read failure'))
    expectUnavailable(await spliceQuietToLoud(source, digestSource('{}')))
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
    expect(await hashTree(world.base)).toBe(before)
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
          type: 'trash',
          store: 'user-config',
          from: '.bashrc'
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
        summary: 'A sweep across available step kinds',
        steps: [
          { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills.disabled/alpha-skill' },
          { type: 'copy', store: 'user', from: 'skills/beta-skill', toStore: 'user', to: 'copies/beta-skill' },
          { type: 'trash', store: 'user', from: 'skills/beta-skill' }
        ]
      })
      expect(done.errors).toEqual([])
      expect((await mutations.undo(done.data!.id)).errors).toEqual([])
      const refused = await mutations.mutate({ op: 'settings-edit', kind: 'settings', entityId: 'settings:user:user',
        summary: 'Refused registry splice', steps: [{ type: 'splice', store: 'user-config',
          at: path.basename(world.locator.userConfigFile), expectDigest: digestSource(registry), edits: [] }] })
      expectUnavailable(refused)

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
    // Refused settings writes never create a temporary sibling.
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
    const record = JSON.parse((await fsp.readFile(journalFile, 'utf8')).split('\n')[0]!) as Record<string, unknown>
    const priorLines = (await fsp.readFile(journalFile, 'utf8')).trim().split('\n').length
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
      malformed.map((_, index) => ['parse-failed', `journal.jsonl:${index + priorLines + 1}`])
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
    const record = JSON.parse((await fsp.readFile(journalFile, 'utf8')).split('\n')[0]!) as Record<string, unknown>
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
    const historical = await settingsHistory(world)
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const record = { ...historical.record, extraMetadata: 'preserved', steps: [
      { type: 'move', store: 'user', from: 'skills/alpha-skill', to: 'skills/moved-skill' },
      { type: 'copy', store: 'user', from: 'skills/beta-skill', toStore: 'user', to: 'skills/copied-skill' },
      { type: 'trash', store: 'user', from: 'skills/beta-skill', displaced: 'user/skills/beta-skill' },
      { type: 'write', store: 'user', from: 'settings.json' },
      ...historical.record.steps
    ] }
    await fsp.writeFile(journalFile, JSON.stringify(record) + '\n')
    const before = await hashTree(world.base)
    const listed = await mutations.list()
    expect(listed.errors).toEqual([])
    expect(listed.data[0]).toMatchObject({ id: historical.id, stepCount: 5, undoneBy: null })
    expectUnavailable(await mutations.undo(historical.id))
    expect(await hashTree(world.base)).toBe(before)
    expect(await mutations.list()).toEqual(listed)
  })

  it('does not repeat a completed undo when its journal summary becomes corrupt', async () => {
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:alpha-skill', summary: 'Trash alpha-skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/alpha-skill' }]
    })
    const undone = await mutations.undo(done.data!.id)
    expect(undone.errors).toEqual([])
    await fsp.writeFile(settingsFile(), '{ "theme": "a later edit" }')
    const before = await hashTree(world.userRoot)
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const records = (await fsp.readFile(journalFile, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    records.find((record) => record.undoOf !== null && record.progressOf === undefined)!.summary = null
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
    expect(failed.data).toMatchObject({ outcome: 'none', failed: true })
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
    const historical = await settingsHistory(world)
    const done = { data: { id: historical.id } }
    await fsp.writeFile(settingsFile(), '{ "theme": "a later edit" }')
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const undo = { ...historical.record, id: 'fixture-undo', undoOf: historical.record.id, steps: [] }
    const failure = { ...undo, id: 'fixture-undo-failure', failedOf: undo.id }
    const records: Array<Record<string, unknown>> = [historical.record, undo, failure]

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

  it('rejects an Undo whose actions omit a completed forward step even with an adjusted close', async () => {
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:alpha-skill',
      summary: 'Trash two skills', steps: ['alpha-skill', 'beta-skill'].map((name) =>
        ({ type: 'trash' as const, store: 'user', from: `skills/${name}` })) })
    const undone = await mutations.undo(done.data!.id)
    const journal = path.join(world.kondoDataRoot, 'journal.jsonl')
    const records = (await fsp.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as {
      id: string; progressOf?: string; actions?: unknown[]; progress?: { next: number; pending: string | null; state: string }
    })
    const undoId = undone.data!.id.slice(8)
    records.find((row) => row.id === undoId)!.actions!.pop()
    const damaged = records.filter((row) => row.progressOf !== undoId ||
      row.progress!.next < 1 || row.progress!.pending === null).map((row) => {
      if (row.progressOf === undoId) row.progress!.next = Math.min(1, row.progress!.next)
      return JSON.stringify(row)
    }).join('\n') + '\n'
    await fsp.writeFile(journal, damaged)
    const before = await hashTree(world.base)
    mutations = createMutations(world.locator)
    const listed = await mutations.list()
    expect(listed.errors.some((error) => error.message.includes('actions do not match'))).toBe(true)
    expect(listed.data.find((row) => row.id === done.data!.id)?.undoneBy).toBeNull()
    const retry = await mutations.undo(done.data!.id)
    expect(retry.data).toBeNull()
    expect(retry.errors.at(-1)?.message).toContain('damaged history entry')
    expect(await hashTree(world.base)).toBe(before)
  })

  it('isolates a torn final journal line and keeps a later intent readable', async () => {
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': '{"id":"torn","progressOf":' })
    const done = await mutations.mutate({ op: 'trash', kind: 'skill', entityId: 'skill:user:beta-skill',
      summary: 'Trash beta', steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill' }] })
    expect(done.data?.outcome).toBe('complete')
    const listed = await mutations.list()
    expect(listed.data).toHaveLength(1)
    expect(listed.data[0]?.id).toBe(done.data!.id)
    expect(listed.errors).toHaveLength(1)
    expect(listed.errors[0]?.code).toBe('parse-failed')
    const undone = await createMutations(world.locator).undo(done.data!.id)
    expect(undone.data?.outcome).toBe('complete')
    expect(undone.errors).toEqual(listed.errors)
  })

  it.each([
    { id: '..', displaced: 'journal.jsonl' },
    { id: 'legacy', displaced: '../../journal.jsonl' }
  ])('refuses a historical trash endpoint escaping its journal bucket: %j', async ({ id, displaced }) => {
    const record = { id, at: '2026-09-01T00:00:00Z', op: 'trash', kind: 'skill',
      entityId: 'skill:user:beta-skill', summary: 'Malformed recovery endpoint', undoOf: null,
      steps: [{ type: 'trash', store: 'user', from: 'skills/beta-skill', displaced }] }
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': JSON.stringify(record) + '\n' })
    const before = await hashTree(world.base)
    const result = await mutations.undo(`journal:${id}`)
    expect(result.data).toBeNull()
    expect(result.errors[0]?.code).toBe('out-of-store')
    expect(await hashTree(world.base)).toBe(before)
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
      `project-entry:${slashed(dead)}`
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

  it.each([
    ['project-entry'],
    ['enabled-plugin', 'enabled-plugin'],
    ['project-entry', 'mcp-declaration'],
    ['project-entry', 'enabled-plugin']
  ])('refuses settings leftovers %j without changing any selected file or history', async (...kinds) => {
    const names: Record<string, string[]> = { 'project-entry': [slashed(dead)],
      'enabled-plugin': ['ghost@acme', 'phantom@acme'], 'mcp-declaration': ['ghost-server'] }
    const ids: string[] = []
    for (const kind of kinds) ids.push(await orphan(kind, names[kind]!.shift()!))
    const before = await hashTree(world.base)
    const result = await api.configOrphansRemove(ids)
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([expect.objectContaining({ code: 'not-permitted',
      message: expect.stringContaining('temporarily unavailable') })])
    expect(await hashTree(world.base)).toBe(before)
    expect(await readSettings()).toBe(USER_SETTINGS)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses historical registry Undo while preserving Claude updates and its inverse edits', async () => {
    const source = await readRegistry()
    const at = source.indexOf('41')
    const next = source.slice(0, at) + '42' + source.slice(at + 2)
    const rawId = 'f1111111-1111-4111-8111-111111111111'
    const record = { id: rawId, at: '2026-09-01T00:00:00.000Z', op: 'settings-edit', kind: 'settings',
      entityId: 'settings:user:user', summary: 'Historical registry edit', undoOf: null,
      steps: [{ type: 'splice', store: 'user-config', from: path.basename(world.locator.userConfigFile),
        expectDigest: digestSource(source), resultDigest: digestSource(next),
        edits: [{ at, remove: 2, insert: '42' }], undoEdits: [{ at, remove: 2, insert: '41' }] }] }
    await writeFileTree(world.kondoDataRoot, { 'journal.jsonl': JSON.stringify(record) + '\n' })
    const theirs = next.replace('"numStartups": 42', '"numStartups": 99')
    await fsp.writeFile(world.locator.userConfigFile, theirs)
    const before = await hashTree(world.base)
    const listed = await api.journalList()
    expect(listed.errors).toEqual([])
    expect(listed.data).toHaveLength(1)
    for (let retry = 0; retry < 2; retry++) {
      const undone = await api.journalUndo(listed.data[0]!.id)
      expect(undone.data).toBeNull()
      expect(undone.errors.map((error) => error.code)).toEqual(['not-permitted'])
    }
    expect(await hashTree(world.base)).toBe(before)
    expect(await readRegistry()).toBe(theirs)
    expect(await api.journalList()).toEqual(listed)
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
