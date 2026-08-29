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
  /** Electron's `userData` path for kondo itself; kondo's own footprint. */
  userData: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
}

export interface StoreLocator {
  /** `~/.claude` */
  userRoot: string
  /** The Claude desktop app's data directory, or null when unresolvable. */
  desktopRoot: string | null
  /**
   * `<kondo-data>` — the journal and the trash live here (ADR-0001). Never
   * inside a Claude store, and no Claude truth is kept in it (ADR-0006).
   */
  kondoDataRoot: string
  home: string
}

export function createLocator(environment: LocatorEnvironment): StoreLocator {
  const { home, appData, userData, platform, env } = environment

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

  const kondoDataRoot = env['KONDO_DATA_ROOT'] ?? userData

  return { userRoot, desktopRoot, kondoDataRoot, home }
}
