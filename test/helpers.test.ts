import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashTree, makeWorld, recordWrites, type FixtureWorld } from './helpers'

describe('recordWrites open flags', () => {
  let world: FixtureWorld
  let target: string
  beforeEach(async () => {
    world = await makeWorld()
    target = path.join(world.userRoot, 'fixture.txt')
    await fs.writeFile(target, 'original')
  })
  afterEach(async () => { await world.cleanup() })

  it.each(['r', 'rs', 'sr', constants.O_RDONLY, constants.O_RDONLY | constants.O_SYNC])(
    'excludes read-only open %s and preserves its readable handle', async (flags) => {
      const writes: string[] = []
      const restores = recordWrites(writes)
      try {
        const handle = await fs.open(target, flags)
        try {
          expect(await handle.readFile('utf8')).toBe('original')
          expect(writes).toEqual([])
        } finally { await handle.close() }
      } finally { for (const restore of restores) restore() }
    }
  )

  it.each([
    'r+', 'rs+', 'sr+', 'w', 'wx', 'xw', 'w+', 'wx+', 'xw+',
    'a', 'ax', 'xa', 'a+', 'ax+', 'xa+', 'as', 'as+',
    constants.O_WRONLY, constants.O_RDWR,
    constants.O_WRONLY | constants.O_APPEND,
    constants.O_RDWR | constants.O_SYNC,
    constants.O_RDONLY | constants.O_CREAT,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC
  ])('records potentially mutating open %s before it settles', async (flags) => {
    if (typeof flags === 'string' && flags.includes('x')) await fs.unlink(target)
    const writes: string[] = []
    const restores = recordWrites(writes)
    try {
      const opening = fs.open(target, flags, 0o600)
      const handle = await opening
      try { expect(writes).toEqual([target]) } finally { await handle.close() }
    } finally { for (const restore of restores) restore() }
  })

  it('preserves writes, call order and original methods after restoration', async () => {
    const originalOpen = fs.open
    const originalRename = fs.rename
    const writes: string[] = []
    const restores = recordWrites(writes)
    const moved = path.join(world.userRoot, 'moved.txt')
    try {
      const opening = fs.open(target, 'w')
      expect(writes).toEqual([target])
      const handle = await opening
      try { await handle.writeFile('changed') } finally { await handle.close() }
      await fs.rename(target, moved)
      expect(writes).toEqual([target, target])
      expect(await fs.readFile(moved, 'utf8')).toBe('changed')
    } finally { for (const restore of restores) restore() }
    expect(fs.open).toBe(originalOpen)
    expect(fs.rename).toBe(originalRename)
    await fs.writeFile(moved, 'after restore')
    expect(writes).toEqual([target, target])
  })

  it('records read-only truncation intent and preserves the native outcome', async () => {
    const flags = constants.O_RDONLY | constants.O_TRUNC
    const attempt = async (): Promise<string | undefined> => {
      try {
        const handle = await fs.open(target, flags)
        await handle.close()
        return undefined
      } catch (error) {
        return (error as NodeJS.ErrnoException).code
      }
    }
    const nativeOutcome = await attempt()
    await fs.writeFile(target, 'original')
    const writes: string[] = []
    const restores = recordWrites(writes)
    try {
      expect(await attempt()).toBe(nativeOutcome)
      expect(writes).toEqual([target])
    } finally { for (const restore of restores) restore() }
  })

  it('preserves failures while recording only attempted mutations', async () => {
    const missing = path.join(world.userRoot, 'missing.txt')
    const writes: string[] = []
    const restores = recordWrites(writes)
    try {
      await expect(fs.open(missing, 'r')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fs.open(missing, 'r+')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(writes).toEqual([missing])
    } finally { for (const restore of restores) restore() }
  })
})

describe('hashTree fixture snapshots', () => {
  let world: FixtureWorld

  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => { await world.cleanup() })

  it('keeps path and content boundaries distinct', async () => {
    const first = path.join(world.base, 'first')
    const second = path.join(world.base, 'second')
    await fs.mkdir(first)
    await fs.mkdir(second)
    await fs.writeFile(path.join(first, 'a'), 'bc')
    await fs.writeFile(path.join(second, 'ab'), 'c')

    expect(await hashTree(first)).not.toBe(await hashTree(second))
  })

  it('is stable across creation order and preserves empty and binary entries', async () => {
    const first = path.join(world.base, 'first')
    const second = path.join(world.base, 'second')
    await fs.mkdir(path.join(first, 'nested', 'empty'), { recursive: true })
    await fs.writeFile(path.join(first, 'nested', 'binary'), Buffer.from([0, 255, 13, 10, 128]))
    await fs.writeFile(path.join(first, 'empty-file'), '')

    await fs.mkdir(second)
    await fs.mkdir(path.join(second, 'nested'))
    await fs.writeFile(path.join(second, 'empty-file'), '')
    await fs.writeFile(path.join(second, 'nested', 'binary'), Buffer.from([0, 255, 13, 10, 128]))
    await fs.mkdir(path.join(second, 'nested', 'empty'))

    const snapshot = await hashTree(first)
    expect(await hashTree(second)).toBe(snapshot)
    await fs.writeFile(path.join(second, 'nested', 'binary'), Buffer.from([0, 255, 13, 10, 129]))
    expect(await hashTree(second)).not.toBe(snapshot)
  })

  it('distinguishes a root file from a root directory', async () => {
    const file = path.join(world.base, 'file')
    const directory = path.join(world.base, 'directory')
    await fs.writeFile(file, '')
    await fs.mkdir(directory)

    expect(await hashTree(file)).not.toBe(await hashTree(directory))
  })

  it('distinguishes an empty file from an empty directory at one path', async () => {
    const fileRoot = path.join(world.base, 'file-root')
    const directoryRoot = path.join(world.base, 'directory-root')
    await fs.mkdir(fileRoot)
    await fs.writeFile(path.join(fileRoot, 'entry'), '')
    await fs.mkdir(path.join(directoryRoot, 'entry'), { recursive: true })

    expect(await hashTree(fileRoot)).not.toBe(await hashTree(directoryRoot))
  })
})
