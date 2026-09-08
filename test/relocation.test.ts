import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { inspectPhysicalTree, preflightRelocation, relocateTree } from '../electron/main/workspace/relocation'
import { createMutations } from '../electron/main/workspace/mutations'
import { exists, makeWorld, writeFileTree, type FixtureWorld } from './helpers'

describe('physical relocation preserves links', () => {
  let world: FixtureWorld
  let context: TestContext
  beforeEach(async (testContext) => {
    context = testContext
    world = await makeWorld()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })


  async function directoryLink(target: string, at: string): Promise<void> {
    try {
      await fs.symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
        context.skip(`Fixture directory links unavailable on ${process.platform}: ${code}`)
      }
      throw cause
    }
  }

  async function linkedTree(): Promise<{ from: string; kept: string; link: string }> {
    await writeFileTree(world.userRoot, {
      'skills/sample/SKILL.md': 'fixture skill',
      'skills/sample/local/data.txt': 'local fixture',
      'shared/reference.txt': 'shared fixture'
    })
    await fs.mkdir(world.kondoDataRoot, { recursive: true })
    const from = path.join(world.userRoot, 'skills', 'sample')
    const kept = path.join(world.kondoDataRoot, 'trash', 'entry', 'sample')
    await directoryLink(path.join(world.userRoot, 'shared'), path.join(from, 'reference'))
    return { from, kept, link: await fs.readlink(path.join(from, 'reference')) }
  }

  for (const crossVolume of [false, true]) {
    it(`preserves junction metadata and sibling targets through ${crossVolume ? 'EXDEV copy' : 'rename'} and undo`, async () => {
      const { from, kept, link } = await linkedTree()
      if (crossVolume) {
        vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('fixture cross-volume'), { code: 'EXDEV' }))
      }
      await relocateTree(from, kept, world.userRoot, world.kondoDataRoot)
      expect(await exists(from)).toBe(false)
      expect((await fs.lstat(path.join(kept, 'reference'))).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(path.join(kept, 'reference'))).toBe(link)
      // Archived links currently refer outside the trash boundary; inspection
      // keeps their text without opening the sibling's bytes.
      const read = vi.spyOn(fs, 'readFile')
      expect((await inspectPhysicalTree(kept, world.kondoDataRoot)).some((entry) => entry.kind === 'link')).toBe(true)
      await preflightRelocation(kept, from, world.kondoDataRoot, world.userRoot, true)
      expect(read).not.toHaveBeenCalled()
      read.mockRestore()
      await relocateTree(kept, from, world.kondoDataRoot, world.userRoot, true)
      expect(await exists(kept)).toBe(false)
      expect((await fs.lstat(path.join(from, 'reference'))).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(path.join(from, 'reference'))).toBe(link)
      expect(await fs.readFile(path.join(from, 'reference', 'reference.txt'), 'utf8')).toBe('shared fixture')
      expect(await fs.readFile(path.join(from, 'local', 'data.txt'), 'utf8')).toBe('local fixture')
    })
  }

  it('validates links into the future restored subtree while their original targets are absent', async () => {
    const { from, kept } = await linkedTree()
    await directoryLink(path.join(from, 'local'), path.join(from, 'inside'))
    const original = await fs.readlink(path.join(from, 'inside'))
    await relocateTree(from, kept, world.userRoot, world.kondoDataRoot)
    expect(await exists(path.join(from, 'local'))).toBe(false)
    await preflightRelocation(kept, from, world.kondoDataRoot, world.userRoot, true)
    await relocateTree(kept, from, world.kondoDataRoot, world.userRoot, true)
    expect((await fs.lstat(path.join(from, 'inside'))).isSymbolicLink()).toBe(true)
    expect(await fs.readlink(path.join(from, 'inside'))).toBe(original)
    expect(await fs.readFile(path.join(from, 'inside', 'data.txt'), 'utf8')).toBe('local fixture')
  })

  it('preflights an honest occupied restore destination without reading its contents', async () => {
    const { from, kept } = await linkedTree()
    await relocateTree(from, kept, world.userRoot, world.kondoDataRoot)
    await writeFileTree(from, { 'unrelated.txt': 'current occupant' })
    const reads = vi.spyOn(fs, 'readFile')
    await preflightRelocation(kept, from, world.kondoDataRoot, world.userRoot, true)
    expect(reads).not.toHaveBeenCalled()
    await expect(relocateTree(kept, from, world.kondoDataRoot, world.userRoot, true)).rejects.toThrow('already exists')
    reads.mockRestore()
    expect(await fs.readFile(path.join(from, 'unrelated.txt'), 'utf8')).toBe('current occupant')
  })

  it('rejects an external destination junction before opening any source bytes', async () => {
    const { from } = await linkedTree()
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'private fixture' })
    await directoryLink(outside, path.join(world.kondoDataRoot, 'escape'))
    const reads = vi.spyOn(fs, 'readFile')
    await expect(relocateTree(from, path.join(world.kondoDataRoot, 'escape', 'new'), world.userRoot, world.kondoDataRoot))
      .rejects.toThrow('boundary')
    expect(reads).not.toHaveBeenCalled()
    expect(await exists(from)).toBe(true)
    expect(await exists(path.join(outside, 'new'))).toBe(false)
  })

  it('rejects unsafe and looping restored links without reading their targets', async () => {
    const { from, kept } = await linkedTree()
    await relocateTree(from, kept, world.userRoot, world.kondoDataRoot)
    const outside = path.join(world.base, 'outside')
    await writeFileTree(outside, { 'sentinel.txt': 'private fixture' })
    await directoryLink(outside, path.join(kept, 'unsafe'))
    const reads = vi.spyOn(fs, 'readFile')
    await expect(preflightRelocation(kept, from, world.kondoDataRoot, world.userRoot, true)).rejects.toThrow('boundary')
    expect(reads).not.toHaveBeenCalled()
    await fs.rm(path.join(kept, 'unsafe'))
    await directoryLink(from, path.join(kept, 'loop'))
    await expect(preflightRelocation(kept, from, world.kondoDataRoot, world.userRoot, true)).rejects.toThrow('cycle')
    expect(reads).not.toHaveBeenCalled()
  })

  it('relocates and restores the exact registry file without authorizing sibling bytes', async () => {
    const registry = world.locator.userConfigFile
    await fs.writeFile(registry, '{"fixture":true}')
    await fs.mkdir(world.kondoDataRoot, { recursive: true })
    const kept = path.join(world.kondoDataRoot, 'registry.json')
    await relocateTree(registry, kept, { file: registry }, world.kondoDataRoot)
    await relocateTree(kept, registry, world.kondoDataRoot, { file: registry }, true)
    expect(await fs.readFile(registry, 'utf8')).toBe('{"fixture":true}')
    await expect(preflightRelocation(registry, path.join(world.home, 'other.json'), { file: registry }, { file: registry }))
      .rejects.toThrow('boundary')
  })
  for (const crossVolume of [false, true]) {
    it(`journals trash and undo without changing junction identity${crossVolume ? ' across volumes' : ''}`, async () => {
      const { from, link } = await linkedTree()
      const mutations = createMutations(world.locator)
      if (crossVolume) {
        vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('fixture cross-volume'), { code: 'EXDEV' }))
      }
      const done = await mutations.mutate({
        op: 'trash', kind: 'skill', entityId: 'skill:user:sample', summary: 'Fixture linked skill',
        steps: [{ type: 'trash', store: 'user', from: 'skills/sample' }]
      })
      expect(done.errors).toEqual([])
      expect(done.data).not.toBeNull()
      expect(await exists(from)).toBe(false)
      const kept = path.join(world.kondoDataRoot, 'trash', done.data!.id.slice('journal:'.length), 'user', 'skills', 'sample')
      expect((await fs.lstat(path.join(kept, 'reference'))).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(path.join(kept, 'reference'))).toBe(link)
      const undone = await mutations.undo(done.data!.id)
      expect(undone.errors).toEqual([])
      expect((await fs.lstat(path.join(from, 'reference'))).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(path.join(from, 'reference'))).toBe(link)
      expect(await fs.readFile(path.join(world.userRoot, 'shared', 'reference.txt'), 'utf8')).toBe('shared fixture')
      expect(await fs.readFile(path.join(from, 'local', 'data.txt'), 'utf8')).toBe('local fixture')
    })
  }

  it('permanently empties archived links without deleting their live referents', async () => {
    const { from } = await linkedTree()
    const mutations = createMutations(world.locator)
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:sample', summary: 'Fixture linked skill',
      steps: [{ type: 'trash', store: 'user', from: 'skills/sample' }]
    })
    expect(done.errors).toEqual([])
    expect(await exists(from)).toBe(false)
    const emptied = await mutations.emptyTrash()
    expect(emptied.errors).toEqual([])
    expect(await exists(path.join(world.kondoDataRoot, 'trash'))).toBe(false)
    expect(await fs.readFile(path.join(world.userRoot, 'shared', 'reference.txt'), 'utf8')).toBe('shared fixture')
  })

  it('removes an incomplete EXDEV archive before undo can mistake it for saved bytes', async () => {
    const { from, link } = await linkedTree()
    const mutations = createMutations(world.locator)
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('fixture cross-volume'), { code: 'EXDEV' }))
    const copyFile = fs.copyFile
    let corrupted = false
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => {
      await copyFile(...args)
      if (String(args[0]) === path.join(from, 'local', 'data.txt')) {
        corrupted = true
        await fs.writeFile(args[1], 'fixture damaged copy')
      }
    })
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:sample', summary: 'Fixture failed archive',
      steps: [{ type: 'trash', store: 'user', from: 'skills/sample' }]
    })
    expect(corrupted).toBe(true)
    expect(done.data).toMatchObject({ outcome: 'none', failed: true })
    expect(done.errors[0]?.message).toContain('does not match its source')
    const history = await mutations.list()
    expect(history.errors).toEqual([])
    const failed = history.data.find((entry) => entry.failed)
    expect(failed).toBeDefined()
    const kept = path.join(world.kondoDataRoot, 'trash', failed!.id.slice('journal:'.length), 'user', 'skills', 'sample')
    expect(await exists(kept)).toBe(false)
    expect(await fs.readFile(path.join(from, 'local', 'data.txt'), 'utf8')).toBe('local fixture')
    expect(await fs.readlink(path.join(from, 'reference'))).toBe(link)
    const undone = await mutations.undo(failed!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors[0]?.message).toContain('no completed changes')
    expect(await fs.readFile(path.join(from, 'local', 'data.txt'), 'utf8')).toBe('local fixture')
    expect(await fs.readlink(path.join(from, 'reference'))).toBe(link)
    expect(await fs.readFile(path.join(world.userRoot, 'shared', 'reference.txt'), 'utf8')).toBe('shared fixture')
  })

  it('supports EXDEV restoration of an exact registry file without creating sibling files', async () => {
    const registry = world.locator.userConfigFile
    await writeFileTree(world.kondoDataRoot, { 'saved-registry.json': '{"fixture":"registry"}' })
    const saved = path.join(world.kondoDataRoot, 'saved-registry.json')
    const before = await fs.readdir(world.home)
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('fixture cross-volume'), { code: 'EXDEV' }))
    await relocateTree(saved, registry, world.kondoDataRoot, { file: registry }, true)
    expect(await exists(saved)).toBe(false)
    expect(await fs.readFile(registry, 'utf8')).toBe('{"fixture":"registry"}')
    expect((await fs.readdir(world.home)).sort()).toEqual([...before, '.claude.json'].sort())
  })

  it('refuses undo before journaling when cleanup leaves an uncertain EXDEV archive', async () => {
    const { from, link } = await linkedTree()
    const mutations = createMutations(world.locator)
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('fixture cross-volume'), { code: 'EXDEV' }))
    const originalCopy = fs.copyFile
    let corrupted = false
    vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => {
      await originalCopy(...args)
      if (String(args[0]) === path.join(from, 'local', 'data.txt')) {
        corrupted = true
        await fs.writeFile(args[1], 'fixture damaged saved copy')
      }
    })
    const cleanup = vi.spyOn(fs, 'rm').mockRejectedValue(Object.assign(new Error('fixture cleanup denied'), { code: 'EACCES' }))
    const done = await mutations.mutate({
      op: 'trash', kind: 'skill', entityId: 'skill:user:sample', summary: 'Fixture uncertain archive',
      steps: [{ type: 'trash', store: 'user', from: 'skills/sample' }]
    })
    expect(corrupted).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(done.data).toMatchObject({ outcome: 'uncertain', failed: true })
    expect(done.errors[0]?.message).toContain('does not match its source')
    const history = await mutations.list()
    expect(history.errors).toEqual([])
    const failed = history.data.find((entry) => entry.failed)
    expect(failed).toBeDefined()
    const kept = path.join(world.kondoDataRoot, 'trash', failed!.id.slice('journal:'.length), 'user', 'skills', 'sample')
    expect(await fs.readFile(path.join(kept, 'local', 'data.txt'), 'utf8')).toBe('fixture damaged saved copy')
    const journalFile = path.join(world.kondoDataRoot, 'journal.jsonl')
    const journalBefore = await fs.readFile(journalFile, 'utf8')
    const undone = await mutations.undo(failed!.id)
    expect(undone.data).toBeNull()
    expect(undone.errors[0]?.code).toBe('read-failed')
    expect(undone.errors[0]?.message).toContain('Recovery is uncertain')
    expect(await fs.readFile(journalFile, 'utf8')).toBe(journalBefore)
    expect(await fs.readFile(path.join(from, 'SKILL.md'), 'utf8')).toBe('fixture skill')
    expect(await fs.readFile(path.join(from, 'local', 'data.txt'), 'utf8')).toBe('local fixture')
    expect(await fs.readlink(path.join(from, 'reference'))).toBe(link)
    expect(await fs.readFile(path.join(world.userRoot, 'shared', 'reference.txt'), 'utf8')).toBe('shared fixture')
  })

})
