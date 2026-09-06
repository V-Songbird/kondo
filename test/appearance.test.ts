import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KondoApi, ThemeId } from '../shared/contract'
import { THEME_IDS } from '../shared/themes'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { makeWorld, writeFileTree, type FixtureWorld } from './helpers'

describe('Kondo appearance preferences', () => {
  let world: FixtureWorld
  let api: KondoApi
  let file: string

  beforeEach(async () => {
    world = await makeWorld()
    file = path.join(world.kondoDataRoot, 'appearance.json')
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('defaults to Chalk without creating a preference or reading Claude', async () => {
    const readFile = vi.spyOn(fs, 'readFile')
    expect(await api.appearanceGet()).toEqual({ data: { theme: 'chalk' }, errors: [], unknown: [] })
    expect(readFile).not.toHaveBeenCalled()
    await expect(fs.stat(world.kondoDataRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(THEME_IDS)('persists %s through another workspace with no journal', async (theme) => {
    const saved = await api.appearanceSet(theme)
    expect(saved).toEqual({ data: { theme }, errors: [], unknown: [] })
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ theme })
    const reopened = createWorkspace({ locator: world.locator, platform: process.platform })
    expect(await reopened.appearanceGet()).toEqual(saved)
    expect(await fs.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
  })

  it.each(['{ broken', 'null', '[]', '{}', '{"theme":"future-theme"}', '{"theme":4}'])(
    'returns Chalk and explains an invalid appearance document: %s', async (raw) => {
      await writeFileTree(world.kondoDataRoot, { 'appearance.json': raw })
      const result = await api.appearanceGet()
      expect(result.data).toEqual({ theme: 'chalk' })
      expect(result.errors).toEqual([expect.objectContaining({
        code: 'parse-failed', path: '<kondo-data>/appearance.json', message: expect.stringContaining('Chalk')
      })])
      expect(await fs.readFile(file, 'utf8')).toBe(raw)
      expect((await api.appearanceSet('sage')).errors).toEqual([])
      expect((await api.appearanceGet()).data.theme).toBe('sage')
    }
  )

  it.each([null, undefined, 4, {}, ['slate'], '../settings.json', 'constructor', 'CHALK'])(
    'rejects an unrecognized runtime input without replacing a saved theme: %j', async (input) => {
      await api.appearanceSet('parchment')
      const before = await fs.readFile(file, 'utf8')
      const result = await api.appearanceSet(input as ThemeId)
      expect(result.data).toEqual({ theme: 'parchment' })
      expect(result.errors[0]?.code).toBe('bad-request')
      expect(await fs.readFile(file, 'utf8')).toBe(before)
      expect(await fs.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
    }
  )

  it('reports unreadable preferences and leaves their bytes alone', async () => {
    await api.appearanceSet('slate')
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('fixture permission denied'), { code: 'EACCES' }))
    const result = await api.appearanceGet()
    expect(result.data.theme).toBe('chalk')
    expect(result.errors[0]?.code).toBe('read-failed')
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ theme: 'slate' })
  })

  it('refuses a directory at the preference path without deleting its contents', async () => {
    await writeFileTree(file, { 'keep.txt': 'fixture bytes' })
    const result = await api.appearanceSet('carbon')
    expect(result.data.theme).toBe('chalk')
    expect(result.errors.map((error) => error.code)).toContain('write-failed')
    expect(await fs.readFile(path.join(file, 'keep.txt'), 'utf8')).toBe('fixture bytes')
    expect(await fs.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
  })

  it('keeps the old document until publishing a complete replacement, and preserves it if rename fails', async () => {
    await api.appearanceSet('slate')
    const before = await fs.readFile(file, 'utf8')
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (temporary, destination) => {
      expect(path.dirname(String(temporary))).toBe(world.kondoDataRoot)
      expect(destination).toBe(file)
      expect(JSON.parse(await fs.readFile(temporary, 'utf8'))).toEqual({ theme: 'carbon' })
      expect(await fs.readFile(file, 'utf8')).toBe(before)
      throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' })
    })
    const result = await api.appearanceSet('carbon')
    expect(result.data.theme).toBe('slate')
    expect(result.errors[0]?.code).toBe('write-failed')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    expect(await fs.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
    expect((await api.appearanceSet('signal')).errors).toEqual([])
    expect((await api.appearanceGet()).data.theme).toBe('signal')
  })

  it('returns the saved preference when temporary creation fails', async () => {
    await api.appearanceSet('sage')
    const before = await fs.readFile(file, 'utf8')
    vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' }))
    const result = await api.appearanceSet('signal')
    expect(result.data.theme).toBe('sage')
    expect(result.errors[0]?.code).toBe('write-failed')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('serializes selections and following reads across workspaces sharing the app directory', async () => {
    await api.appearanceSet('chalk')
    const other = createWorkspace({ locator: world.locator, platform: process.platform })
    const rename = fs.rename.bind(fs)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const published: string[] = []
    vi.spyOn(fs, 'rename').mockImplementation(async (temporary, destination) => {
      const theme = JSON.parse(await fs.readFile(temporary, 'utf8')).theme as string
      published.push(theme)
      if (published.length === 1) await held
      return rename(temporary, destination)
    })
    const first = api.appearanceSet('slate')
    const second = other.appearanceSet('carbon')
    let readSettled = false
    const reading = api.appearanceGet().then((result) => { readSettled = true; return result })
    try {
      await vi.waitFor(() => expect(published).toEqual(['slate']))
      expect(JSON.parse(await fs.readFile(file, 'utf8')).theme).toBe('chalk')
      expect(readSettled).toBe(false)
    } finally {
      release()
    }
    const results = await Promise.all([first, second, reading])
    expect(results.map((result) => result.data.theme)).toEqual(['slate', 'carbon', 'carbon'])
    expect(results.every((result) => result.errors.length === 0)).toBe(true)
    expect(published).toEqual(['slate', 'carbon'])
    expect(await fs.readdir(world.kondoDataRoot)).toEqual(['appearance.json'])
  })

  it.each(['user', 'desktop'] as const)('refuses a misconfigured app directory inside the %s store', async (store) => {
    const root = store === 'user' ? world.userRoot : world.desktopRoot
    const misplaced = createWorkspace({
      locator: { ...world.locator, kondoDataRoot: path.join(root, 'kondo-data') }, platform: process.platform
    })
    const result = await misplaced.appearanceSet('signal')
    expect(result.data.theme).toBe('chalk')
    expect(result.errors[0]?.code).toBe('out-of-store')
    expect(await fs.readdir(root)).toEqual([])
  })
})
