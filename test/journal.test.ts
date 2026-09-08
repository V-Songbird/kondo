import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, TidyCategory } from '../shared/contract'
import { STALE_AFTER_DAYS } from '../electron/main/workspace/analysis'
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
  type FixtureWorld
} from './helpers'

/**
 * The journal and the trash as the UI reads them (ADR-0001). Three promises,
 * and every case here is one of them: the list is newest first and says what
 * each mutation did, undo from that list goes through the one restore path
 * and puts the store back, and emptying the trash is a thing that happens
 * only when it is asked for by name.
 *
 * The last one is the reason this file exists. Emptying is kondo's single
 * destructive act, so "no other operation does it" is not a UI convention to
 * be trusted — it is an invariant to be proven.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 1)
const FRESH = new Date(NOW - DAY_MS)
const LONG_AGO = new Date(NOW - (STALE_AFTER_DAYS + 30) * DAY_MS)

const DIR = 'D--Projects-app'

describe('the journal and trash surface (ADR-0001)', () => {
  let world: FixtureWorld
  let api: KondoApi
  let trashRoot: string
  let journalFile: string
  let destinationId: string

  const reviewedSweep = async (categories: TidyCategory[]) => {
    const preview = await api.tidyPreview()
    expect(preview.errors).toEqual([])
    expect(preview.data.reviewToken).toEqual(expect.any(String))
    return api.tidySweep(categories, preview.data.reviewToken!)
  }

  const inStore = (relative: string): string =>
    path.join(world.userRoot, ...relative.split('/'))

  /** Every entry under a root, root-relative and sorted — files and dirs both. */
  const listTree = async (root: string): Promise<string[]> => {
    const entries = await fs.readdir(root, { withFileTypes: true, recursive: true })
    return entries
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      )
      .sort()
  }

  beforeEach(async () => {
    world = await makeWorld()
    trashRoot = path.join(world.kondoDataRoot, 'trash')
    journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const workdir = path.join(world.base, 'work', 'destination')
    destinationId = 'project:code:' + flattenPath(workdir)
    await writeFileTree(workdir, { '.claude/skills/.keep': '' })
    await registerProjects(world, [workdir])

    await writeFileTree(world.userRoot, {
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill'),
      'skills/beta-skill/SKILL.md': skillManifest('beta-skill', 'Second skill'),
      // One fresh transcript the sweep must never touch, one stale enough to
      // give the trash something real to hold.
      [`projects/${DIR}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${DIR}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      'settings.json': '{\n  "outputStyle": "quiet"\n}\n'
    })
    await fs.utimes(inStore(`projects/${DIR}/${UUID_A}.jsonl`), FRESH, FRESH)
    await fs.utimes(inStore(`projects/${DIR}/${UUID_B}.jsonl`), LONG_AGO, LONG_AGO)

    // A clock that moves: two entries written in the same test must carry
    // different timestamps, or "newest first" proves nothing.
    let clock = NOW
    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      now: () => (clock += 1000),
      guessExists: async (target) =>
        target === workdir || target === path.join(workdir, '.claude') ? 'present' : 'absent'
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  // ---------------------------------------------------------------------------
  // The list

  it('lists entries newest first, each saying what it did', async () => {
    const first = await api.skillMove('skill:user:alpha-skill', destinationId)
    const second = await api.skillMove('skill:user:beta-skill', destinationId)
    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])

    const listed = await api.journalList()
    expect(listed.errors).toEqual([])
    expect(listed.data.map((entry) => entry.id)).toEqual([second.data!.id, first.data!.id])
    expect(Date.parse(listed.data[0]!.at)).toBeGreaterThan(Date.parse(listed.data[1]!.at))

    // Enough per entry to say what happened without the renderer knowing a
    // path (ADR-0002, ADR-0008): a summary, the id, the kind, the step count.
    const newest = listed.data[0]!
    expect(newest.summary).toContain('beta-skill')
    expect(newest.entityId).toBe('skill:user:beta-skill')
    expect(newest.kind).toBe('skill')
    expect(newest.op).toBe('move')
    expect(newest.stepCount).toBeGreaterThan(0)
    expect(newest.undoneBy).toBeNull()
    expect(newest.isUndo).toBe(false)
  })

  it('puts an undo at the head and marks the entry it reversed', async () => {
    const done = await api.skillMove('skill:user:alpha-skill', destinationId)
    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])

    const listed = await api.journalList()
    expect(listed.data[0]!.id).toBe(undone.data!.id)
    expect(listed.data[0]!.isUndo).toBe(true)
    expect(listed.data.find((entry) => entry.id === done.data!.id)!.undoneBy).toBe(
      undone.data!.id
    )
  })

  it('returns partial forward effects with the entry that the inline result can undo', async () => {
    const before = await hashTree(world.userRoot)
    const rename = fs.rename.bind(fs)
    const stop = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) === inStore('skills/alpha-skill')) throw new Error('fixture source release denied')
      return rename(from, to)
    })
    const partial = await api.skillMove('skill:user:alpha-skill', destinationId)
    expect(partial.errors.length).toBeGreaterThan(0)
    expect(partial.data).toMatchObject({ outcome: 'partial', failed: true, isUndo: false, undoBlockedReason: null })
    expect((await api.journalList()).data[0]).toEqual(partial.data)
    stop.mockRestore()
    const undone = await api.journalUndo(partial.data!.id)
    expect(undone.errors).toEqual([])
    expect(undone.data?.outcome).toBe('complete')
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // ---------------------------------------------------------------------------
  // Undo from the list

  it('undoes an entry taken from the list, restoring the store byte-for-byte', async () => {
    const before = await hashTree(world.userRoot)
    expect((await api.skillMove('skill:user:alpha-skill', destinationId)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).not.toBe(before)

    // The id the view would hand back — straight off the listing, never a path.
    const fromList = (await api.journalList()).data[0]!
    const undone = await api.journalUndo(fromList.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('restores a whole sweep from one list row', async () => {
    const before = await hashTree(world.userRoot)
    const swept = await reviewedSweep(['stale-sessions'])
    expect(swept.errors).toEqual([])
    expect(swept.data).not.toBeNull()
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const fromList = (await api.journalList()).data[0]!
    expect(fromList.stepCount).toBeGreaterThan(0)
    expect((await api.journalUndo(fromList.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // ---------------------------------------------------------------------------
  // The trash's size, and emptying it

  it('reports what the trash holds, and empties only that', async () => {
    expect((await reviewedSweep(['stale-sessions'])).errors).toEqual([])

    const held = await api.trashSize()
    expect(held.errors).toEqual([])
    expect(held.data.bytes).toBeGreaterThan(0)
    expect(held.data.entryCount).toBe(1)
    expect(held.data.root).toContain('trash')

    const storeBefore = await hashTree(world.userRoot)
    const journalBefore = await fs.readFile(journalFile, 'utf8')

    const emptied = await api.trashEmpty()
    expect(emptied.errors).toEqual([])
    // It reports what actually went, not what it meant to remove.
    expect(emptied.data.bytes).toBe(held.data.bytes)
    expect(emptied.data.entryCount).toBe(held.data.entryCount)

    // The trash, and nothing else. Not a store byte, not a journal line.
    expect(await exists(trashRoot)).toBe(false)
    expect(await hashTree(world.userRoot)).toBe(storeBefore)
    expect(await fs.readFile(journalFile, 'utf8')).toBe(journalBefore)
    expect((await api.trashSize()).data.bytes).toBe(0)
    // The history survives its own bytes: still readable, still one entry.
    expect((await api.journalList()).data).toHaveLength(1)
  })

  it('answers a clean zero when there is nothing to empty', async () => {
    const emptied = await api.trashEmpty()
    expect(emptied.errors).toEqual([])
    expect(emptied.data.bytes).toBe(0)
    expect(emptied.data.entryCount).toBe(0)
  })

  it('refuses an undo whose displaced bytes were emptied, rather than half-restoring', async () => {
    const swept = await reviewedSweep(['stale-sessions'])
    expect(swept.data).not.toBeNull()
    await api.trashEmpty()

    const before = await hashTree(world.userRoot)
    const undone = await api.journalUndo(swept.data!.id)
    expect(undone.data).toBeNull()
    // A sentence naming the cause, not the errno the rename threw — this is
    // the refusal the journal view puts in front of the user.
    expect(undone.errors[0]!.message).toContain('emptied')
    expect(undone.errors[0]!.message).not.toContain('ENOENT')
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  // ---------------------------------------------------------------------------
  // The invariant the whole feature rests on

  it('never empties the trash as part of another operation', async () => {
    expect((await reviewedSweep(['stale-sessions'])).data).not.toBeNull()
    const kept = await listTree(trashRoot)
    expect(kept.length).toBeGreaterThan(0)

    const touched: string[] = []
    const restores = recordWrites(touched)
    try {
      // Every other method on the seam, reads and writes alike.
      await api.storesOverview()
      await api.sessionProjects(true)
      await api.sessionList(`project:code:${DIR}`)
      await api.desktopSessions()
      await api.skillsList()
      const refused = await api.skillToggle('skill:user:alpha-skill', 'disable')
      expect(refused.data).toBeNull()
      expect(refused.errors[0]?.code).toBe('not-permitted')
      await api.skillMove('skill:user:alpha-skill', destinationId)
      await api.pluginsList()
      await api.hooksList()
      await api.settingsLayers()
      await reviewedSweep(['stale-sessions', 'reclaimable-caches'])
      await api.journalList()
      await api.trashSize()
      await api.journalUndo((await api.journalList()).data[0]!.id)
    } finally {
      for (const restore of restores) restore()
    }

    // Every displaced byte the sweep put there is still there.
    for (const relative of kept) {
      expect(await exists(path.join(trashRoot, ...relative.split('/'))), relative).toBe(true)
    }
    // And the one call that would have removed them was never made: emptying
    // is `fs.rm` of the trash root, and nothing above asked for it.
    expect(touched).not.toContain(trashRoot)

    // Only the operation named for it does the removing.
    const emptied = await api.trashEmpty()
    expect(emptied.data.bytes).toBeGreaterThan(0)
    expect(await exists(trashRoot)).toBe(false)
  })
})
