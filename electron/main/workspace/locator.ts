import fs from 'node:fs'
import os from 'node:os'
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
  /** Synthetic root in tests; otherwise discovered once by the locator. */
  tmpRoot?: string
  /** Resolves only the temporary root, never project or store contents. */
  realpath?: (root: string) => string
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
  /**
   * `~/.claude.json` — Claude Code's own registry, a sibling of the user
   * store rather than inside it (ADR-0009). Kondo reads its `projects` keys
   * to name the real directory behind each `projects/<flat>` entry.
   */
  userConfigFile: string
  /**
   * The directory `userConfigFile` sits in — the root the write path knows
   * the registry by (ADR-0010). Only that one file name resolves inside it;
   * this is a store of exactly one member, not the home directory.
   */
  userConfigRoot: string
  home: string
  /** Classification hints only; neither spelling grants filesystem access. */
  tmpRoot: string
  tmpRootRealpath: string | null
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
    const xdg = env['XDG_CONFIG_HOME']
    const configHome = xdg && path.posix.isAbsolute(xdg) ? xdg : path.join(home, '.config')
    desktopRoot = path.join(configHome, 'Claude')
  }

  const kondoDataRoot = env['KONDO_DATA_ROOT'] ?? userData

  // Beside the user store, so a fixture root brings its own registry along.
  const userConfigFile = path.join(path.dirname(userRoot), '.claude.json')

  const tmpRoot = environment.tmpRoot ?? os.tmpdir()
  let tmpRootRealpath: string | null = null
  try {
    tmpRootRealpath = (environment.realpath ?? fs.realpathSync.native)(tmpRoot)
  } catch {
    // An unavailable alias must not prevent store discovery or lexical matching.
  }

  return {
    userRoot,
    desktopRoot,
    kondoDataRoot,
    userConfigFile,
    userConfigRoot: path.dirname(userConfigFile),
    home,
    tmpRoot,
    tmpRootRealpath
  }
}
