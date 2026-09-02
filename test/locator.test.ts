import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createLocator } from '../electron/main/workspace/locator'

const KONDO_DATA = path.join('/fixtures', 'kondo-data')

describe('createLocator', () => {
  it('defaults the user store to ~/.claude', () => {
    const locator = createLocator({
      home: path.join('C:', 'Users', 'x'),
      appData: null,
      userData: KONDO_DATA,
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
        platform: 'darwin',
        env: {}
      }).desktopRoot
    ).toBe(path.join('/Users/x', 'Library', 'Application Support', 'Claude'))
    expect(
      createLocator({
        home: '/home/x',
        appData: null,
        userData: KONDO_DATA,
        platform: 'linux',
        env: {}
      }).desktopRoot
    ).toBe(path.join('/home/x', '.config', 'Claude'))
    expect(
      createLocator({
        home: 'C:\\Users\\x',
        appData: 'C:\\Users\\x\\AppData\\Roaming',
        userData: KONDO_DATA,
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
      platform: 'linux' as const
    }
    expect(createLocator({ ...base, env: {} }).kondoDataRoot).toBe(KONDO_DATA)
    expect(
      createLocator({ ...base, env: { KONDO_DATA_ROOT: '/fixtures/other' } }).kondoDataRoot
    ).toBe('/fixtures/other')
  })
})
