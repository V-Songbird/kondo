import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  KondoApi,
  TidyCategory,
  TidyCategoryPreview,
  TidyPreview
} from '../shared/contract'
import { tidyCategories } from '../shared/contract'
import { STALE_AFTER_DAYS } from '../electron/main/workspace/analysis'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  desktopReleased,
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  recordWrites,
  registerProjects,
  UUID_A,
  UUID_B,
  UUID_C,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The tidy sweep (ADR-0001). Three promises, and every case here is one of
 * them: the preview moves nothing, the sweep moves exactly what the preview
 * named, and the whole sweep is one journal entry that undo restores
 * together. Nothing is ever unlinked — every swept item is in kondo's trash.
 */

const UUID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 1)
const FRESH = new Date(NOW - DAY_MS)
const LONG_AGO = new Date(NOW - (STALE_AFTER_DAYS + 70) * DAY_MS)

const DIR = 'D--Projects-app'
const ALL = [...tidyCategories]

/** Every entry under a root, root-relative and sorted — files and dirs both. */
async function listTree(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true })
  return entries
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
    )
    .sort()
}

function byCategory(preview: TidyPreview): Record<TidyCategory, TidyCategoryPreview> {
  const found = {} as Record<TidyCategory, TidyCategoryPreview>
  for (const entry of preview.categories) found[entry.category] = entry
  return found
}

describe('the tidy sweep (ADR-0001)', () => {
  let world: FixtureWorld
  let api: KondoApi

  const project = (relative: string): string => `projects/${DIR}/${relative}`
  const inStore = (relative: string): string =>
    path.join(world.userRoot, ...relative.split('/'))

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      // Fresh and healthy — the sweep must not go near it.
      [project(`${UUID_A}.jsonl`)]: healthyTranscript(UUID_A),
      // Stale, and carrying sidecar state that has to travel with it.
      [project(`${UUID_B}.jsonl`)]: healthyTranscript(UUID_B),
      [project(`${UUID_B}/agent.json`)]: '{"subagent":"one"}',
      // Empty AND stale: the empty category claims it, so no path is ever
      // queued twice and the counts do not double-report it.
      [project(`${UUID_C}.jsonl`)]: '',
      // A sidecar whose transcript is already gone.
      [project(`${UUID_D}/state.json`)]: '{"tool":"state"}',
      // Two reclaimable caches (domain.md)...
      'cache/blob.bin': 'x'.repeat(400),
      'debug/log.txt': 'debug output\n',
      // ...one that backs checkpoint/rewind, which kondo never offers...
      'backups/keep.txt': 'a backup worth keeping\n',
      'settings.json': '{}'
    })
    // ...and a reclaimable name holding nothing, which reclaims nothing.
    await fs.mkdir(inStore('telemetry'), { recursive: true })

    for (const relative of [`${UUID_B}.jsonl`, `${UUID_C}.jsonl`]) {
      await fs.utimes(inStore(project(relative)), LONG_AGO, LONG_AGO)
    }
    await fs.utimes(inStore(project(`${UUID_A}.jsonl`)), FRESH, FRESH)

    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      now: () => NOW,
      guessExists: async () => false
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  /** The store paths a full sweep displaces, children included. */
  const SWEPT = [
    project(`${UUID_B}.jsonl`),
    project(UUID_B),
    project(`${UUID_B}/agent.json`),
    project(`${UUID_C}.jsonl`),
    project(UUID_D),
    project(`${UUID_D}/state.json`),
    'cache',
    'cache/blob.bin',
    'debug',
    'debug/log.txt'
  ].sort()

  // ---------------------------------------------------------------------------
  // The dry run

  it('names counts and bytes per category and moves nothing', async () => {
    const before = await hashTree(world.userRoot)
    const preview = await api.tidyPreview()
    expect(preview.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
    // A preview is a scan, so it writes no journal entry either.
    expect((await api.journalList()).data).toEqual([])

    const found = byCategory(preview.data)
    expect(preview.data.categories.map((entry) => entry.category)).toEqual(ALL)
    expect(preview.data.staleAfterDays).toBe(STALE_AFTER_DAYS)

    const staleBytes = (await fs.stat(inStore(project(`${UUID_B}.jsonl`)))).size
    expect(found['stale-sessions'].count).toBe(1)
    expect(found['stale-sessions'].bytes).toBe(staleBytes)
    expect(found['stale-sessions'].examples).toEqual([
      `~/.claude/${project(`${UUID_B}.jsonl`)}`
    ])

    // Stale as well, and counted once — under the more specific category.
    expect(found['empty-transcripts'].count).toBe(1)
    expect(found['empty-transcripts'].bytes).toBe(0)

    expect(found['orphan-sidecars'].count).toBe(1)
    expect(found['orphan-sidecars'].bytes).toBe(
      (await fs.stat(inStore(project(`${UUID_D}/state.json`)))).size
    )

    // `cache` and `debug`, never `backups`, and never the empty `telemetry`.
    expect(found['reclaimable-caches'].count).toBe(2)
    expect(found['reclaimable-caches'].examples).toEqual([
      '~/.claude/cache',
      '~/.claude/debug'
    ])
    expect(found['reclaimable-caches'].bytes).toBeGreaterThan(400)

    expect(preview.data.totalCount).toBe(5)
    expect(preview.data.totalBytes).toBe(
      preview.data.categories.reduce((sum, entry) => sum + entry.bytes, 0)
    )
  })

  // ---------------------------------------------------------------------------
  // Preview and sweep agree

  it('moves exactly the set the preview named, and nothing else', async () => {
    const preview = await api.tidyPreview()
    const named = preview.data.categories.flatMap((entry) => entry.examples)
    const before = await listTree(world.userRoot)

    const done = await api.tidySweep(ALL)
    expect(done.errors).toEqual([])

    const after = await listTree(world.userRoot)
    const removed = before.filter((entry) => !after.includes(entry))
    // Every path that left the store: the five items the preview named, plus
    // the sidecar directory the contract says rides with its session.
    expect(removed.sort()).toEqual(SWEPT)
    // ...and every named item really is one of them.
    for (const example of named) {
      expect(removed).toContain(example.slice('~/.claude/'.length))
    }
    // The fresh session, the backups directory and the empty cache name all
    // survive: a sweep touches only what it previewed.
    expect(after).toContain(project(`${UUID_A}.jsonl`))
    expect(after).toContain('backups/keep.txt')
    expect(after).toContain('telemetry')
  })

  it('sweeps only the categories it was given', async () => {
    const done = await api.tidySweep(['reclaimable-caches'])
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(2)

    expect(await exists(inStore('cache'))).toBe(false)
    expect(await exists(inStore('debug'))).toBe(false)
    // Untouched, because they were not asked for.
    expect(await exists(inStore(project(`${UUID_B}.jsonl`)))).toBe(true)
    expect(await exists(inStore(project(UUID_D)))).toBe(true)

    const left = byCategory((await api.tidyPreview()).data)
    expect(left['reclaimable-caches'].count).toBe(0)
    expect(left['stale-sessions'].count).toBe(1)
  })

  it('refuses a category it does not know, and moves nothing', async () => {
    const before = await hashTree(world.userRoot)
    const bogus = await api.tidySweep(['everything' as TidyCategory])
    expect(bogus.data).toBeNull()
    expect(bogus.errors.map((error) => error.code)).toContain('bad-request')

    const notAList = await api.tidySweep('all' as unknown as TidyCategory[])
    expect(notAList.errors.map((error) => error.code)).toContain('bad-request')

    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // One entry, one undo (ADR-0001 decision 2)

  it('records the whole sweep as one journal entry', async () => {
    const done = await api.tidySweep(ALL)
    expect(done.errors).toEqual([])
    expect(done.data?.op).toBe('trash')
    expect(done.data?.kind).toBe('store')
    expect(done.data?.entityId).toBe('store:user')
    // Five previewed items, six steps — the stale session's sidecar rides
    // along, and it is a step of the same entry rather than one of its own.
    expect(done.data?.stepCount).toBe(6)
    expect(done.data?.summary).toContain('1 untouched session')
    expect(done.data?.summary).toContain('2 cache directories')

    const journal = (await api.journalList()).data
    expect(journal).toHaveLength(1)
    expect(journal[0]?.id).toBe(done.data?.id)
  })

  it('undoes the whole sweep as a unit, byte-for-byte', async () => {
    const before = await hashTree(world.userRoot)

    const done = await api.tidySweep(ALL)
    expect(done.errors).toEqual([])
    expect(await hashTree(world.userRoot)).not.toBe(before)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)

    // Every category is back, so the undo restored the sweep and not a part.
    expect((await api.tidyPreview()).data.totalCount).toBe(5)
    expect((await api.journalList()).data[0]?.isUndo).toBe(true)
  })

  it('displaces every swept item into kondo trash, never unlinking one', async () => {
    const done = await api.tidySweep(ALL)
    const trashDir = path.join(
      world.kondoDataRoot,
      'trash',
      done.data!.id.slice('journal:'.length),
      'user'
    )
    for (const relative of SWEPT) {
      expect(await exists(path.join(trashDir, ...relative.split('/'))), relative).toBe(true)
    }
    const trash = await api.trashSize()
    expect(trash.data.entryCount).toBe(1)
    expect(trash.data.bytes).toBeGreaterThan(0)
  })

  it('appends the journal entry before the store is touched', async () => {
    const ordered: string[] = []
    const restores = recordWrites(ordered)
    try {
      expect((await api.tidySweep(ALL)).errors).toEqual([])
    } finally {
      for (const restore of restores) restore()
    }

    const journalAt = ordered.indexOf(path.join(world.kondoDataRoot, 'journal.jsonl'))
    const storeAt = ordered.findIndex((target) => target.startsWith(world.userRoot))
    expect(journalAt, 'the journal file was never opened').toBeGreaterThanOrEqual(0)
    expect(storeAt, 'the store was never touched').toBeGreaterThanOrEqual(0)
    expect(journalAt).toBeLessThan(storeAt)
  })

  // ---------------------------------------------------------------------------
  // After the sweep, and the tidy store

  it('re-reads the store after a sweep rather than replaying the old scan', async () => {
    // Warm the cached inventory first, so a stale cache would be the failure.
    expect((await api.sessionProjects()).data[0]?.sessionCount).toBe(3)

    expect((await api.tidySweep(ALL)).errors).toEqual([])

    const projects = (await api.sessionProjects()).data
    expect(projects[0]?.sessionCount).toBe(1)
    expect(projects[0]?.staleCount).toBe(0)
    expect(projects[0]?.orphanCount).toBe(0)

    // And the undo is visible the same way, without an explicit rescan.
    const entry = (await api.journalList()).data[0]!
    expect((await api.journalUndo(entry.id)).errors).toEqual([])
    expect((await api.sessionProjects()).data[0]?.sessionCount).toBe(3)
  })

  it('is a no-op on a store with nothing to reclaim', async () => {
    const tidy = await makeWorld()
    try {
      await writeFileTree(tidy.userRoot, {
        [`projects/${DIR}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
        'settings.json': '{}'
      })
      await fs.utimes(
        path.join(tidy.userRoot, 'projects', DIR, `${UUID_A}.jsonl`),
        FRESH,
        FRESH
      )
      const clean = createWorkspace({
        locator: tidy.locator,
        platform: process.platform,
        now: () => NOW,
        guessExists: async () => false
      })

      const preview = await clean.tidyPreview()
      expect(preview.errors).toEqual([])
      expect(preview.data.totalCount).toBe(0)
      expect(preview.data.totalBytes).toBe(0)
      expect(preview.data.categories.map((entry) => entry.count)).toEqual(ALL.map(() => 0))

      const before = await hashTree(tidy.userRoot)
      const swept = await clean.tidySweep(ALL)
      // Nothing to sweep is the ordinary answer, not an error — and it costs
      // no journal entry, so there is nothing to undo either.
      expect(swept.data).toBeNull()
      expect(swept.errors).toEqual([])
      expect(await hashTree(tidy.userRoot)).toBe(before)
      expect((await clean.journalList()).data).toEqual([])
      expect((await clean.trashSize()).data.entryCount).toBe(0)
    } finally {
      await tidy.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------

/**
 * The two whole-tree categories (ROADMAP entry 030). A project directory is
 * offered as one candidate and moved by one trash step, so the invariant a
 * per-file sweep could never hold is the one under test here: no store path
 * is ever offered under two categories.
 */
describe('dead and scratch project directories', () => {
  let world: FixtureWorld
  let api: KondoApi

  /** Named the way Claude Code names a run it did inside the OS temp root. */
  const SCRATCH_TMP = flattenPath(path.join(os.tmpdir(), 'kondo-run-a1b2'))
  /** A worktree and a job Claude checked out for itself. */
  const SCRATCH_WORKTREE = 'D--Projects-app--claude-worktrees-feature'
  const SCRATCH_JOBS = 'D--Projects-app--claude-jobs-run7'
  /** Nothing at all: no conversation, no memory, and a name kondo cannot reverse. */
  const SCRATCH_EMPTY = 'D--Projects-emptyrun'
  /** Memory and nothing else, under a name kondo cannot reverse: left alone. */
  const MEMORY_UNLOCATED = 'D--Projects-notes'

  const ROOT = path.parse(process.cwd()).root
  /** Registered, with transcripts, and no longer on disk. */
  const DEAD_PATH = path.join(ROOT, 'Projects', 'deletedapp')
  const DEAD = flattenPath(DEAD_PATH)
  /** Registered and gone, but with no `projects/` directory to move. */
  const DEAD_NO_TREE = path.join(ROOT, 'Projects', 'neverranhere')
  /** Neither: kondo cannot reverse the name, which is not evidence of death. */
  const LIVE = 'D--Projects-live'
  /** Registered, on disk, and holding only `memory/`: a live project's memory. */
  const MEMORY_LIVE_PATH = path.join(ROOT, 'Projects', 'knowledgebase')
  const MEMORY_LIVE = flattenPath(MEMORY_LIVE_PATH)
  /** Registered, gone, and holding only `memory/`: a dead project, not a scratch one. */
  const MEMORY_GONE_PATH = path.join(ROOT, 'Projects', 'oldnotes')
  const MEMORY_GONE = flattenPath(MEMORY_GONE_PATH)

  const TREES = [SCRATCH_TMP, SCRATCH_WORKTREE, SCRATCH_JOBS, SCRATCH_EMPTY, DEAD, MEMORY_GONE]

  const inStore = (relative: string): string =>
    path.join(world.userRoot, ...relative.split('/'))

  beforeEach(async () => {
    world = await makeWorld()
    await registerProjects(world, [DEAD_PATH, DEAD_NO_TREE, MEMORY_LIVE_PATH, MEMORY_GONE_PATH])
    await writeFileTree(world.userRoot, {
      [`projects/${MEMORY_LIVE}/memory/MEMORY.md`]: '# what this project remembers',
      [`projects/${MEMORY_GONE}/memory/MEMORY.md`]: '# remembered for a project now gone',
      [`projects/${SCRATCH_TMP}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${SCRATCH_WORKTREE}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      [`projects/${SCRATCH_JOBS}/${UUID_C}.jsonl`]: healthyTranscript(UUID_C),
      [`projects/${MEMORY_UNLOCATED}/memory/notes.md`]: 'a note and no transcript',
      // Stale, and carrying an orphan: both are inside a tree that is going
      // anyway, so neither may be offered a second time on its own.
      [`projects/${DEAD}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${DEAD}/${UUID_D}/state.json`]: '{"tool":"state"}',
      [`projects/${LIVE}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      'settings.json': '{}'
    })
    await fs.mkdir(inStore(`projects/${SCRATCH_EMPTY}`), { recursive: true })
    await fs.utimes(inStore(`projects/${DEAD}/${UUID_A}.jsonl`), LONG_AGO, LONG_AGO)
    await fs.utimes(inStore(`projects/${LIVE}/${UUID_B}.jsonl`), FRESH, FRESH)

    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      now: () => NOW,
      // Every registered path but the live memory-only one fails its stat, so
      // the other keys read as gone.
      guessExists: async (target) => target === MEMORY_LIVE_PATH
    })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('never offers a project that holds only memory/, on disk or unlocated (entry 058)', async () => {
    // Transcript-less is not evidence of scratch: what the directory holds is
    // Claude's memory for that project, and an unreversed name is not a death.
    const named = (await api.tidyPreview()).data.categories.flatMap((entry) => entry.examples)
    expect(named).not.toContain(`~/.claude/projects/${MEMORY_LIVE}`)
    expect(named).not.toContain(`~/.claude/projects/${MEMORY_UNLOCATED}`)

    expect((await api.tidySweep(ALL)).errors).toEqual([])
    expect(await exists(inStore(`projects/${MEMORY_LIVE}/memory/MEMORY.md`))).toBe(true)
    expect(await exists(inStore(`projects/${MEMORY_UNLOCATED}/memory/notes.md`))).toBe(true)
  })

  it('files a gone project that holds only memory/ under dead projects, not throwaway', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['dead-projects'].examples).toContain(`~/.claude/projects/${MEMORY_GONE}`)
    expect(found['scratch-projects'].examples).not.toContain(`~/.claude/projects/${MEMORY_GONE}`)
  })

  it('offers every throwaway project folder whole, and only those', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['scratch-projects'].count).toBe(4)
    expect(found['scratch-projects'].examples.slice().sort()).toEqual(
      [SCRATCH_TMP, SCRATCH_WORKTREE, SCRATCH_JOBS, SCRATCH_EMPTY]
        .map((dir) => `~/.claude/projects/${dir}`)
        .sort()
    )
    // The one path is the directory itself, so what it reclaims is the tree.
    expect(found['scratch-projects'].bytes).toBeGreaterThan(0)
  })

  it('offers a project the registry names and the disk has lost', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['dead-projects'].count).toBe(2)
    expect(found['dead-projects'].examples.slice().sort()).toEqual(
      [`~/.claude/projects/${DEAD}`, `~/.claude/projects/${MEMORY_GONE}`].sort()
    )
  })

  it('leaves an unlocated project alone, since an unreversed name is not a death', async () => {
    const preview = await api.tidyPreview()
    const named = preview.data.categories.flatMap((entry) => entry.examples)
    expect(named).not.toContain(`~/.claude/projects/${LIVE}`)

    expect((await api.tidySweep(ALL)).errors).toEqual([])
    expect(await exists(inStore(`projects/${LIVE}/${UUID_B}.jsonl`))).toBe(true)
  })

  it('offers nothing for a registered dead path with no directory to move', async () => {
    const named = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    expect(named).not.toContain(`~/.claude/projects/${flattenPath(DEAD_NO_TREE)}`)
  })

  it('never offers one path under two categories', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    // The dead project's stale transcript and its orphan are inside the tree
    // that is already moving, so neither category may claim them again.
    expect(found['stale-sessions'].count).toBe(0)
    expect(found['orphan-sidecars'].count).toBe(0)
    // And a directory that is both temporary and gone is counted once, under
    // the category that describes what it always was.
    expect(found['scratch-projects'].count + found['dead-projects'].count).toBe(TREES.length)

    // Nothing offered sits inside anything else offered, across every category.
    const offered = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    expect(new Set(offered).size).toBe(offered.length)
    for (const outer of offered) {
      for (const inner of offered) {
        if (outer === inner) continue
        expect(inner.startsWith(`${outer}/`), `${inner} sits inside ${outer}`).toBe(false)
      }
    }
  })

  it('moves each tree as a single step, and undo puts it back whole', async () => {
    const before = await hashTree(world.userRoot)

    const done = await api.tidySweep(['scratch-projects', 'dead-projects'])
    expect(done.errors).toEqual([])
    // One step per directory: six trees, six steps, children included.
    expect(done.data?.stepCount).toBe(TREES.length)
    expect(done.data?.summary).toContain('4 throwaway project folders')
    expect(done.data?.summary).toContain('2 deleted projects')

    for (const dir of TREES) {
      expect(await exists(inStore(`projects/${dir}`)), dir).toBe(false)
    }
    // The stale transcript and the orphan left with their tree, not alone.
    expect(await exists(inStore(`projects/${DEAD}/${UUID_D}`))).toBe(false)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })
})

// ---------------------------------------------------------------------------

/**
 * Conversations the desktop app deleted on its side (entry 059): the marker
 * beside the transcript makes the category, rides along with the sweep and
 * the hand-picked trash, and is an orphan on its own once the transcript is
 * gone.
 */
describe('desktop-released sessions (entry 059)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const inStore = (relative: string): string =>
    path.join(world.userRoot, ...relative.split('/'))
  const released = (uuid: string): string => `projects/${DIR}/${uuid}.desktop-released.json`

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      // Released and stale both: the desktop app's word is the more specific
      // description, so that category claims it and stale does not.
      [`projects/${DIR}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`projects/${DIR}/${UUID_A}/agent.json`]: '{"subagent":"one"}',
      [released(UUID_A)]: desktopReleased(),
      // Released and fresh.
      [`projects/${DIR}/${UUID_B}.jsonl`]: healthyTranscript(UUID_B),
      [released(UUID_B)]: desktopReleased(),
      // Neither: nothing may touch it.
      [`projects/${DIR}/${UUID_C}.jsonl`]: healthyTranscript(UUID_C),
      // A marker whose transcript is already gone.
      [released(UUID_D)]: desktopReleased(),
      'settings.json': '{}'
    })
    await fs.utimes(inStore(`projects/${DIR}/${UUID_A}.jsonl`), LONG_AGO, LONG_AGO)
    for (const uuid of [UUID_B, UUID_C]) {
      await fs.utimes(inStore(`projects/${DIR}/${uuid}.jsonl`), FRESH, FRESH)
    }
    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      now: () => NOW,
      guessExists: async () => false
    })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('offers released conversations under their own category, once each', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['desktop-released-sessions'].count).toBe(2)
    expect(found['desktop-released-sessions'].examples.slice().sort()).toEqual(
      [UUID_A, UUID_B].map((uuid) => `~/.claude/projects/${DIR}/${uuid}.jsonl`).sort()
    )
    // Released beats stale: UUID_A is both and is counted once, over there.
    expect(found['stale-sessions'].count).toBe(0)
    // The marker without a transcript is a leftover like a sidecar directory.
    expect(found['orphan-sidecars'].examples).toEqual([
      `~/.claude/projects/${DIR}/${UUID_D}.desktop-released.json`
    ])
  })

  it('sweeps transcript, sidecar and marker together, and undo puts all three back', async () => {
    const before = await hashTree(world.userRoot)
    const done = await api.tidySweep(['desktop-released-sessions'])
    expect(done.errors).toEqual([])
    expect(done.data?.summary).toContain('2 conversations deleted in the desktop app')
    for (const relative of [
      `projects/${DIR}/${UUID_A}.jsonl`,
      `projects/${DIR}/${UUID_A}`,
      released(UUID_A),
      `projects/${DIR}/${UUID_B}.jsonl`,
      released(UUID_B)
    ]) {
      expect(await exists(inStore(relative)), relative).toBe(false)
    }
    // Untouched: the unreleased conversation and the orphan marker, which
    // belongs to a category that was not chosen.
    expect(await exists(inStore(`projects/${DIR}/${UUID_C}.jsonl`))).toBe(true)
    expect(await exists(inStore(released(UUID_D)))).toBe(true)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('takes the marker along when one session is trashed by hand', async () => {
    const done = await api.sessionTrash([`session:code:${DIR}/${UUID_B}`])
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(2)
    expect(await exists(inStore(`projects/${DIR}/${UUID_B}.jsonl`))).toBe(false)
    expect(await exists(inStore(released(UUID_B)))).toBe(false)
  })
})

// ---------------------------------------------------------------------------

/**
 * Session snapshots and plugin residue (ROADMAP entry 033). Three categories
 * that share one rule: the join is a name — a uuid, or a `<name>@<mp>` id —
 * so nothing is opened to classify a candidate (ADR-0007), and the version
 * `installed_plugins.json` points at is never offered at all.
 */
describe('session-env snapshots and plugin residue', () => {
  let world: FixtureWorld
  let api: KondoApi

  /** The one plugin the manifest declares, and the version it points at. */
  const KEEP = 'keep@mp'
  const LIVE_VERSION = '2.0.0'
  /** Declared by no manifest entry: its residue is what the sweep is for. */
  const GONE = 'gone@mp'

  const inStore = (relative: string): string =>
    path.join(world.userRoot, ...relative.split('/'))

  const liveInstallPath = (root: string): string =>
    path.join(root, 'plugins', 'cache', 'mp', 'keep', LIVE_VERSION)

  /** `installed_plugins.json` as Claude writes it, for one installed plugin. */
  const manifest = (root: string): string =>
    writeJson({
      version: 2,
      plugins: {
        [KEEP]: [
          {
            scope: 'user',
            installPath: liveInstallPath(root),
            version: LIVE_VERSION,
            installedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    })

  const open = (fixture: FixtureWorld): KondoApi =>
    createWorkspace({
      locator: fixture.locator,
      platform: process.platform,
      now: () => NOW,
      guessExists: async () => false
    })

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      // One live transcript, so its snapshot has something behind it.
      [`projects/${DIR}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`session-env/${UUID_A}/env.json`]: '{"cwd":"/here"}',
      // Two snapshots no transcript accounts for.
      [`session-env/${UUID_B}/env.json`]: '{"cwd":"/gone"}',
      [`session-env/${UUID_D}/env.json`]: '{"cwd":"/gone-too"}',
      // Not a session id at all, so not kondo's to move.
      'session-env/last-sweep/marker': 'x',

      'plugins/installed_plugins.json': manifest(world.userRoot),
      // The installed version — the live code Claude loads.
      [`plugins/cache/mp/keep/${LIVE_VERSION}/plugin.json`]: '{"name":"keep"}',
      // ...and two it has upgraded past.
      'plugins/cache/mp/keep/1.0.0/plugin.json': '{"name":"keep"}',
      'plugins/cache/mp/keep/1.5.0/plugin.json': '{"name":"keep"}',
      // Data and an install record for the plugin that is installed...
      'plugins/data/keep-mp/state.json': '{"kept":true}',
      [`plugins/.install-manifests/${KEEP}.json`]: '{"pluginId":"keep@mp"}',
      // ...and for one that is not.
      'plugins/data/gone-mp/state.json': '{"left":"behind"}',
      [`plugins/.install-manifests/${GONE}.json`]: '{"pluginId":"gone@mp"}',
      'settings.json': '{}'
    })
    await fs.utimes(inStore(`projects/${DIR}/${UUID_A}.jsonl`), FRESH, FRESH)
    api = open(world)
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('offers a session snapshot with no transcript, and never one with', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['orphan-session-env'].count).toBe(2)
    expect(found['orphan-session-env'].examples.slice().sort()).toEqual(
      [UUID_B, UUID_D].map((uuid) => `~/.claude/session-env/${uuid}`).sort()
    )
    expect(found['orphan-session-env'].bytes).toBeGreaterThan(0)

    const named = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    // The live session's snapshot, and a directory that is not a session id.
    expect(named).not.toContain(`~/.claude/session-env/${UUID_A}`)
    expect(named).not.toContain('~/.claude/session-env/last-sweep')
  })

  it('never offers the installed version, and offers every other one', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['superseded-plugin-versions'].count).toBe(2)
    expect(found['superseded-plugin-versions'].examples.slice().sort()).toEqual([
      '~/.claude/plugins/cache/mp/keep/1.0.0',
      '~/.claude/plugins/cache/mp/keep/1.5.0'
    ])
    expect(found['superseded-plugin-versions'].bytes).toBeGreaterThan(0)

    const named = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    expect(named).not.toContain(`~/.claude/plugins/cache/mp/keep/${LIVE_VERSION}`)

    // And a full sweep leaves the live version exactly where Claude left it.
    expect((await api.tidySweep(ALL)).errors).toEqual([])
    expect(await exists(liveInstallPath(world.userRoot))).toBe(true)
    expect(await exists(path.join(liveInstallPath(world.userRoot), 'plugin.json'))).toBe(
      true
    )
  })

  it('offers data and install records for ids no manifest declares', async () => {
    const found = byCategory((await api.tidyPreview()).data)
    expect(found['orphan-plugin-residue'].count).toBe(2)
    expect(found['orphan-plugin-residue'].examples.slice().sort()).toEqual([
      `~/.claude/plugins/.install-manifests/${GONE}.json`,
      '~/.claude/plugins/data/gone-mp'
    ])

    const named = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    expect(named).not.toContain('~/.claude/plugins/data/keep-mp')
    expect(named).not.toContain(`~/.claude/plugins/.install-manifests/${KEEP}.json`)
  })

  it('never offers one path under two categories', async () => {
    const offered = (await api.tidyPreview()).data.categories.flatMap((e) => e.examples)
    expect(new Set(offered).size).toBe(offered.length)
    for (const outer of offered) {
      for (const inner of offered) {
        if (outer === inner) continue
        expect(inner.startsWith(`${outer}/`), `${inner} sits inside ${outer}`).toBe(false)
      }
    }
  })

  it('trashes each candidate as its own reversible step', async () => {
    const before = await hashTree(world.userRoot)
    const categories: TidyCategory[] = [
      'orphan-session-env',
      'superseded-plugin-versions',
      'orphan-plugin-residue'
    ]
    const done = await api.tidySweep(categories)
    expect(done.errors).toEqual([])
    // One step per candidate: two snapshots, two versions, two leftovers.
    expect(done.data?.stepCount).toBe(6)
    expect(done.data?.summary).toContain('2 leftover session snapshots')
    expect(done.data?.summary).toContain('2 superseded plugin versions')
    expect(done.data?.summary).toContain('2 leftover plugin files')

    const swept = [
      `session-env/${UUID_B}`,
      `session-env/${UUID_D}`,
      'plugins/cache/mp/keep/1.0.0',
      'plugins/cache/mp/keep/1.5.0',
      'plugins/data/gone-mp',
      `plugins/.install-manifests/${GONE}.json`
    ]
    const trashDir = path.join(
      world.kondoDataRoot,
      'trash',
      done.data!.id.slice('journal:'.length),
      'user'
    )
    for (const relative of swept) {
      expect(await exists(inStore(relative)), relative).toBe(false)
      // Displaced, never unlinked (ADR-0001).
      expect(
        await exists(path.join(trashDir, ...relative.split('/'))),
        relative
      ).toBe(true)
    }
    // What stays: the live snapshot, the live version, the installed plugin's
    // own data and record, and the directory that is not a session id.
    expect(await exists(inStore(`session-env/${UUID_A}`))).toBe(true)
    expect(await exists(inStore('session-env/last-sweep'))).toBe(true)
    expect(await exists(inStore('plugins/data/keep-mp'))).toBe(true)
    expect(await exists(inStore(`plugins/.install-manifests/${KEEP}.json`))).toBe(true)
    expect(await exists(inStore('plugins/installed_plugins.json'))).toBe(true)

    const undone = await api.journalUndo(done.data!.id)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('offers no plugin candidate when the manifest cannot be read', async () => {
    for (const broken of ['not json at all', writeJson({ version: 2 }), '[]']) {
      const fixture = await makeWorld()
      try {
        await writeFileTree(fixture.userRoot, {
          'plugins/installed_plugins.json': broken,
          [`plugins/cache/mp/keep/${LIVE_VERSION}/plugin.json`]: '{"name":"keep"}',
          'plugins/cache/mp/keep/1.0.0/plugin.json': '{"name":"keep"}',
          'plugins/data/keep-mp/state.json': '{"kept":true}',
          [`plugins/.install-manifests/${KEEP}.json`]: '{"pluginId":"keep@mp"}',
          'settings.json': '{}'
        })
        const reader = open(fixture)
        const found = byCategory((await reader.tidyPreview()).data)
        // A manifest kondo cannot read is not evidence that nothing is
        // installed, so it degrades to offering nothing (ADR-0005).
        expect(found['superseded-plugin-versions'].count, broken).toBe(0)
        expect(found['orphan-plugin-residue'].count, broken).toBe(0)

        // Degrading is not going quiet: a manifest that would not parse is
        // reported, and the sweep still moves nothing under `plugins/`.
        const stored = await hashTree(fixture.userRoot)
        const swept = await reader.tidySweep(ALL)
        expect(swept.errors.every((error) => error.code === 'parse-failed')).toBe(true)
        expect(await hashTree(fixture.userRoot)).toBe(stored)
      } finally {
        await fixture.cleanup()
      }
    }
  })

  it('treats an empty manifest as nothing installed, not as unreadable', async () => {
    const fixture = await makeWorld()
    try {
      await writeFileTree(fixture.userRoot, {
        'plugins/installed_plugins.json': writeJson({ version: 2, plugins: {} }),
        'plugins/data/gone-mp/state.json': '{"left":"behind"}',
        [`plugins/.install-manifests/${GONE}.json`]: '{"pluginId":"gone@mp"}',
        'settings.json': '{}'
      })
      const found = byCategory((await open(fixture).tidyPreview()).data)
      expect(found['orphan-plugin-residue'].count).toBe(2)
      // No plugin is installed, so no cache tree is walked for one either.
      expect(found['superseded-plugin-versions'].count).toBe(0)
    } finally {
      await fixture.cleanup()
    }
  })
})
