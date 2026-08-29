import path from 'node:path'

/**
 * The only module that constructs store root paths (ADR-0003). Everything
 * else receives roots from a StoreLocator. Tests inject fake environments;
 * KONDO_STORE_ROOT / KONDO_DESKTOP_STORE_ROOT override for fixture runs.
 */

export interface LocatorEnvironment {
  home: string
  /** Windows %APPDATA%; unused on other platforms. */
  appData: string | null
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
}

export interface StoreLocator {
  /** `~/.claude` */
  userRoot: string
  /** The Claude desktop app's data directory, or null when unresolvable. */
  desktopRoot: string | null
  home: string
}

export function createLocator(environment: LocatorEnvironment): StoreLocator {
  const { home, appData, platform, env } = environment

  const userRoot = env['KONDO_STORE_ROOT'] ?? path.join(home, '.claude')

  const desktopOverride = env['KONDO_DESKTOP_STORE_ROOT']
  let desktopRoot: string | null
  if (desktopOverride) {
    desktopRoot = desktopOverride
  } else if (platform === 'win32') {
    desktopRoot = appData ? path.join(appData, 'Claude') : null
  } else if (platform === 'darwin') {
    desktopRoot = path.join(home, 'Library', 'Application Support', 'Claude')
  } else {
    desktopRoot = path.join(home, '.config', 'Claude')
  }

  return { userRoot, desktopRoot, home }
}
