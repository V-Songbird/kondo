import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  HookInfo,
  PluginInfo,
  PluginScopeState,
  SettingsLayerInfo,
  SkillInfo,
  StoreEntry,
  StoreReport
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import {
  directorySize,
  pathWithin,
  safeReaddir,
  safeReadJson,
  safeStat,
  type Collector
} from './scan'
import { capabilitiesFor } from './capabilities'
import { readFrontmatter } from './frontmatter'
import { tildify, truncate } from './display'

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
  const info = await safeStat(root, display, c)
  if (!info) return { root: display, exists: false, entries: [], totalBytes: 0 }

  const entries: StoreEntry[] = []
  for (const entry of await safeReaddir(root, display, c)) {
    const child = path.join(root, entry.name)
    const childDisplay = `${display}/${entry.name}`
    const stat = await safeStat(child, childDisplay, c)
    if (!stat) continue
    if (entry.isDirectory()) {
      // projects/ bytes come from the session inventory — one walk, not two
      // (ADR-0007). Sidecar bytes are therefore not counted; the sessions
      // view says "transcript bytes" for the same reason.
      const bytes =
        entry.name === 'projects' ? transcriptBytes : await directorySize(child, childDisplay, c)
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

export async function readSettingsLayers(
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<SettingsLayer[]> {
  const layers: SettingsLayer[] = []

  const read = async (
    id: string,
    layer: 'user' | 'project' | 'local',
    root: string,
    store: string,
    relative: string,
    owner: string | null
  ): Promise<void> => {
    const file = path.join(root, relative)
    const display = tildify(file, locator.home)
    const stat = await safeStat(file, display, c)
    const base = {
      id,
      kind: 'settings' as const,
      capabilities: capabilitiesFor('settings', layer),
      layer,
      path: display
    }
    if (!stat) {
      layers.push({
        info: { ...base, exists: false, bytes: 0, keys: [] },
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
      source = await fs.readFile(file, 'utf8')
    } catch (cause) {
      c.fail('read-failed', display, cause)
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
    layers.push({
      info: {
        ...base,
        exists: true,
        bytes: stat.size,
        keys: parsed ? Object.keys(parsed) : []
      },
      parsed,
      source,
      store,
      relative,
      owner
    })
  }

  await read('settings:user:user', 'user', locator.userRoot, 'user', SETTINGS_FILE, null)
  for (const project of projects) {
    // ADR-0002: the project store is its .claude directory, and both of its
    // layers live directly inside it.
    const claudeDir = path.join(project.absPath, '.claude')
    const store = `project:${project.dirName}`
    // The folder name, not the flattened one: this is what the UI shows to
    // tell one project's two layers from another's.
    const owner = path.basename(project.absPath)
    await read(
      `settings:project:${project.dirName}`,
      'project',
      claudeDir,
      store,
      SETTINGS_FILE,
      owner
    )
    await read(
      `settings:local:${project.dirName}`,
      'local',
      claudeDir,
      store,
      SETTINGS_LOCAL_FILE,
      owner
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

export function hooksFromLayers(layers: SettingsLayer[]): HookInfo[] {
  const hooks: HookInfo[] = []
  for (const layer of layers) {
    const config = layer.parsed?.['hooks']
    if (typeof config !== 'object' || config === null || Array.isArray(config)) continue
    let index = 0
    for (const [event, groups] of Object.entries(config)) {
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (typeof group !== 'object' || group === null) continue
        const record = group as Record<string, unknown>
        const matcher = typeof record['matcher'] === 'string' ? record['matcher'] : null
        const inner = Array.isArray(record['hooks']) ? record['hooks'] : []
        for (const hook of inner) {
          if (typeof hook !== 'object' || hook === null) continue
          const command = (hook as Record<string, unknown>)['command']
          hooks.push({
            id: `hook:${layer.info.id}:${index++}`,
            kind: 'hook',
            capabilities: capabilitiesFor('hook', layer.info.layer),
            event,
            matcher,
            command: typeof command === 'string' ? truncate(command, 200) : '(not a command)',
            source: layer.info.path,
            layer: layer.info.layer
          })
        }
      }
    }
  }
  return hooks
}

// ---------------------------------------------------------------------------
// Plugins

export interface PluginRecord {
  info: PluginInfo
  installAbs: string | null
}

export async function scanPlugins(
  locator: StoreLocator,
  layers: SettingsLayer[],
  c: Collector
): Promise<PluginRecord[]> {
  const file = path.join(locator.userRoot, 'plugins', 'installed_plugins.json')
  const json = await safeReadJson(file, tildify(file, locator.home), c)
  if (typeof json !== 'object' || json === null) return []
  const plugins = (json as Record<string, unknown>)['plugins']
  if (typeof plugins !== 'object' || plugins === null) return []

  // Precedence order once, for every plugin: the first layer in it that
  // states a value is the one Claude honours.
  const ordered = [...layers].sort(
    (a, b) => LAYER_RANK[a.info.layer] - LAYER_RANK[b.info.layer]
  )

  const records: PluginRecord[] = []
  for (const [key, installs] of Object.entries(plugins)) {
    const at = key.lastIndexOf('@')
    const name = at > 0 ? key.slice(0, at) : key
    const marketplace = at > 0 ? key.slice(at + 1) : ''
    const install =
      Array.isArray(installs) && typeof installs[0] === 'object' && installs[0] !== null
        ? (installs[0] as Record<string, unknown>)
        : {}
    const installAbs =
      typeof install['installPath'] === 'string' ? install['installPath'] : null
    const installScope = typeof install['scope'] === 'string' ? install['scope'] : 'user'
    // A plugin's enabled state belongs to a settings layer, not to the
    // plugin (ADR-0006), so every layer gets a row and its own matrix
    // decision — permission is kind × layer × operation, never one flag.
    const scopes: PluginScopeState[] = ordered.map((layer) => ({
      layerId: layer.info.id,
      layer: layer.info.layer,
      project: layer.owner,
      path: layer.info.path,
      exists: layer.info.exists,
      enabled: pluginStateIn(layer, key),
      capabilities: capabilitiesFor('plugin', layer.info.layer)
    }))
    records.push({
      info: {
        id: `plugin:${key}`,
        kind: 'plugin',
        capabilities: capabilitiesFor('plugin', installScope),
        name,
        marketplace,
        version: typeof install['version'] === 'string' ? install['version'] : null,
        installScope,
        installedAt:
          typeof install['installedAt'] === 'string' ? install['installedAt'] : null,
        lastUpdated:
          typeof install['lastUpdated'] === 'string' ? install['lastUpdated'] : null,
        installPath: installAbs ? tildify(installAbs, locator.home) : '(unknown)',
        enabledIn: scopes.filter((scope) => scope.enabled === true).map((scope) => scope.path),
        scopes,
        winningLayerId: scopes.find((scope) => scope.enabled !== null)?.layerId ?? null
      },
      installAbs
    })
  }
  records.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return records
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
 * inserted at — differs from `source`.
 *
 * Null when the file's shape is one kondo cannot splice faithfully: a
 * non-object root, or the legacy array form of `enabledPlugins`. The caller
 * refuses rather than reformatting (ADR-0005).
 */
export function editEnabledPlugins(
  source: string,
  key: string,
  enabled: boolean
): string | null {
  const rootOpen = skipWs(source, 0)
  if (source[rootOpen] !== '{') return null
  const root = readObject(source, rootOpen)
  if (!root) return null

  const literal = enabled ? 'true' : 'false'
  const member = root.members.find((candidate) => candidate.key === ENABLED_PLUGINS)
  if (!member) {
    return insertMember(
      source,
      root,
      `${JSON.stringify(ENABLED_PLUGINS)}: { ${JSON.stringify(key)}: ${literal} }`
    )
  }
  if (source[member.valueStart] !== '{') return null
  const inner = readObject(source, member.valueStart)
  if (!inner) return null

  const entry = inner.members.find((candidate) => candidate.key === key)
  if (entry) {
    return source.slice(0, entry.valueStart) + literal + source.slice(entry.valueEnd)
  }
  return insertMember(source, inner, `${JSON.stringify(key)}: ${literal}`)
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
function insertMember(source: string, object: JsonObject, text: string): string {
  const first = object.members[0]
  const last = object.members[object.members.length - 1]
  if (!first || !last) {
    return `${source.slice(0, object.open + 1)} ${text} ${source.slice(object.close)}`
  }
  const lead = source.slice(object.open + 1, first.keyStart)
  return `${source.slice(0, last.valueEnd)},${lead}${text}${source.slice(last.valueEnd)}`
}

// ---------------------------------------------------------------------------
// Skills

const SKILL_MANIFEST = 'SKILL.md'
const MAX_MANIFEST_BYTES = 262_144

export async function scanSkills(
  locator: StoreLocator,
  projects: VerifiedProject[],
  plugins: PluginRecord[],
  c: Collector
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []

  const addFrom = async (
    root: string,
    scope: SkillInfo['scope'],
    keyPrefix: string,
    enabled: boolean
  ): Promise<void> => {
    const display = tildify(root, locator.home)
    for (const entry of await safeReaddir(root, display, c)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const dir = path.join(root, entry.name)
      const manifest = path.join(dir, SKILL_MANIFEST)
      const manifestDisplay = `${display}/${entry.name}/${SKILL_MANIFEST}`
      let description: string | null = null
      try {
        const content = await fs.readFile(manifest, 'utf8')
        description = readFrontmatter(content.slice(0, MAX_MANIFEST_BYTES)).description
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue
        c.fail('read-failed', manifestDisplay, cause)
        continue
      }
      skills.push({
        id: `skill:${keyPrefix}:${entry.name}`,
        kind: 'skill',
        capabilities: capabilitiesFor('skill', scope),
        name: entry.name,
        description,
        scope,
        origin: tildify(dir, locator.home),
        enabled
      })
    }
  }

  await addFrom(path.join(locator.userRoot, 'skills'), 'user', 'user', true)
  await addFrom(
    path.join(locator.userRoot, 'skills.disabled'),
    'user-disabled',
    'user-disabled',
    false
  )
  for (const plugin of plugins) {
    if (!plugin.installAbs) continue
    // Confinement (SECURITY.md): installPath comes from a store manifest and
    // is followed only while it stays inside the user store.
    if (!pathWithin(plugin.installAbs, locator.userRoot)) {
      c.errors.push({
        code: 'out-of-store',
        path: plugin.info.installPath,
        message: `installPath of ${plugin.info.id} escapes the user store; its skills were not scanned.`
      })
      continue
    }
    await addFrom(
      path.join(plugin.installAbs, 'skills'),
      'plugin',
      `plugin/${plugin.info.name}@${plugin.info.marketplace}`,
      plugin.info.enabledIn.length > 0
    )
  }
  for (const project of projects) {
    // ADR-0002: the project store is its .claude directory and nothing above
    // it. ADR-0006: skills.disabled is Claude's own convention, scoped.
    const claudeDir = path.join(project.absPath, '.claude')
    await addFrom(path.join(claudeDir, 'skills'), 'project', `project/${project.dirName}`, true)
    await addFrom(
      path.join(claudeDir, 'skills.disabled'),
      'project-disabled',
      `project-disabled/${project.dirName}`,
      false
    )
  }

  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}
