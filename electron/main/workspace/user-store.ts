import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  InheritedSkillState,
  ConfigOrphan,
  ConfigOrphanKind,
  HookEvent,
  HookGroup,
  HookInfo,
  HookScriptStatus,
  HookType,
  McpScope,
  McpServerInfo,
  McpTransport,
  PlacedEntryInfo,
  PlacedKind,
  PlacedScope,
  ProjectLocation,
  ProjectRowCounts,
  PluginEffectiveState,
  PluginInfo,
  PluginScopeState,
  SettingsKey,
  SettingsLayerInfo,
  SkillInfo,
  SkillOverride,
  SkillOverrideState,
  StoreEntry,
  StoreReport
} from '../../../shared/contract'
import { hookEvents, hookTypes, settingsKeys } from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { applyEdits, USER_CONFIG_STORE, type SpliceEdit } from './mutations'
import {
  BoundaryError,
  directorySize,
  isEnoent,
  pathWithin,
  redacted,
  resolveAllowedPath,
  safeReaddir,
  safeReadJson,
  safeStat,
  type Collector
} from './scan'
import {
  capabilitiesFor,
  inheritedSkillCapabilities,
  mcpCapabilities,
  skillCapabilities
} from './capabilities'
import { flattenProjectPath } from './projects'
import { projectId } from './sessions'
import { readFrontmatter } from './frontmatter'
import { tildify } from './display'

/** A project whose original path verified (sessions inventory guess). */
export interface VerifiedProject {
  dirName: string
  absPath: string
}

// ---------------------------------------------------------------------------
// Store report (dashboard housekeeping view)

export async function userStoreReport(
  locator: StoreLocator,
  transcriptBytes: number,
  c: Collector
): Promise<StoreReport> {
  const root = locator.userRoot
  const display = tildify(root, locator.home)
  const info = await safeStat(root, display, c, root)
  if (!info) return { root: display, exists: false, entries: [], totalBytes: 0 }

  const entries: StoreEntry[] = []
  for (const entry of await safeReaddir(root, display, c, root)) {
    const child = path.join(root, entry.name)
    const childDisplay = `${display}/${entry.name}`
    const stat = await safeStat(child, childDisplay, c, root)
    if (!stat) continue
    if (entry.isDirectory()) {
      // projects/ bytes come from the session inventory — one walk, not two
      // (ADR-0007). Sidecar bytes are therefore not counted; the sessions
      // view says "transcript bytes" for the same reason.
      const bytes =
        entry.name === 'projects' ? transcriptBytes : await directorySize(child, childDisplay, c, root)
      entries.push({ name: entry.name, type: 'dir', bytes, mtimeMs: stat.mtimeMs })
    } else {
      entries.push({ name: entry.name, type: 'file', bytes: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  entries.sort((a, b) => b.bytes - a.bytes)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  return { root: display, exists: true, entries, totalBytes }
}

// ---------------------------------------------------------------------------
// Settings layers

export interface SettingsLayer {
  info: SettingsLayerInfo
  parsed: Record<string, unknown> | null
  /**
   * The file's bytes exactly as read; null when it is absent or unreadable.
   * An edit splices this text rather than reserializing `parsed`, so a write
   * cannot silently reformat keys it was not asked to touch.
   */
  source: string | null
  /** The mutation store this file lives in (`mutations.ts` names the roots). */
  store: string
  /** Its path inside that store, so no step ever carries an absolute one. */
  relative: string
  /** The project directory this layer belongs to, or null for the user layer. */
  owner: string | null
}

const SETTINGS_FILE = 'settings.json'
const SETTINGS_LOCAL_FILE = 'settings.local.json'

/** Settings files hold credentials, so a failed read carries no exception text (ADR-0022). */
const SETTINGS_UNREADABLE = 'Kondo could not read this settings file.'

const SETTINGS_KEYS: ReadonlySet<string> = new Set(settingsKeys)
const isSettingsKey = (name: string): name is SettingsKey => SETTINGS_KEYS.has(name)

export async function readSettingsLayers(
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<SettingsLayer[]> {
  const layers: SettingsLayer[] = []
  const unreadable = redacted(c, SETTINGS_UNREADABLE)

  const read = async (
    id: string,
    layer: 'user' | 'project' | 'local',
    root: string,
    store: string,
    relative: string,
    owner: string | null,
    ownerId: string | null
  ): Promise<void> => {
    const file = path.join(root, relative)
    const display = tildify(file, locator.home)
    const stat = await safeStat(file, display, unreadable, root)
    const base = {
      id,
      kind: 'settings' as const,
      capabilities: capabilitiesFor('settings', layer),
      layer,
      path: display,
      // ADR-0008: which project a layer belongs to travels as a field, so no
      // reader has to split `settings:local:<flat>` to find out.
      projectId: ownerId
    }
    if (!stat) {
      layers.push({
        info: { ...base, exists: false, bytes: 0, keys: [], unlistedKeys: false },
        parsed: null,
        source: null,
        store,
        relative,
        owner
      })
      return
    }
    // The bytes and the parse come from one read, so an edit splices exactly
    // the text the parse describes.
    let source: string | null = null
    try {
      source = await fs.readFile(await resolveAllowedPath(file, root), 'utf8')
    } catch (cause) {
      unreadable.fail(cause instanceof BoundaryError ? cause.code : 'read-failed', display, cause)
    }
    let parsed: Record<string, unknown> | null = null
    if (source !== null) {
      try {
        const json: unknown = JSON.parse(source)
        if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
          parsed = json as Record<string, unknown>
        }
      } catch (cause) {
        c.fail('parse-failed', display, cause)
      }
    }
    // Only documented names cross: an arbitrary key can itself be a secret.
    const names = Object.keys(parsed ?? {})
    layers.push({
      info: {
        ...base,
        exists: true,
        bytes: stat.size,
        keys: names.filter(isSettingsKey),
        unlistedKeys: !names.every(isSettingsKey)
      },
      parsed,
      source,
      store,
      relative,
      owner
    })
  }

  await read('settings:user:user', 'user', locator.userRoot, 'user', SETTINGS_FILE, null, null)
  for (const project of projects) {
    // ADR-0002: the project store is its .claude directory, and both of its
    // layers live directly inside it.
    const claudeDir = path.join(project.absPath, '.claude')
    const store = `project:${project.dirName}`
    // The folder name, not the flattened one: this is what the UI shows to
    // tell one project's two layers from another's.
    const owner = path.basename(project.absPath)
    const ownerId = projectId(project.dirName)
    await read(
      `settings:project:${project.dirName}`,
      'project',
      claudeDir,
      store,
      SETTINGS_FILE,
      owner,
      ownerId
    )
    await read(
      `settings:local:${project.dirName}`,
      'local',
      claudeDir,
      store,
      SETTINGS_LOCAL_FILE,
      owner,
      ownerId
    )
  }
  return layers
}

/** domain.md: local > project > user, so the lowest rank wins. */
const LAYER_RANK: Record<'user' | 'project' | 'local', number> = {
  local: 0,
  project: 1,
  user: 2
}

// ---------------------------------------------------------------------------
// Hooks

/**
 * One entry of a layer's `hooks` object (domain.md), reduced to what may cross
 * the seam. `command` is the one raw field: the script recognizer reads it and
 * no DTO carries it (ADR-0022).
 */
interface RawHook {
  event: HookEvent | null
  type: HookType | null
  hasMatcher: boolean
  /** Null when the entry carries no string command at all. */
  command: string | null
}

const isHookEvent = (name: string): name is HookEvent => (hookEvents as readonly string[]).includes(name)
const isHookType = (value: unknown): value is HookType => (hookTypes as readonly unknown[]).includes(value)

/**
 * A layer's `hooks` object, flattened in the order it is written. The hook
 * listing walks it through here to give each displayed entry its index.
 */
function rawHooks(layer: SettingsLayer): RawHook[] {
  const config = layer.parsed?.['hooks']
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return []
  const found: RawHook[] = []
  for (const [event, groups] of Object.entries(config)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (typeof group !== 'object' || group === null) continue
      const record = group as Record<string, unknown>
      // Claude's hooks reference: `*` and an empty string match everything.
      const matcher = record['matcher']
      const hasMatcher = typeof matcher === 'string' && matcher !== '' && matcher !== '*'
      const inner = Array.isArray(record['hooks']) ? record['hooks'] : []
      for (const hook of inner) {
        if (typeof hook !== 'object' || hook === null) continue
        const { command, type } = hook as Record<string, unknown>
        found.push({
          event: isHookEvent(event) ? event : null,
          type: isHookType(type) ? type : null,
          hasMatcher,
          command: typeof command === 'string' ? command : null
        })
      }
    }
  }
  return found
}

/**
 * The file extensions a hook's script is recognized by. A command is a shell
 * line, so what follows is a recognizer and never a parser: the first token
 * that looks like a script file is the one reported, and a command naming
 * none reports null rather than a guess.
 */
const SCRIPT_EXTENSIONS = [
  '.sh',
  '.bash',
  '.zsh',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.py',
  '.ps1',
  '.rb',
  '.pl'
] as const

/** A token under a `hooks/` directory, whatever its name ends in. */
const HOOKS_SEGMENT = /(?:^|[\\/])hooks[\\/]/

function scriptToken(command: string): string | null {
  for (const raw of command.split(/\s+/)) {
    // Shell punctuation a token picks up in a compound command; the path
    // itself is what is left.
    const token = raw.replace(/^['"]+/, '').replace(/['"&|;]+$/, '')
    if (token === '') continue
    if (SCRIPT_EXTENSIONS.some((ext) => token.toLowerCase().endsWith(ext))) return token
    if (HOOKS_SEGMENT.test(token)) return token
  }
  return null
}

/**
 * Where that token actually is, or null when kondo may not look (ADR-0002).
 * Null covers three cases and the user gets one answer for all of them —
 * `unverifiable`:
 *
 * - the token holds a shell variable kondo does not expand
 *   (`$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `%USERPROFILE%`);
 * - it is relative and the layer is the user's, whose hooks run in whatever
 *   directory Claude was started in — not kondo's to guess;
 * - it resolves outside the user store and outside every verified `.claude`.
 *
 * Nothing here stats. The boundary is decided on the string alone, so a path
 * beyond it is never probed, not even to find out that it is not there.
 */
function resolveScript(
  token: string,
  layer: SettingsLayer,
  locator: StoreLocator,
  projects: VerifiedProject[]
): string | null {
  if (token.includes('$') || token.includes('%')) return null
  let candidate: string
  if (token.startsWith('~/') || token.startsWith('~\\')) {
    candidate = path.join(locator.home, token.slice(2))
  } else if (path.isAbsolute(token)) {
    candidate = token
  } else {
    const owner = projects.find(
      (project) => projectId(project.dirName) === layer.info.projectId
    )
    if (owner === undefined) return null
    candidate = path.join(owner.absPath, token)
  }
  const abs = path.resolve(candidate)
  if (pathWithin(abs, locator.userRoot)) return abs
  const inProject = projects.some((project) =>
    pathWithin(abs, path.join(project.absPath, '.claude'))
  )
  return inProject ? abs : null
}

/** A failed script stat names its settings file, never a path taken from the command (ADR-0022). */
const HOOK_SCRIPT_UNCHECKED = 'Kondo could not check a script this settings file names.'

async function hookScript(
  command: string,
  layer: SettingsLayer,
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<HookScriptStatus | null> {
  const token = scriptToken(command)
  if (token === null) return null
  const abs = resolveScript(token, layer, locator, projects)
  if (abs === null) return 'unverifiable'
  // A stat and never a read (ADR-0007) — whether the file is there is the
  // whole question. One that cannot be statted is reported and reads as
  // missing rather than failing the listing (ADR-0005).
  const boundary = [locator.userRoot, ...projects.map((project) => path.join(project.absPath, '.claude'))]
    .find((root) => pathWithin(abs, root))
  if (boundary === undefined) return 'unverifiable'
  const stat = await safeStat(abs, layer.info.path, redacted(c, HOOK_SCRIPT_UNCHECKED), boundary)
  return stat === null ? 'missing' : 'present'
}

export async function hooksFromLayers(
  layers: SettingsLayer[],
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<HookInfo[]> {
  const hooks: HookInfo[] = []
  for (const layer of layers) {
    let index = 0
    for (const raw of rawHooks(layer)) {
      hooks.push({
        id: `hook:${layer.info.id}:${index++}`,
        kind: 'hook',
        capabilities: capabilitiesFor('hook', layer.info.layer),
        event: raw.event,
        type: raw.type,
        hasMatcher: raw.hasMatcher,
        script:
          raw.command === null
            ? null
            : await hookScript(raw.command, layer, locator, projects, c),
        source: layer.info.path,
        layer: layer.info.layer,
        projectId: layer.info.projectId,
        projectLabel: layer.owner
      })
    }
  }
  return hooks
}

/** The label the user layer's group carries; a project's is its folder name. */
const GLOBAL_GROUP = 'Global'

/**
 * The listing, under the project whose layer arms each hook. Insertion order
 * is `readSettingsLayers`'s, so the user layer's group comes first and each
 * project follows in the order the scan verified them.
 */
export function groupHooks(hooks: HookInfo[]): HookGroup[] {
  const groups = new Map<string, HookGroup>()
  for (const hook of hooks) {
    // The empty string keys the user layer, which no project id can collide
    // with — every project id starts `project:code:`.
    const key = hook.projectId ?? ''
    let group = groups.get(key)
    if (group === undefined) {
      group = { projectId: hook.projectId, label: hook.projectLabel ?? GLOBAL_GROUP, hooks: [] }
      groups.set(key, group)
    }
    group.hooks.push(hook)
  }
  return [...groups.values()]
}

// ---------------------------------------------------------------------------
// Plugins

export interface PluginRecord {
  info: PluginInfo
  installAbs: string | null
}

/** Where `plugins/` lives, and the two residue directories under it. */
export const PLUGINS_DIR = 'plugins'
export const PLUGIN_CACHE_DIR = 'cache'
export const PLUGIN_DATA_DIR = 'data'
export const PLUGIN_MANIFEST_DIR = '.install-manifests'

/** Installation records are authoritative only for their supported sources. */
export interface PluginInventory {
  plugins: Record<string, unknown>
  completeness: 'complete' | 'partial' | 'unavailable'
  /** Sources identified by install records or known_marketplaces.json. */
  marketplaces: ReadonlySet<string>
}

// These sources load without marketplace installation records. Unknown source
// names need positive marketplace evidence too; this is not an exhaustive list.
const NON_MARKETPLACE_SOURCES = new Set(['skills-dir', 'inline', 'synced'])
const PLUGIN_KEY = /^([a-zA-Z0-9][a-zA-Z0-9._-]*)@([a-zA-Z0-9][a-zA-Z0-9._-]*)$/

function marketplaceOf(key: string): string | null {
  const source = PLUGIN_KEY.exec(key)?.[2]
  return source === undefined || NON_MARKETPLACE_SOURCES.has(source) ? null : source
}

/** Read once, preserve healthy entries, and never turn a failed read into {}. */
export async function readPluginInventory(locator: StoreLocator, c: Collector): Promise<PluginInventory> {
  const file = path.join(locator.userRoot, PLUGINS_DIR, 'installed_plugins.json')
  const display = tildify(file, locator.home)
  const unavailable: PluginInventory = { plugins: {}, completeness: 'unavailable', marketplaces: new Set() }
  let source: string
  try {
    source = await fs.readFile(await resolveAllowedPath(file, locator.userRoot), 'utf8')
  } catch (cause) {
    if (!isEnoent(cause)) c.fail(cause instanceof BoundaryError ? cause.code : 'read-failed', display, cause)
    return unavailable
  }
  let json: Record<string, unknown> | null
  try {
    json = asObject(JSON.parse(source))
  } catch (cause) {
    c.fail('parse-failed', display, cause)
    return unavailable
  }
  const entries = asObject(json?.['plugins'])
  if (entries === null) {
    c.fail('parse-failed', display, 'Plugin installation records must contain a plugins object; absence cannot be established.')
    return unavailable
  }
  let complete = json?.['version'] === 2
  if (!complete) c.fail('parse-failed', display, 'Unsupported plugin installation version; readable entries are shown, but absence cannot be established.')
  const plugins: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  const marketplaces = new Set<string>()
  for (const [key, installs] of Object.entries(entries)) {
    const valid = (Array.isArray(installs) ? installs : []).filter((value) => {
      const install = asObject(value)
      return install !== null && typeof install['installPath'] === 'string' &&
        path.isAbsolute(install['installPath']) &&
        typeof install['scope'] === 'string' &&
        ['user', 'project', 'local', 'managed'].includes(install['scope'])
    })
    const named = PLUGIN_KEY.test(key)
    if (!named || !Array.isArray(installs) || valid.length === 0 || valid.length !== installs.length) {
      complete = false
      // Only a well-formed plugin id is an identity worth naming; any other key is file text (ADR-0022).
      c.fail('parse-failed', display, named
        ? `Incomplete plugin installation entry for ${key}; absence cannot be established.`
        : 'Incomplete plugin installation entry with an unrecognized id; absence cannot be established.')
    }
    if (valid.length > 0 && named) {
      plugins[key] = valid
      const marketplace = marketplaceOf(key)
      if (marketplace !== null) marketplaces.add(marketplace)
    }
  }
  const knownFile = path.join(locator.userRoot, PLUGINS_DIR, 'known_marketplaces.json')
  const known = asObject(await safeReadJson(knownFile, tildify(knownFile, locator.home), c, locator.userRoot))
  for (const [name, value] of Object.entries(known ?? {})) {
    if (asObject(asObject(value)?.['source']) !== null && marketplaceOf('plugin@' + name) !== null) marketplaces.add(name)
  }
  return { plugins, completeness: complete ? 'complete' : 'partial', marketplaces }
}

/** A missing or incomplete manifest cannot authorize plugin-residue cleanup. */
export async function readPluginManifest(locator: StoreLocator, c: Collector): Promise<Record<string, unknown> | null> {
  const inventory = await readPluginInventory(locator, c)
  return inventory.completeness === 'complete' ? inventory.plugins : null
}

function pluginProvedAbsent(inventory: PluginInventory, key: string): boolean {
  const marketplace = marketplaceOf(key)
  return inventory.completeness === 'complete' && marketplace !== null &&
    inventory.marketplaces.has(marketplace) && !Object.hasOwn(inventory.plugins, key)
}

/** What is installed right now, in the two shapes a residue sweep asks for. */
export interface InstalledPlugins {
  /** Every `<name>@<marketplace>` id the manifest declares. */
  keys: Set<string>
  /**
   * Every install directory of each declared id, resolved and case-folded so a
   * comparison against a directory read off the same store cannot miss. A
   * missed match would offer the live version as a candidate, so this errs
   * towards matching: over-matching skips one superseded directory, while
   * under-matching would trash the code Claude is running.
   */
  installPaths: Set<string>
}

/** Case-folded and resolved — see `InstalledPlugins.installPaths`. */
export const installKey = (absPath: string): string =>
  path.resolve(absPath).toLowerCase()

/**
 * What `installed_plugins.json` declares installed, or null when it could not
 * be read — see `readPluginManifest` for why the two stay distinguishable.
 *
 * An `installPath` that escapes the user store is dropped rather than
 * followed (SECURITY.md), exactly as `scanPlugins` drops it: an escaping
 * path names nothing inside `plugins/cache/`, so it can only fail to protect
 * a directory it was never about.
 */
export async function readInstalledPlugins(
  locator: StoreLocator,
  c: Collector
): Promise<InstalledPlugins | null> {
  const plugins = await readPluginManifest(locator, c)
  if (plugins === null) return null
  const keys = new Set<string>()
  const installPaths = new Set<string>()
  for (const [key, installs] of Object.entries(plugins)) {
    keys.add(key)
    // Each scope can retain a different installed version of the same
    // plugin. Array position never makes another scope's live code residue.
    for (const install of Array.isArray(installs) ? installs : []) {
      const declared = asObject(install)?.['installPath']
      if (typeof declared === 'string' && pathWithin(declared, locator.userRoot)) {
        installPaths.add(installKey(declared))
      }
    }
  }
  return { keys, installPaths }
}

/** The first install record of a manifest entry; `{}` for any other shape. */
function firstInstall(installs: unknown): Record<string, unknown> {
  return Array.isArray(installs) && typeof installs[0] === 'object' && installs[0] !== null
    ? (installs[0] as Record<string, unknown>)
    : {}
}

export async function scanPlugins(
  locator: StoreLocator,
  layers: SettingsLayer[],
  c: Collector,
  inventory?: PluginInventory
): Promise<PluginRecord[]> {
  const evidence = inventory ?? await readPluginInventory(locator, c)
  const plugins = evidence.plugins

  // Display order for the whole row, unchanged: local, project, user.
  const ordered = [...layers].sort(
    (a, b) => LAYER_RANK[a.info.layer] - LAYER_RANK[b.info.layer]
  )

  // A plugin's enabled state belongs to a settings layer, not to the plugin
  // (ADR-0006), so every layer gets a row and its own matrix decision —
  // permission is kind × layer × operation, never one flag.
  const scopesOf = (key: string): PluginScopeState[] =>
    ordered.map((layer) => ({
      layerId: layer.info.id,
      layer: layer.info.layer,
      projectId: layer.info.projectId,
      projectLabel: layer.owner,
      path: layer.info.path,
      exists: layer.info.exists,
      enabled: pluginStateIn(layer, key),
      capabilities: capabilitiesFor('plugin', layer.info.layer)
    }))

  // Precedence is a per-project chain (domain.md), not one global ranking:
  // layers of different projects never order against each other, so each
  // project resolves against its own two layers and then the shared user one.
  const userLayer = layers.find((layer) => layer.info.layer === 'user') ?? null
  const chains = new Map<string, SettingsLayer[]>()
  for (const layer of ordered) {
    const owner = layer.info.projectId
    if (owner === null) continue
    chains.set(owner, [...(chains.get(owner) ?? []), layer])
  }

  const records: PluginRecord[] = []
  for (const [key, installs] of Object.entries(plugins)) {
    const at = key.lastIndexOf('@')
    const name = at > 0 ? key.slice(0, at) : key
    const marketplace = at > 0 ? key.slice(at + 1) : ''
    const install = firstInstall(installs)
    const declared =
      typeof install['installPath'] === 'string' ? install['installPath'] : null
    // Confinement (SECURITY.md): installPath comes from a store manifest and
    // is untrusted. It is checked here, where it is resolved, rather than at
    // whichever consumer happens to follow it — an escaping path is nulled,
    // so no later reader can dereference it by forgetting to ask.
    let installAbs = declared
    if (declared !== null && !pathWithin(declared, locator.userRoot)) {
      c.errors.push({
        code: 'out-of-store',
        path: tildify(declared, locator.home),
        message: `installPath of plugin:${key} escapes the user store; it was not followed.`
      })
      installAbs = null
    }
    const installScope = typeof install['scope'] === 'string' ? install['scope'] : 'user'
    const scopes = scopesOf(key)
    const effectiveIn = resolveEffective(key, userLayer, chains)
    records.push({
      info: {
        id: `plugin:${key}`,
        kind: 'plugin',
        capabilities: capabilitiesFor('plugin', installScope),
        name,
        marketplace,
        installed: true,
        version: typeof install['version'] === 'string' ? install['version'] : null,
        installScope,
        installedAt:
          typeof install['installedAt'] === 'string' ? install['installedAt'] : null,
        lastUpdated:
          typeof install['lastUpdated'] === 'string' ? install['lastUpdated'] : null,
        // The declared path, even when it escaped: the display tells the
        // truth about the manifest, `installAbs` is what may be followed.
        installPath: declared ? tildify(declared, locator.home) : '(unknown)',
        enabledIn: scopes.filter((scope) => scope.enabled === true).map((scope) => scope.path),
        scopes,
        effectiveIn
      },
      installAbs
    })
  }
  // Only a complete supported inventory can label a preference not installed.
  // Unenumerated sources stay in their settings layers without a ghost row.
  const ghosts = new Set<string>()
  for (const layer of ordered) {
    for (const key of statedPlugins(layer)) if (pluginProvedAbsent(evidence, key)) ghosts.add(key)
  }
  for (const key of ghosts) {
    const at = key.lastIndexOf('@')
    records.push({
      info: {
        id: `plugin:${key}`,
        kind: 'plugin',
        // The user scope's row: nothing is installed, so there is no install
        // scope to key on, and every operation is refused by the layer rows
        // in `scopes` exactly as it is for an installed plugin.
        capabilities: capabilitiesFor('plugin', 'user'),
        name: at > 0 ? key.slice(0, at) : key,
        marketplace: at > 0 ? key.slice(at + 1) : '',
        installed: false,
        version: null,
        installScope: 'user',
        installedAt: null,
        lastUpdated: null,
        installPath: '(not installed)',
        enabledIn: scopesOf(key)
          .filter((scope) => scope.enabled === true)
          .map((scope) => scope.path),
        scopes: scopesOf(key),
        effectiveIn: resolveEffective(key, userLayer, chains)
      },
      installAbs: null
    })
  }

  records.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return records
}

/**
 * Every plugin key one layer states, in either shape `pluginStateIn` reads.
 * The legacy array form enumerates what it enables, so its members are
 * statements too.
 */
function statedPlugins(layer: SettingsLayer): string[] {
  const enabled = layer.parsed?.[ENABLED_PLUGINS]
  if (Array.isArray(enabled)) {
    return enabled.filter((key): key is string => typeof key === 'string')
  }
  const object = asObject(enabled)
  return object ? Object.keys(object) : []
}

/**
 * What Claude honours for one plugin, once per project plus once for the user
 * scope. Each chain is walked highest precedence first and the first layer
 * that states a value ends it; a project no layer speaks for is left out
 * entirely, which is how "nothing mentions this plugin" stays sayable.
 */
function resolveEffective(
  key: string,
  userLayer: SettingsLayer | null,
  chains: ReadonlyMap<string, SettingsLayer[]>
): PluginEffectiveState[] {
  const effective: PluginEffectiveState[] = []
  const walk = (chain: SettingsLayer[], owner: string | null): void => {
    for (const layer of chain) {
      const enabled = pluginStateIn(layer, key)
      if (enabled === null) continue
      effective.push({ projectId: owner, layerId: layer.info.id, enabled })
      return
    }
  }
  if (userLayer) walk([userLayer], null)
  for (const [owner, chain] of [...chains].sort(([a], [b]) => a.localeCompare(b))) {
    walk(userLayer ? [...chain, userLayer] : chain, owner)
  }
  return effective
}

/** The key Claude's own plugin toggle lives under (ADR-0006). */
const ENABLED_PLUGINS = 'enabledPlugins'

/**
 * What one settings layer says about a plugin: true, false, or null when it
 * says nothing at all — which is what makes precedence resolvable, since a
 * silent layer cannot win over one that speaks.
 *
 * The object form is Claude's own and the only one kondo writes. The legacy
 * array form enumerates what it enables, so a key absent from it is silence
 * rather than a false.
 */
export function pluginStateIn(layer: SettingsLayer, key: string): boolean | null {
  const enabled = layer.parsed?.[ENABLED_PLUGINS]
  if (Array.isArray(enabled)) return enabled.includes(key) ? true : null
  if (typeof enabled === 'object' && enabled !== null) {
    const value = (enabled as Record<string, unknown>)[key]
    return value === undefined ? null : Boolean(value)
  }
  return null
}

// ---------------------------------------------------------------------------
// Editing enabledPlugins in place

/**
 * Claude's plugin toggle is one key in one settings file (ADR-0006), so
 * kondo edits that key and nothing else. Parsing the file and writing the
 * object back would reformat everything and discard whatever ordering and
 * spacing the user chose, so the edit is a splice over the raw bytes: only
 * the span holding the plugin's value — or the point a new member is
 * inserted at — is what the returned edit covers. The caller carries it in a
 * `splice` step, so the bytes are re-read and digest-checked at apply time
 * (ADR-0010) rather than replaced wholesale from a scan.
 *
 * Null when the file's shape is one kondo cannot splice faithfully: a
 * non-object root, or the legacy array form of `enabledPlugins`. The caller
 * refuses rather than reformatting (ADR-0005).
 */
export function editEnabledPlugins(
  source: string,
  key: string,
  enabled: boolean
): SpliceEdit | null {
  return editMember(source, [ENABLED_PLUGINS, key], enabled ? 'true' : 'false')
}

/** No member at that path, so nothing to take away — an edit that changes nothing. */
const NO_EDIT: SpliceEdit = { at: 0, remove: 0, insert: '' }

/** `literal` wrapped in an object per remaining path segment, outermost first. */
function nestLiteral(rest: readonly string[], literal: string): string {
  return rest.reduceRight((inner, key) => `{ ${JSON.stringify(key)}: ${inner} }`, literal)
}

/**
 * The one splice that sets or removes the member at `keyPath` (ADR-0010).
 * `literal` is the JSON text the member's value becomes, or null to take the
 * member away — the direction a whole-file write cannot express at all.
 *
 * Setting creates whatever ancestors are missing on the way down, so
 * `['enabledPlugins', key]` in a file that has none inserts the nested object
 * whole. Removing a member under an ancestor that is not there is nothing to
 * do rather than an error. Either way only the span this returns differs from
 * `source`: every other key keeps its bytes, its order and its spacing.
 *
 * Null when the shape is one kondo cannot splice faithfully — a non-object
 * root, an ancestor that is not an object (the legacy array form of
 * `enabledPlugins` among them), or a truncated literal. The caller refuses
 * rather than reformatting (ADR-0005).
 */
export function editMember(
  source: string,
  keyPath: readonly string[],
  literal: string | null
): SpliceEdit | null {
  if (keyPath.length === 0) return null
  const rootOpen = skipWs(source, 0)
  if (source[rootOpen] !== '{') return null
  let object = readObject(source, rootOpen)
  if (!object) return null

  for (let depth = 0; depth < keyPath.length; depth++) {
    const key = keyPath[depth] as string
    const member = object.members.find((candidate) => candidate.key === key)
    if (!member) {
      if (literal === null) return NO_EDIT
      const text = `${JSON.stringify(key)}: ${nestLiteral(keyPath.slice(depth + 1), literal)}`
      return insertEdit(source, object, text)
    }
    if (depth === keyPath.length - 1) {
      if (literal !== null) {
        return {
          at: member.valueStart,
          remove: member.valueEnd - member.valueStart,
          insert: literal
        }
      }
      return removeEdit(object, member)
    }
    if (source[member.valueStart] !== '{') return null
    const inner = readObject(source, member.valueStart)
    if (!inner) return null
    object = inner
  }
  return null
}

/** `editMember` applied; null when it could not splice faithfully. */
export function spliceMember(
  source: string,
  keyPath: readonly string[],
  literal: string | null
): string | null {
  const edit = editMember(source, keyPath, literal)
  return edit === null ? null : applyEdits(source, [edit])
}

/**
 * The inverse of `editEnabledPlugins`: take this layer's statement about one
 * plugin away, so the layer above it decides again. Writing `false` states a
 * value; only removing the member withdraws one, which is what the "follows
 * global" position of the per-project control means.
 *
 * A splice like its inverse — the member's span and one separating comma are
 * all that leave the file, so every other key keeps its bytes. When it was
 * the only statement, `enabledPlugins` is left as an empty object rather than
 * removed: a layer that holds the key and says nothing under it is exactly
 * what "this layer states no plugin" looks like on disk, and removing the key
 * as well would be a second, unasked-for edit.
 *
 * Null when the shape is one kondo cannot splice faithfully — a non-object
 * root or the legacy array form — and an edit that changes nothing when there
 * was nothing there to take away.
 */
export function clearEnabledPlugin(source: string, key: string): SpliceEdit | null {
  return editMember(source, [ENABLED_PLUGINS, key], null)
}

/** The whole of a settings file kondo creates for one plugin toggle. */
export function newSettingsSource(key: string, enabled: boolean): string {
  return (
    `{\n  ${JSON.stringify(ENABLED_PLUGINS)}: {\n    ${JSON.stringify(key)}: ${enabled}\n  }\n}\n`
  )
}

interface JsonMember {
  key: string
  /** Index of the opening quote of the key. */
  keyStart: number
  valueStart: number
  valueEnd: number
}

interface JsonObject {
  open: number
  close: number
  members: JsonMember[]
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const VALUE_END = new Set([',', '}', ']'])

function skipWs(source: string, at: number): number {
  let i = at
  while (i < source.length && WHITESPACE.has(source[i] as string)) i++
  return i
}

/** Index just past the string literal opening at `at`; -1 when unterminated. */
function scanString(source: string, at: number): number {
  let i = at + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') i += 2
    else if (ch === '"') return i + 1
    else i++
  }
  return -1
}

/** Index just past the JSON value starting at `at`; -1 when unterminated. */
function scanValue(source: string, at: number): number {
  const first = source[at]
  if (first === '"') return scanString(source, at)
  if (first === '{' || first === '[') {
    let i = at
    let depth = 0
    while (i < source.length) {
      const ch = source[i] as string
      if (ch === '"') {
        const end = scanString(source, i)
        if (end < 0) return -1
        i = end
        continue
      }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return -1
  }
  // A number, true, false or null runs until its container or a separator.
  let i = at
  while (i < source.length) {
    const ch = source[i] as string
    if (WHITESPACE.has(ch) || VALUE_END.has(ch)) break
    i++
  }
  return i
}

/** The object whose brace sits at `open`, with the span of every member value. */
function readObject(source: string, open: number): JsonObject | null {
  const members: JsonMember[] = []
  let i = skipWs(source, open + 1)
  if (source[i] === '}') return { open, close: i, members }
  for (;;) {
    if (source[i] !== '"') return null
    const keyStart = i
    const keyEnd = scanString(source, i)
    if (keyEnd < 0) return null
    let key: string
    try {
      key = JSON.parse(source.slice(keyStart, keyEnd)) as string
    } catch {
      return null
    }
    i = skipWs(source, keyEnd)
    if (source[i] !== ':') return null
    const valueStart = skipWs(source, i + 1)
    const valueEnd = scanValue(source, valueStart)
    if (valueEnd < 0) return null
    members.push({ key, keyStart, valueStart, valueEnd })
    i = skipWs(source, valueEnd)
    if (source[i] === ',') {
      i = skipWs(source, i + 1)
      continue
    }
    if (source[i] === '}') return { open, close: i, members }
    return null
  }
}

/**
 * `text` as a new last member of `object`, led by whatever whitespace
 * already separates the opening brace from the first member — so the
 * insertion picks up the file's own indentation instead of imposing one.
 */
function insertEdit(source: string, object: JsonObject, text: string): SpliceEdit {
  const first = object.members[0]
  const last = object.members[object.members.length - 1]
  if (!first || !last) {
    return { at: object.open + 1, remove: object.close - object.open - 1, insert: ` ${text} ` }
  }
  const lead = source.slice(object.open + 1, first.keyStart)
  return { at: last.valueEnd, remove: 0, insert: `,${lead}${text}` }
}

/**
 * The member's span plus the one comma that joined it to whichever neighbour
 * it had, so the object left behind is still valid JSON in the file's own
 * layout. The sole member of an object leaves `{}` rather than taking the
 * object with it: a key that holds nothing is a statement, and removing it
 * too would be a second, unasked-for edit.
 */
function removeEdit(object: JsonObject, member: JsonMember): SpliceEdit {
  const at = object.members.indexOf(member)
  const next = object.members[at + 1]
  if (next) {
    return { at: member.keyStart, remove: next.keyStart - member.keyStart, insert: '' }
  }
  const previous = object.members[at - 1]
  if (previous) {
    return { at: previous.valueEnd, remove: member.valueEnd - previous.valueEnd, insert: '' }
  }
  return { at: object.open + 1, remove: object.close - object.open, insert: '}' }
}

// ---------------------------------------------------------------------------
// MCP servers

/** The file a team commits at the project root; the ADR-0002 exception. */
const MCP_FILE = '.mcp.json'

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * The `mcpServers` members of a container, as name/declaration pairs. Any
 * other shape — a missing key, an array, a string — is no servers rather
 * than an error (ADR-0005).
 */
function mcpDeclarations(container: unknown): Array<[string, Record<string, unknown>]> {
  const servers = asObject(asObject(container)?.['mcpServers'])
  if (!servers) return []
  return Object.entries(servers).map(([name, value]) => [name, asObject(value) ?? {}])
}

/** The string members of a disable list; anything else disables nothing. */
export function stringSet(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((member): member is string => typeof member === 'string'))
}

/** The documented declaration types; `streamable-http` is Claude's alias for `http`. */
const MCP_TRANSPORTS: ReadonlyMap<string, McpTransport> = new Map<string, McpTransport>([
  ['stdio', 'stdio'], ['http', 'http'], ['streamable-http', 'http'], ['sse', 'sse'], ['ws', 'ws']
])

/** A documented transport, `stdio` inferred from a command, or unknown; other text stays in main (ADR-0022). */
function transportOf(declaration: Record<string, unknown>): McpTransport {
  const declared = declaration['type']
  if (typeof declared === 'string' && declared !== '') return MCP_TRANSPORTS.get(declared) ?? 'unknown'
  return typeof declaration['command'] === 'string' ? 'stdio' : 'unknown'
}

interface McpEntry {
  scope: McpScope
  /** The part of the id after the scope (ADR-0008). */
  key: string
  project: string | null
  /** Display path of the declaring file. */
  source: string
  name: string
  declaration: Record<string, unknown>
  disabled: ReadonlySet<string>
  orphan: boolean
}

function toMcpServer(entry: McpEntry): McpServerInfo {
  const enabled = !entry.disabled.has(entry.name)
  return {
    id: `mcp:${entry.scope}:${entry.key}`,
    kind: 'mcp',
    capabilities: mcpCapabilities(entry.scope, enabled, entry.orphan),
    name: entry.name,
    scope: entry.scope,
    // Only the transport is taken off the declaration. `env` and `headers`
    // hold API keys and bearer tokens in the wild (domain.md), so neither
    // their values nor their names are ever built into an entity.
    transport: transportOf(entry.declaration),
    source: entry.source,
    project: entry.project,
    enabled,
    orphan: entry.orphan
  }
}

/**
 * Every MCP server declared in the three native places (domain.md): the
 * `mcpServers` of `~/.claude.json`, the `mcpServers` of each of its
 * `projects` entries, and the `mcpServers` of each verified project's
 * `.mcp.json`.
 *
 * Tier-1 (ADR-0007): one parse of the registry, one stat per registry entry
 * that actually declares a server, and one small read per verified project.
 * Nothing walks a project tree — `.mcp.json` is opened by name, which is the
 * single exception ADR-0002 grants outside a `.claude` directory.
 *
 * A registry entry whose path is gone still yields its servers, marked
 * `orphan`: that is the whole point of listing them, and entry 031 is what
 * will be able to remove one.
 */
export async function scanMcpServers(
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<McpServerInfo[]> {
  const configDisplay = tildify(locator.userConfigFile, locator.home)
  const config = asObject(await safeReadJson(locator.userConfigFile, configDisplay, c, {
    file: locator.userConfigFile
  }))
  const servers: McpServerInfo[] = []
  const nothingDisabled: ReadonlySet<string> = new Set()

  for (const [name, declaration] of mcpDeclarations(config)) {
    servers.push(
      toMcpServer({
        scope: 'user',
        key: name,
        project: null,
        source: configDisplay,
        name,
        declaration,
        disabled: nothingDisabled,
        // The registry is the owning path, and it was just read.
        orphan: false
      })
    )
  }

  // Flattened name → the registry entry it came from (ADR-0009). Claude
  // writes some projects under both slash spellings, so the first spelling of
  // a name wins here exactly as it does in the sessions index.
  const registry = new Map<string, { absPath: string; entry: Record<string, unknown> }>()
  for (const [absPath, value] of Object.entries(asObject(config?.['projects']) ?? {})) {
    const flat = flattenProjectPath(absPath)
    if (!registry.has(flat)) registry.set(flat, { absPath, entry: asObject(value) ?? {} })
  }

  for (const [flat, { absPath, entry }] of registry) {
    const declarations = mcpDeclarations(entry)
    // The stat is paid only by an entry that declares a server: a registry
    // with thousands of projects costs as many stats as it has MCP users.
    if (declarations.length === 0) continue
    const disabled = stringSet(entry['disabledMcpServers'])
    // ADR-0002 allows exactly this — an existence check on the project root,
    // never a listing and never a read of what is inside it.
    let orphan = false
    try {
      await fs.stat(absPath)
    } catch (cause) {
      orphan = true
      if (!isEnoent(cause)) c.fail('stat-failed', tildify(absPath, locator.home), cause)
    }
    for (const [name, declaration] of declarations) {
      servers.push(
        toMcpServer({
          scope: 'local',
          key: `${flat}/${name}`,
          project: flat,
          source: configDisplay,
          name,
          declaration,
          disabled,
          orphan
        })
      )
    }
  }

  for (const project of projects) {
    const file = path.join(project.absPath, MCP_FILE)
    const display = tildify(file, locator.home)
    // Claude gates a committed server through the registry, not through the
    // file it is declared in, so the disable list is the project's own.
    const disabled = stringSet(registry.get(project.dirName)?.entry['disabledMcpjsonServers'])
    for (const [name, declaration] of mcpDeclarations(await safeReadJson(file, display, c, { file }))) {
      servers.push(
        toMcpServer({
          scope: 'project',
          key: `${project.dirName}/${name}`,
          project: project.dirName,
          source: display,
          name,
          declaration,
          disabled,
          // The file was read from the project, so the project is there.
          orphan: false
        })
      )
    }
  }

  servers.sort((a, b) => a.id.localeCompare(b.id))
  return servers
}

// ---------------------------------------------------------------------------
// skillOverrides — Claude's per-skill switch

/** Claude's documented per-skill switch (domain.md); an object of names. */
export const SKILL_OVERRIDES = 'skillOverrides'

/**
 * The four values Claude's settings schema admits (domain.md). Anything else
 * is a layer saying nothing rather than an error (ADR-0005) — a store that
 * grew a fifth value leaves the skill reading as `on` until domain.md catches
 * up, which is the safe direction to be wrong in.
 */
const SKILL_OVERRIDE_VALUES: readonly string[] = [
  'on',
  'name-only',
  'user-invocable-only',
  'off'
]

/**
 * What one settings layer says about one skill, or null when it says nothing
 * at all — the same three-way answer `pluginStateIn` gives, and for the same
 * reason: a silent layer cannot win over one that speaks, which is what makes
 * precedence resolvable.
 */
export function skillOverrideIn(layer: SettingsLayer, name: string): SkillOverride | null {
  const value = asObject(layer.parsed?.[SKILL_OVERRIDES])?.[name]
  if (typeof value !== 'string' || !SKILL_OVERRIDE_VALUES.includes(value)) return null
  return value as SkillOverride
}

/**
 * The layers that speak for one skill, highest precedence first (domain.md:
 * local > project > user).
 *
 * A project-scope skill loads only in its own project, so its chain is that
 * project's two layers and then the shared user one. A user-scope skill loads
 * in every project, so no single project's layer speaks for it — its chain is
 * the user layer alone, which is the one statement true everywhere. A project
 * that switches a user skill off for itself is that project's business, and
 * kondo has nowhere to show it: `projectDetail` lists a project's own skills,
 * never the user's.
 */
export function overrideChain(
  layers: SettingsLayer[],
  owner: string | null
): SettingsLayer[] {
  const user = layers.filter((layer) => layer.info.layer === 'user')
  if (owner === null) return user
  return [
    ...layers
      .filter((layer) => layer.info.projectId === owner)
      .sort((a, b) => LAYER_RANK[a.info.layer] - LAYER_RANK[b.info.layer]),
    ...user
  ]
}

/**
 * The winning statement about one skill, or null when no layer in its chain
 * states one. The first layer that speaks ends the walk, so precedence is the
 * chain's order and nothing else — and the layer that won travels with the
 * answer, because a refusal has to name it (ADR-0006).
 */
export function resolveSkillOverride(
  chain: readonly SettingsLayer[],
  name: string
): SkillOverrideState | null {
  for (const layer of chain) {
    const value = skillOverrideIn(layer, name)
    if (value === null) continue
    return {
      value,
      layerId: layer.info.id,
      layer: layer.info.layer,
      layerPath: layer.info.path
    }
  }
  return null
}

/**
 * The layers of one project only, highest precedence first: what that project
 * itself says about a skill, with the user layer left out on purpose.
 */
export function projectLayers(layers: SettingsLayer[], owner: string): SettingsLayer[] {
  return layers
    .filter((layer) => layer.info.projectId === owner)
    .sort((a, b) => LAYER_RANK[a.info.layer] - LAYER_RANK[b.info.layer])
}

/**
 * The global skills as one project sees them (entry 062): every live
 * user-scope skill, with whether this project's own layers switch it off. Only
 * `off` narrows anything (domain.md); the middle values leave it loaded.
 */
export function inheritedSkills(
  skills: readonly SkillInfo[],
  layers: SettingsLayer[],
  owner: string
): InheritedSkillState[] {
  const own = projectLayers(layers, owner)
  return skills
    .filter((skill) => skill.scope === 'user')
    .map((skill) => {
      const here = resolveSkillOverride(own, skill.name)
      const choice = here?.value === 'off' ? 'off' : 'inherit'
      return {
        skill,
        projectId: owner,
        choice,
        enabledHere: skill.enabled && choice === 'inherit',
        capabilities: inheritedSkillCapabilities(choice)
      }
    })
}

// ---------------------------------------------------------------------------
// Configuration orphans (ADR-0010)

/** One orphan, plus everything a splice needs to take it out. */
export interface ConfigOrphanRecord {
  info: ConfigOrphan
  /** The mutation store the file lives in (`mutations.ts` names the roots). */
  store: string
  /** Its path inside that store, so no step ever carries an absolute one. */
  relative: string
  /** The file's text as kondo read it — what the splice is planned against. */
  source: string
  /** The member, from the file's root down. */
  keyPath: string[]
}

export interface ConfigOrphanSources {
  layers: SettingsLayer[]
  pluginInventory: PluginInventory
  /** Flattened project name → where its directory stands (ADR-0009). */
  location: ReadonlyMap<string, ProjectLocation>
}

/**
 * Every configuration member nothing stands behind any more. Reads only: the
 * whole point of the preview is that this function produces it and it writes
 * nothing, and the same function produces the removal's candidates so what a
 * user confirmed is what a splice takes out.
 *
 * A registry entry is called dead only where the inventory has already
 * proved its directory gone (ADR-0009) — no stat is paid here, and a key the
 * inventory has never heard of is left alone rather than guessed at.
 *
 * Only the object form of `enabledPlugins` yields a row: a key inside the
 * legacy array is a member kondo would have to reformat the array to remove,
 * and it does not (ADR-0005). Nothing is read off an MCP declaration but its
 * name — `env` and `headers` hold secrets (domain.md).
 */
export async function scanConfigOrphans(
  locator: StoreLocator,
  sources: ConfigOrphanSources,
  c: Collector
): Promise<ConfigOrphanRecord[]> {
  const records: ConfigOrphanRecord[] = []
  interface Holder {
    /** The id's scope segment — a layer id, or the registry's store name. */
    scope: string
    store: string
    relative: string
    source: string
    display: string
  }
  const add = (
    holder: Holder,
    kind: ConfigOrphanKind,
    name: string,
    reason: string,
    keyPath: string[]
  ): void => {
    records.push({
      info: {
        id: `orphan:${kind}:${holder.scope}:${keyPath.map(encodeURIComponent).join('/')}`,
        kind,
        name,
        source: holder.display,
        reason
      },
      store: holder.store,
      relative: holder.relative,
      source: holder.source,
      keyPath
    })
  }

  // The registry: its own read, because a splice needs the exact bytes it
  // will edit and `safeReadJson` keeps only the parse.
  const display = tildify(locator.userConfigFile, locator.home)
  let text: string | null = null
  try {
    text = await fs.readFile(await resolveAllowedPath(locator.userConfigFile, {
      file: locator.userConfigFile
    }), 'utf8')
  } catch (cause) {
    // ADR-0005: no registry is no orphans, not a failure.
    if (!isEnoent(cause)) {
      c.fail(cause instanceof BoundaryError ? cause.code : 'read-failed', display, cause)
    }
  }
  let config: Record<string, unknown> | null = null
  if (text !== null) {
    try {
      config = asObject(JSON.parse(text))
    } catch (cause) {
      c.fail('parse-failed', display, cause)
    }
  }
  if (text !== null && config !== null) {
    const registry: Holder = {
      scope: USER_CONFIG_STORE,
      store: USER_CONFIG_STORE,
      relative: path.basename(locator.userConfigFile),
      source: text,
      display
    }
    for (const [absPath, value] of Object.entries(asObject(config['projects']) ?? {})) {
      // Only `gone` is evidence the directory was deleted; an unlocated
      // project, or one the inventory never heard of, is left alone.
      if (sources.location.get(flattenProjectPath(absPath)) !== 'gone') continue
      const shown = tildify(absPath, locator.home)
      const servers = mcpDeclarations(value).map(([name]) => name)
      for (const name of servers) {
        add(
          registry,
          'mcp-declaration',
          name,
          `Declared only for ${shown}, which is not on disk.`,
          ['projects', absPath, 'mcpServers', name]
        )
      }
      add(
        registry,
        'project-entry',
        shown,
        servers.length === 0
          ? `${shown} is not on disk; the registry entry is left over.`
          : `${shown} is not on disk; its entry also declares ${servers.length} MCP server${
              servers.length === 1 ? '' : 's'
            }.`,
        ['projects', absPath]
      )
    }
  }

  for (const layer of sources.layers) {
    if (layer.source === null || layer.parsed === null) continue
    const holder: Holder = {
      scope: layer.info.id,
      store: layer.store,
      relative: layer.relative,
      source: layer.source,
      display: layer.info.path
    }
    for (const [key, value] of Object.entries(asObject(layer.parsed[ENABLED_PLUGINS]) ?? {})) {
      if (typeof value !== 'boolean' || !pluginProvedAbsent(sources.pluginInventory, key)) continue
      add(
        holder,
        'enabled-plugin',
        key,
        `${key} has no entry in the complete marketplace installation records.`,
        [ENABLED_PLUGINS, key]
      )
    }
    // skillOverrides has no source identity. Bundled skills, commands, managed
    // skills and additional directories cannot be exhaustively enumerated here.
    // Even an unfamiliar name is a preference to preserve, not proved residue.
  }

  records.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return records
}

// ---------------------------------------------------------------------------
// Hand-placed entries: skills, agents, commands, rules, output styles

const SKILL_MANIFEST = 'SKILL.md'
const MAX_MANIFEST_BYTES = 262_144
const MARKDOWN = '.md'

/**
 * The two shapes a hand-placed entry takes on disk (domain.md):
 *
 * - `skill-dir` — a directory whose `SKILL.md` describes it.
 * - `markdown` — one `<name>.md` file whose own frontmatter describes it.
 *
 * The shape is the only thing that differs between reading `skills/` and
 * reading `agents/`, `commands/`, `rules/` or `output-styles/`, which is why
 * one reader takes it as a parameter rather than four near-copies existing.
 */
type PlacedShape = 'skill-dir' | 'markdown'

/**
 * Where one kind's entries live inside a store, and what its name looks like
 * on disk (domain.md). One table for all five placed kinds, so a listing and
 * a move can never disagree about where an entry sits: `kinds.ts` reads
 * placements from here rather than deriving a path of its own.
 *
 * `benched` is the sibling directory a disabled entry sits in — kondo's own
 * parking spot for skills, and null for the four markdown kinds, which have
 * no bench at all. Entry 029 verified that no Claude Code build reads
 * `skills.disabled`: moving a skill there stops it loading only because it
 * has left `skills/`, and Claude's named per-skill switch is `skillOverrides`
 * in a settings layer (ADR-0006). `inProject` is false only for output styles:
 * no project store has been observed carrying them, and kondo does not go
 * looking for a directory it has never seen.
 */
export interface KindPlacement {
  /** The directory a live entry sits in, relative to the store root. */
  dir: string
  /** The sibling directory a benched entry sits in, or null for no bench. */
  benched: string | null
  /** What the name carries on disk: `.md` for a file, '' for a directory. */
  suffix: string
  /** Whether a project store holds this directory too. */
  inProject: boolean
}

export const PLACEMENTS: Record<'skill' | PlacedKind, KindPlacement> = {
  skill: { dir: 'skills', benched: 'skills.disabled', suffix: '', inProject: true },
  agent: { dir: 'agents', benched: null, suffix: MARKDOWN, inProject: true },
  command: { dir: 'commands', benched: null, suffix: MARKDOWN, inProject: true },
  rule: { dir: 'rules', benched: null, suffix: MARKDOWN, inProject: true },
  'output-style': { dir: 'output-styles', benched: null, suffix: MARKDOWN, inProject: false }
}

/** One entry read off disk, before a kind turns it into an entity. */
interface PlacedRecord {
  /** The name on disk: the directory's, or the file's without `.md`. */
  name: string
  description: string | null
  /** Absolute path of the directory or file that holds it. */
  target: string
}

/**
 * Every entry sitting directly under `root`, in whichever shape that
 * directory holds. Reading one means reading its frontmatter, so this is
 * tier-2 work (ADR-0007) and the caller decides when to pay for it. A root
 * that is not there at all is not an error — `safeReaddir` says so, and the
 * answer is simply empty. Frontmatter that is missing or malformed leaves
 * the description null rather than failing the entry (ADR-0005).
 */
async function readPlacedDir(
  locator: StoreLocator,
  root: string,
  shape: PlacedShape,
  c: Collector,
  boundary: string
): Promise<PlacedRecord[]> {
  const records: PlacedRecord[] = []
  const display = tildify(root, locator.home)
  for (const entry of await safeReaddir(root, display, c, boundary)) {
    let name: string
    let target: string
    let manifest: string
    let manifestDisplay: string
    if (shape === 'skill-dir') {
      if (!entry.isDirectory()) continue
      name = entry.name
      target = path.join(root, entry.name)
      manifest = path.join(target, SKILL_MANIFEST)
      manifestDisplay = `${display}/${entry.name}/${SKILL_MANIFEST}`
    } else {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(MARKDOWN)) continue
      name = entry.name.slice(0, -MARKDOWN.length)
      // A file called exactly `.md` names nothing and cannot key an id.
      if (name === '') continue
      target = path.join(root, entry.name)
      manifest = target
      manifestDisplay = `${display}/${entry.name}`
    }

    let content: string
    try {
      content = await fs.readFile(await resolveAllowedPath(manifest, boundary), 'utf8')
    } catch (cause) {
      // A directory with no `SKILL.md` is not a skill, and a file that went
      // away between the listing and the read is simply gone — neither is
      // worth reporting. Anything else is.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue
      c.fail(cause instanceof BoundaryError ? cause.code : 'read-failed', manifestDisplay, cause)
      continue
    }
    records.push({
      name,
      description: readFrontmatter(content.slice(0, MAX_MANIFEST_BYTES)).description,
      target
    })
  }
  return records
}

/** Claude's own per-skill usage record, in `~/.claude.json` (ADR-0009). */
const SKILL_USAGE = 'skillUsage'

/**
 * The skill names Claude has counted a use of. Claude keys `skillUsage` by
 * the skill's own name — `<plugin>:<name>` for a plugin-shipped one — and
 * stores a count and a timestamp against each; kondo reads Claude's record
 * rather than keeping one of its own (ADR-0006), and keeps only the names,
 * so nothing about when or how often a user works crosses the seam.
 *
 * A registry that is missing, unreadable or malformed answers empty
 * (ADR-0005), which reads as "nothing has been used" — the badge is a hint
 * about a skill, never the grounds for touching one.
 */
export async function scanSkillUsage(
  locator: StoreLocator,
  c: Collector
): Promise<ReadonlySet<string> | null> {
  const raw = await safeReadJson(
    locator.userConfigFile,
    tildify(locator.userConfigFile, locator.home),
    c,
    { file: locator.userConfigFile }
  )
  const usage = asObject(asObject(raw)?.[SKILL_USAGE] ?? null)
  // No record is not an empty record: the first says kondo cannot tell, the
  // second says Claude has counted nothing. Only the second may badge a skill.
  if (usage === null) return null
  return new Set(
    Object.entries(usage)
      .filter(([, record]) => {
        const count = asObject(record)?.['usageCount']
        return typeof count === 'number' && count > 0
      })
      .map(([name]) => name)
  )
}

/** One skill directory to read, and everything its entries resolve against. */
interface SkillDirRead {
  root: string
  /** The owning user or project store, including aliases elsewhere inside it. */
  boundary: string
  scope: SkillInfo['scope']
  keyPrefix: string
  /** Whether this is the live directory rather than the bench. */
  live: boolean
  owner: string | null
  /** The layers that speak for this scope, highest precedence first. */
  chain: readonly SettingsLayer[]
  /** The names `scanSkillUsage` found, or null when there was no record to read. */
  used: ReadonlySet<string> | null
  /** What Claude prefixes this scope's names with there: `<plugin>:` or ''. */
  usagePrefix: string
}

/**
 * The skill directories under `read.root`, as SkillInfo. Claude has two
 * independent per-skill mechanisms (ADR-0006) and both are resolved here: the
 * directory the skill sits in, and the `skillOverrides` statement its chain
 * carries. A skill is enabled only when both say so, which is what Claude
 * does with it — a skill in `skills/` that a layer switches `off` is off.
 */
async function readSkillDir(
  locator: StoreLocator,
  read: SkillDirRead,
  c: Collector
): Promise<SkillInfo[]> {
  return (await readPlacedDir(locator, read.root, 'skill-dir', c, read.boundary)).map((record) => {
    const override = resolveSkillOverride(read.chain, record.name)
    return {
      id: `skill:${read.keyPrefix}:${record.name}`,
      kind: 'skill',
      // The matrix row for the scope, narrowed by the override: a skill a
      // layer has switched off has no toggle to offer in either direction,
      // and the refusal names the layer rather than the bench.
      capabilities: skillCapabilities(read.scope, override),
      name: record.name,
      description: record.description,
      scope: read.scope,
      origin: tildify(record.target, locator.home),
      enabled: read.live && override?.value !== 'off',
      override,
      // Claude's own record, read straight (ADR-0006): a name it has never
      // counted is one nothing has ever loaded.
      neverUsed: read.used === null ? null : !read.used.has(`${read.usagePrefix}${record.name}`),
      // ADR-0008: the owning project travels as a field. The renderer joins
      // on it rather than splitting `skill:project/<flat>:<name>` apart.
      projectId: read.owner
    }
  })
}

/**
 * Every entry of one placed kind, in the user store and in each verified
 * project. The scope resolves to a matrix row refusing both toggles
 * (ADR-0006 — Claude has no disable convention for these) and allowing
 * `move`, which relocates the file without changing how Claude reads it.
 */
export async function scanPlacedEntries(
  locator: StoreLocator,
  kind: PlacedKind,
  projects: VerifiedProject[],
  c: Collector
): Promise<PlacedEntryInfo[]> {
  const { dir, inProject } = PLACEMENTS[kind]
  const roots: Array<[string, PlacedScope, string, string | null, string]> = [
    [path.join(locator.userRoot, dir), 'user', 'user', null, locator.userRoot]
  ]
  if (inProject) {
    for (const project of projects) {
      // ADR-0002: the project store is its .claude directory and nothing
      // above it, so the root is joined from there and never from the root.
      roots.push([
        path.join(project.absPath, '.claude', dir),
        'project',
        `project/${project.dirName}`,
        projectId(project.dirName),
        path.join(project.absPath, '.claude')
      ])
    }
  }

  const entries: PlacedEntryInfo[] = []
  for (const [root, scope, keyPrefix, owner, boundary] of roots) {
    for (const record of await readPlacedDir(locator, root, 'markdown', c, boundary)) {
      entries.push({
        id: `${kind}:${keyPrefix}:${record.name}`,
        kind,
        capabilities: capabilitiesFor(kind, scope),
        name: record.name,
        description: record.description,
        scope,
        origin: tildify(record.target, locator.home),
        projectId: owner
      })
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return entries
}

/** The two settings files any scope may hold, by name. */
const SETTINGS_NAMES = [SETTINGS_FILE, SETTINGS_LOCAL_FILE] as const

/** Safe listings expose a validated alias's target shape. */
function isDirLike(entry: { isDirectory(): boolean }): boolean {
  return entry.isDirectory()
}

function isMarkdownLike(entry: {
  name: string
  isFile(): boolean
  isSymbolicLink(): boolean
}): boolean {
  return (
    entry.isFile() &&
    entry.name.length > MARKDOWN.length &&
    entry.name.toLowerCase().endsWith(MARKDOWN)
  )
}

/**
 * Tier-1 counts for one store root — the user store, or one project's
 * `.claude` (ADR-0002). Names only: one readdir of the root and one of each
 * directory that holds entries, and not a single file opened (ADR-0007). A
 * root that is not there answers zeroes rather than failing, which is how a
 * project with no store still gets a row (ADR-0005).
 *
 * Hooks and MCP servers are null here on purpose: both live *inside* files,
 * so no readdir can count them. `projectDetail` counts them for the one row
 * a user opens.
 */
export async function countStoreEntries(
  locator: StoreLocator,
  root: string,
  c: Collector
): Promise<ProjectRowCounts> {
  const display = tildify(root, locator.home)
  const listing = await safeReaddir(root, display, c, root)
  const present = new Set(listing.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const held = new Set(listing.filter(isDirLike).map((entry) => entry.name))

  const count = async (
    dir: string,
    admits: (entry: { name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }) => boolean
  ): Promise<number> => {
    // The root listing already says which directories exist, so a store
    // holding none of them costs exactly one readdir in total.
    if (!held.has(dir)) return 0
    return (await safeReaddir(path.join(root, dir), `${display}/${dir}`, c, root)).filter(admits).length
  }

  return {
    skills:
      (await count(PLACEMENTS.skill.dir, isDirLike)) +
      (PLACEMENTS.skill.benched === null
        ? 0
        : await count(PLACEMENTS.skill.benched, isDirLike)),
    agents: await count(PLACEMENTS.agent.dir, isMarkdownLike),
    commands: await count(PLACEMENTS.command.dir, isMarkdownLike),
    rules: await count(PLACEMENTS.rule.dir, isMarkdownLike),
    settings: SETTINGS_NAMES.filter((name) => present.has(name)).length,
    hooks: null,
    mcpServers: null
  }
}

/**
 * Every skill the user placed by hand, in the user store and in each verified
 * project. Skills that ship *inside* a plugin are deliberately not listed:
 * they are not the user's to move or bench, and a plugin whose skill directory
 * went missing is a broken plugin. They belong to the plugins view, which owns
 * the plugin's own tree — `scanPluginSkills` below is what reads them there,
 * and the matrix keeps refusing the `plugin` scope so that surfacing one still
 * cannot mutate it.
 */
export async function scanSkills(
  locator: StoreLocator,
  projects: VerifiedProject[],
  layers: SettingsLayer[],
  used: ReadonlySet<string> | null,
  c: Collector
): Promise<SkillInfo[]> {
  // Both of Claude's skill directories come off the placement table, so the
  // toggle in `kinds.ts` and this listing name the same two (ADR-0006). The
  // bench is a fact of the table rather than of the type, so a kind that
  // grew one later simply lists both without this being edited.
  const { dir, benched } = PLACEMENTS.skill
  const userChain = overrideChain(layers, null)
  const reads: SkillDirRead[] = [
    {
      root: path.join(locator.userRoot, dir),
      boundary: locator.userRoot,
      scope: 'user',
      keyPrefix: 'user',
      live: true,
      owner: null,
      chain: userChain,
      used,
      usagePrefix: ''
    }
  ]
  if (benched !== null) {
    reads.push({
      root: path.join(locator.userRoot, benched),
      boundary: locator.userRoot,
      scope: 'user-disabled',
      keyPrefix: 'user-disabled',
      live: false,
      owner: null,
      chain: userChain,
      used,
      usagePrefix: ''
    })
  }
  for (const project of projects) {
    // ADR-0002: the project store is its .claude directory and nothing above
    // it. The bench directory is kondo's own, not Claude's — entry 029
    // verified that no Claude Code build reads it (ADR-0006).
    const claudeDir = path.join(project.absPath, '.claude')
    const owner = projectId(project.dirName)
    const chain = overrideChain(layers, owner)
    reads.push({
      root: path.join(claudeDir, dir),
      boundary: claudeDir,
      scope: 'project',
      keyPrefix: `project/${project.dirName}`,
      live: true,
      owner,
      chain,
      used,
      usagePrefix: ''
    })
    if (benched !== null) {
      reads.push({
        root: path.join(claudeDir, benched),
        boundary: claudeDir,
        scope: 'project-disabled',
        keyPrefix: `project-disabled/${project.dirName}`,
        live: false,
        owner,
        chain,
        used,
        usagePrefix: ''
      })
    }
  }

  const skills: SkillInfo[] = []
  for (const read of reads) skills.push(...(await readSkillDir(locator, read, c)))
  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}

/**
 * The skills one plugin ships, read from that plugin's own install root —
 * the plugins view's half of the split `scanSkills` describes.
 *
 * Its own function rather than a limb of `scanSkills`, because it is tier-2
 * work for the one plugin a user opened rather than something every skills
 * listing pays for (ADR-0007). A plugin whose `installPath` escaped the user
 * store has no root to follow: `scanPlugins` already nulled it and said why,
 * so nothing is read and the answer is empty rather than a second complaint.
 *
 * The result is read-only by construction. Its `plugin` scope resolves to the
 * matrix row refusing enable, disable and move alike (ADR-0006), so an id from
 * this listing cannot be mutated by whatever gets hold of one.
 *
 * The override chain is empty on purpose. Claude pins a plugin-shipped skill
 * to `on` before it consults `skillOverrides`, so a user, project or local
 * layer does not reach one at all (domain.md, verified by entry 029) — only
 * managed and flag settings do, and kondo reads neither.
 */
export async function scanPluginSkills(
  locator: StoreLocator,
  record: PluginRecord,
  used: ReadonlySet<string> | null,
  c: Collector
): Promise<SkillInfo[]> {
  if (record.installAbs === null) return []
  // `plugin:<key>` by construction in `scanPlugins`, so the key is the rest.
  const key = record.info.id.slice('plugin:'.length)
  const skills = await readSkillDir(
    locator,
    {
      root: path.join(record.installAbs, 'skills'),
      boundary: locator.userRoot,
      scope: 'plugin',
      keyPrefix: `plugin/${key}`,
      // A plugin-shipped skill has no bench of its own: it is live exactly
      // when its plugin is, which the plugin's own row already says.
      live: true,
      // A plugin belongs to no project: it is installed once and reaches
      // every one of them, so the attribution field has nothing to say.
      owner: null,
      chain: [],
      used,
      // Claude keys a plugin's skills `<plugin>:<name>` in `skillUsage`, so
      // the plugin's own name is what turns a listing name into that key.
      usagePrefix: `${record.info.name}:`
    },
    c
  )
  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}
