import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeWorld, recordWrites, type FixtureWorld } from './helpers'

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
