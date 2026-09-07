import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLocator } from '../electron/main/workspace/locator'
import { makeWorld } from './helpers'
import { isScratchProjectName } from '../electron/main/workspace/analysis'

const KONDO_DATA = path.join('/fixtures', 'kondo-data')
const TEMP = { tmpRoot: '/fixtures/tmp', realpath: (root: string) => root }

describe('createLocator', () => {
  afterEach(() => vi.restoreAllMocks())

  const linux = {
    home: '/fixtures/home', appData: null, userData: KONDO_DATA,
    platform: 'linux' as const, ...TEMP
  }

  it.each([undefined, '', 'relative/config', './config', 'C:\\config'])(
    'falls back for an unset, empty or non-POSIX-absolute XDG value (%s)', (xdg) => {
      const locator = createLocator({ ...linux, env: { XDG_CONFIG_HOME: xdg } })
      expect(locator.desktopRoot).toBe(path.join(linux.home, '.config', 'Claude'))
      expect(locator.kondoDataRoot).toBe(KONDO_DATA)
    }
  )

  it('honors absolute XDG config while keeping explicit overrides authoritative', () => {
    const env = { XDG_CONFIG_HOME: '/fixtures/custom config/' }
    const locator = createLocator({ ...linux, env })
    expect(locator.desktopRoot).toBe(path.join(env.XDG_CONFIG_HOME, 'Claude'))
    expect(locator.userRoot).toBe(path.join(linux.home, '.claude'))
    expect(locator.kondoDataRoot).toBe(KONDO_DATA)
    expect(createLocator({ ...linux, env: { ...env, KONDO_DESKTOP_STORE_ROOT: '/fixtures/override' } })
      .desktopRoot).toBe('/fixtures/override')
    expect(createLocator({ ...linux, platform: 'darwin', env }).desktopRoot)
      .toBe(path.join(linux.home, 'Library', 'Application Support', 'Claude'))
    expect(createLocator({ ...linux, platform: 'win32', appData: '/fixtures/appdata', env }).desktopRoot)
      .toBe(path.join('/fixtures/appdata', 'Claude'))
  })

  it('resolves only the injected temporary root and retains both spellings', () => {
    const discover = vi.spyOn(os, 'tmpdir').mockImplementation(() => { throw new Error('unexpected discovery') })
    const realpath = vi.fn(() => '/private/var/folders/fixture/T')
    const locator = createLocator({ ...linux, env: {}, tmpRoot: '/var/folders/fixture/T', realpath })
    expect(discover).not.toHaveBeenCalled()
    expect(realpath).toHaveBeenCalledExactlyOnceWith('/var/folders/fixture/T')
    expect(locator.tmpRoot).toBe('/var/folders/fixture/T')
    expect(locator.tmpRootRealpath).toBe('/private/var/folders/fixture/T')
  })

  it('discovers and canonicalizes the default temporary root once (mocked OS)', () => {
    const discover = vi.spyOn(os, 'tmpdir').mockReturnValue('/fixtures/tmp')
    const resolve = vi.spyOn(fs.realpathSync, 'native').mockReturnValue('/fixtures/canonical-tmp')
    const locator = createLocator({ ...linux, env: {}, tmpRoot: undefined, realpath: undefined })
    expect(discover).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledExactlyOnceWith('/fixtures/tmp')
    expect(locator.tmpRootRealpath).toBe('/fixtures/canonical-tmp')
  })

  it('expands Windows short temp names without classifying neighboring directories', () => {
    const alias = 'C:/Users/FIXTUR~1/AppData/Local/Temp'
    const canonical = 'C:/Users/Fixture User/AppData/Local/Temp'
    vi.spyOn(fs, 'realpathSync').mockReturnValue(alias)
    const resolve = vi.spyOn(fs.realpathSync, 'native').mockReturnValue(canonical)
    const locator = createLocator({ ...linux, platform: 'win32', env: {}, tmpRoot: alias, realpath: undefined })
    expect(resolve).toHaveBeenCalledExactlyOnceWith(alias)
    expect(locator.tmpRootRealpath).toBe(canonical)
    const roots = [locator.tmpRoot, locator.tmpRootRealpath]
    expect(isScratchProjectName('fixture', roots, `${canonical}/project`)).toBe(true)
    expect(isScratchProjectName('fixture', roots, `${canonical}-neighbor/project`)).toBe(false)
  })
  it.each(['ENOENT', 'EACCES', 'ELOOP'])('retains lexical matching when realpath fails (%s)', (code) => {
    const locator = createLocator({ ...linux, env: {}, realpath: () => { throw Object.assign(new Error(code), { code }) } })
    expect(locator.tmpRoot).toBe(TEMP.tmpRoot)
    expect(locator.tmpRootRealpath).toBeNull()
    expect(locator.desktopRoot).toBe(path.join(linux.home, '.config', 'Claude'))
  })

  it('resolves an actual alias entirely inside a disposable fixture', async () => {
    const world = await makeWorld()
    try {
      const target = path.join(world.base, 'tmp-target')
      const alias = path.join(world.base, 'tmp-alias')
      fs.mkdirSync(target)
      fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const locator = createLocator({ ...linux, env: {}, tmpRoot: alias, realpath: undefined })
      expect(locator.tmpRoot).toBe(alias)
      expect(locator.tmpRootRealpath).toBe(fs.realpathSync(target))
    } finally {
      await world.cleanup()
    }
  })

  it('defaults the user store to ~/.claude', () => {
    const locator = createLocator({
      home: path.join('C:', 'Users', 'x'),
      appData: null,
      userData: KONDO_DATA,
      ...TEMP,
      platform: 'win32',
      env: {}
    })
    expect(locator.userRoot).toBe(path.join('C:', 'Users', 'x', '.claude'))
    expect(locator.userConfigFile).toBe(path.join('C:', 'Users', 'x', '.claude.json'))
  })

  it('honors KONDO_STORE_ROOT and KONDO_DESKTOP_STORE_ROOT overrides', () => {
    const locator = createLocator({
      home: '/home/x',
      appData: null,
      userData: KONDO_DATA,
      ...TEMP,
      platform: 'linux',
      env: { KONDO_STORE_ROOT: '/fixtures/user', KONDO_DESKTOP_STORE_ROOT: '/fixtures/desk' }
    })
    expect(locator.userRoot).toBe('/fixtures/user')
    expect(locator.desktopRoot).toBe('/fixtures/desk')
    // The registry follows the override, so a fixture root carries its own.
    expect(locator.userConfigFile).toBe(path.join('/fixtures', '.claude.json'))
  })

  it('resolves the desktop store per platform', () => {
    expect(
      createLocator({
        home: '/Users/x',
        appData: null,
        userData: KONDO_DATA,
        ...TEMP,
        platform: 'darwin',
        env: {}
      }).desktopRoot
    ).toBe(path.join('/Users/x', 'Library', 'Application Support', 'Claude'))
    expect(
      createLocator({
        home: '/home/x',
        appData: null,
        userData: KONDO_DATA,
        ...TEMP,
        platform: 'linux',
        env: {}
      }).desktopRoot
    ).toBe(path.join('/home/x', '.config', 'Claude'))
    expect(
      createLocator({
        home: 'C:\\Users\\x',
        appData: 'C:\\Users\\x\\AppData\\Roaming',
        userData: KONDO_DATA,
        ...TEMP,
        platform: 'win32',
        env: {}
      }).desktopRoot
    ).toBe(path.join('C:\\Users\\x\\AppData\\Roaming', 'Claude'))
  })

  it('yields null desktop root when %APPDATA% is missing on Windows', () => {
    expect(
      createLocator({
        home: 'C:\\Users\\x',
        appData: null,
        userData: KONDO_DATA,
        ...TEMP,
        platform: 'win32',
        env: {}
      }).desktopRoot
    ).toBeNull()
  })

  it('takes kondo data from Electron userData, overridable for fixtures', () => {
    const base = {
      home: '/home/x',
      appData: null,
      userData: KONDO_DATA,
      ...TEMP,
      platform: 'linux' as const
    }
    expect(createLocator({ ...base, env: {} }).kondoDataRoot).toBe(KONDO_DATA)
    expect(
      createLocator({ ...base, env: { KONDO_DATA_ROOT: '/fixtures/other' } }).kondoDataRoot
    ).toBe('/fixtures/other')
  })
})
