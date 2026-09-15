import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The only module that constructs store root paths (ADR-0003). Everything
 * else receives roots from a StoreLocator. Tests inject fake environments;
 * KONDO_STORE_ROOT / KONDO_DESKTOP_STORE_ROOT override for fixture runs, above
 * the Claude profile a launch selects (docs/domain.md, "Claude profiles").
 */

/** Selects a Claude profile for a launch that inherits no terminal environment. */
export const CONFIG_DIR_ARGUMENT = '--claude-config-dir'

/** The two ways a launch names a Claude profile, highest precedence first. */
export type ProfileSetting = typeof CONFIG_DIR_ARGUMENT | 'CLAUDE_CONFIG_DIR'

export interface LocatorEnvironment {
  home: string
  /** Windows %APPDATA%; unused on other platforms. */
  appData: string | null
  /**
   * Electron's `userData` path for kondo itself; kondo's own footprint. The
   * composition root has already pointed it at this profile's data root
   * (`kondoDataRootFor`).
   */
  userData: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Kondo's own command line; only `--claude-config-dir=<path>` is read. */
  argv?: readonly string[]
  /** Synthetic root in tests; otherwise discovered once by the locator. */
  tmpRoot?: string
  /** Resolves only the temporary root, never project or store contents. */
  realpath?: (root: string) => string
}

/**
 * Which rule chose the user store: Kondo's fixture override, the launch
 * argument, the inherited variable, or Claude Code's default.
 */
export type ProfileSource = 'fixture' | 'argument' | 'environment' | 'default'

/** A profile selection this launch carried and Kondo did not follow. */
export type IgnoredSelection =
  /** A higher-precedence selection won; the directory it named travels for display. */
  | { setting: ProfileSetting; reason: 'displaced'; root: string }
  /**
   * Never followed: a relative directory resolves against a working directory
   * a desktop launch does not share with the shell, and Claude Code reports
   * one as an error itself.
   */
  | { setting: ProfileSetting; reason: 'not-absolute' }

export interface ProfileSelection {
  source: ProfileSource
  ignored: IgnoredSelection[]
}

export interface StoreLocator {
  /** `~/.claude`, or the Claude configuration directory this launch selected. */
  userRoot: string
  /** The Claude desktop app's data directory, or null when unresolvable. */
  desktopRoot: string | null
  /**
   * `<kondo-data>` — the journal and the trash live here (ADR-0001). Never
   * inside a Claude store, and no Claude truth is kept in it (ADR-0006).
   */
  kondoDataRoot: string
  /**
   * Claude Code's own registry. Beside the user store by default (`~/.claude.json`)
   * and beside a fixture root, so a fixture brings its own along; inside the
   * directory a Claude profile selected, which is where Claude Code keeps it
   * (ADR-0009). Kondo reads its `projects` keys to name the real directory
   * behind each `projects/<flat>` entry.
   */
  userConfigFile: string
  /**
   * The directory `userConfigFile` sits in — the root the write path knows
   * the registry by (ADR-0010). Only that one file name resolves inside it;
   * this is a store of exactly one member, and with a selected profile it is
   * the user store itself rather than the home directory.
   */
  userConfigRoot: string
  /** How `userRoot` was chosen, and the selections that lost (docs/domain.md). */
  profile: ProfileSelection
  home: string
  /** Classification hints only; neither spelling grants filesystem access. */
  tmpRoot: string
  tmpRootRealpath: string | null
}

type StoreRoots = Pick<StoreLocator, 'userRoot' | 'userConfigFile' | 'desktopRoot' | 'profile'>

/**
 * The store roots this launch reads, and how the Claude profile among them was
 * chosen. Precedence: the `KONDO_STORE_ROOT` fixture override with its sibling
 * registry, the `--claude-config-dir` launch argument, an inherited
 * `CLAUDE_CONFIG_DIR`, then Claude Code's `~/.claude`. An inherited variable
 * never displaces a fixture root, so a developer's shell cannot point a
 * fixture run or a test at a real profile.
 */
function resolveStores(environment: LocatorEnvironment): StoreRoots {
  const { home, appData, platform, env } = environment
  const isAbsolute = platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute
  const ignored: IgnoredSelection[] = []
  const prefix = `${CONFIG_DIR_ARGUMENT}=`
  // Chromium reads the last spelling of a repeated switch; so does this.
  const argument = environment.argv
    ?.filter((entry) => entry.startsWith(prefix))
    .at(-1)
    ?.slice(prefix.length)

  // An empty value is unset, the way a shell means it. Claude Code normalizes
  // its configuration home to NFC, so a selection is compared and joined the
  // same way here.
  const selections = ([
    [CONFIG_DIR_ARGUMENT, argument],
    ['CLAUDE_CONFIG_DIR', env['CLAUDE_CONFIG_DIR']]
  ] as Array<[ProfileSetting, string | undefined]>).flatMap(([setting, value]) => {
    if (!value) return []
    if (!isAbsolute(value)) {
      ignored.push({ setting, reason: 'not-absolute' })
      return []
    }
    return [{ setting, root: value.normalize('NFC') }]
  })

  const fixture = env['KONDO_STORE_ROOT']
  const chosen = fixture === undefined ? selections[0] : undefined
  for (const selection of selections) {
    if (selection !== chosen) ignored.push({ setting: selection.setting, reason: 'displaced', root: selection.root })
  }

  let source: ProfileSource = 'default'
  let userRoot = path.join(home, '.claude')
  let userConfigFile = path.join(home, '.claude.json')
  if (fixture !== undefined) {
    source = 'fixture'
    userRoot = fixture
    // Beside the user store, so a fixture root brings its own registry along.
    userConfigFile = path.join(path.dirname(fixture), '.claude.json')
  } else if (chosen !== undefined) {
    source = chosen.setting === 'CLAUDE_CONFIG_DIR' ? 'environment' : 'argument'
    userRoot = chosen.root
    // Inside the chosen directory, where Claude Code reads it (docs/domain.md).
    userConfigFile = path.join(chosen.root, '.claude.json')
  }

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

  return { userRoot, userConfigFile, desktopRoot, profile: { source, ignored } }
}

export function createLocator(environment: LocatorEnvironment): StoreLocator {
  const { home, userData, env } = environment
  const stores = resolveStores(environment)
  const kondoDataRoot = env['KONDO_DATA_ROOT'] ?? userData

  const tmpRoot = environment.tmpRoot ?? os.tmpdir()
  let tmpRootRealpath: string | null = null
  try {
    tmpRootRealpath = (environment.realpath ?? fs.realpathSync.native)(tmpRoot)
  } catch {
    // An unavailable alias must not prevent store discovery or lexical matching.
  }

  return {
    userRoot: stores.userRoot,
    desktopRoot: stores.desktopRoot,
    kondoDataRoot,
    userConfigFile: stores.userConfigFile,
    userConfigRoot: path.dirname(stores.userConfigFile),
    profile: stores.profile,
    home,
    tmpRoot,
    tmpRootRealpath
  }
}

/**
 * One comparable value for the store roots a journal step can name (ADR-0001):
 * the user store, its registry and the desktop store. Lexical only — an alias
 * and its target are two identities — and case-folded on Windows, where two
 * spellings of one directory are one directory.
 */
export function storeSetIdentity(
  stores: Pick<StoreLocator, 'userRoot' | 'userConfigFile' | 'desktopRoot'>,
  platform: NodeJS.Platform
): Array<string | null> {
  return [stores.userRoot, stores.userConfigFile, stores.desktopRoot].map((root) => {
    if (root === null) return null
    const resolved = path.resolve(root).normalize('NFC')
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  })
}

/**
 * Kondo's data root for this launch, or null to keep Electron's own `userData`.
 * A journal step names a store rather than a root, so one data root must serve
 * one set of store roots: `KONDO_DATA_ROOT` stands as given, Claude's default
 * store set keeps the directory it already uses, and every other set — a
 * selected profile, a fixture root — gets its own directory beneath it. The
 * composition root applies this before the single-instance lock, so the lock,
 * the Chromium profile, the journal and the trash all follow the profile
 * (ADR-0004). Nothing is copied between them.
 */
export function kondoDataRootFor(environment: LocatorEnvironment): string | null {
  const explicit = environment.env['KONDO_DATA_ROOT']
  if (explicit !== undefined) return explicit
  const stores = resolveStores(environment)
  if (stores.profile.source === 'default' && !environment.env['KONDO_DESKTOP_STORE_ROOT']) return null
  const key = createHash('sha256')
    .update(JSON.stringify(storeSetIdentity(stores, environment.platform)))
    .digest('hex')
    .slice(0, 16)
  return path.join(environment.userData, 'profiles', key)
}
