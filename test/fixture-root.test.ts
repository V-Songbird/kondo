import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { makeWorld, type FixtureWorld } from './helpers'

it('builds fixture paths from the resolved temp root even when the OS returns an alias', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'kondo-root-alias-'))
  let world: FixtureWorld | undefined
  try {
    const target = path.join(sandbox, 'target')
    const alias = path.join(sandbox, 'alias')
    await fs.mkdir(target)
    await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    vi.spyOn(os, 'tmpdir').mockReturnValue(alias)
    world = await makeWorld()
    expect(world.base).toBe(await fs.realpath(world.base))
    expect(path.dirname(world.base)).toBe(await fs.realpath(target))
    expect(world.userRoot).toBe(path.join(world.base, 'home', '.claude'))
    expect(world.locator.userConfigFile).toBe(path.join(world.base, 'home', '.claude.json'))
  } finally {
    vi.restoreAllMocks()
    await world?.cleanup()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
})
