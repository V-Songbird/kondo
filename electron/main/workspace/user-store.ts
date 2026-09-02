import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  HookInfo,
  McpScope,
  McpServerInfo,
  PlacedEntryInfo,
  PlacedKind,
  PlacedScope,
  ProjectRowCounts,
  PluginEffectiveState,
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
import { flattenProjectPath } from './projects'
import { projectId } from './sessions'
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
    owner: string | null,
    ownerId: string | null
  ): Promise<void> => {
    const file = path.join(root, relative)
    const display = tildify(file, locator.home)
    const stat = await safeStat(file, display, c)
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
            layer: layer.info.layer,
            projectId: layer.info.projectId
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

  // Display order for the whole row, unchanged: local, project, user.
  const ordered = [...layers].sort(
    (a, b) => LAYER_RANK[a.info.layer] - LAYER_RANK[b.info.layer]
  )

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
    const install =
      Array.isArray(installs) && typeof installs[0] === 'object' && installs[0] !== null
        ? (installs[0] as Record<string, unknown>)
        : {}
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
    // A plugin's enabled state belongs to a settings layer, not to the
    // plugin (ADR-0006), so every layer gets a row and its own matrix
    // decision — permission is kind × layer × operation, never one flag.
    const scopes: PluginScopeState[] = ordered.map((layer) => ({
      layerId: layer.info.id,
      layer: layer.info.layer,
      projectId: layer.info.projectId,
      projectLabel: layer.owner,
      path: layer.info.path,
      exists: layer.info.exists,
      enabled: pluginStateIn(layer, key),
      capabilities: capabilitiesFor('plugin', layer.info.layer)
    }))
    const effectiveIn = resolveEffective(key, userLayer, chains)
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
  records.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return records
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
 * root or the legacy array form — and `source` unchanged when there was
 * nothing there to take away.
 */
export function clearEnabledPlugin(source: string, key: string): string | null {
  const rootOpen = skipWs(source, 0)
  if (source[rootOpen] !== '{') return null
  const root = readObject(source, rootOpen)
  if (!root) return null

  const member = root.members.find((candidate) => candidate.key === ENABLED_PLUGINS)
  if (!member) return source
  if (source[member.valueStart] !== '{') return null
  const inner = readObject(source, member.valueStart)
  if (!inner) return null

  const at = inner.members.findIndex((candidate) => candidate.key === key)
  if (at < 0) return source
  const entry = inner.members[at] as JsonMember

  // Take the comma that joined it to whichever neighbour it had, so the
  // object left behind is still valid JSON with the file's own layout.
  const next = inner.members[at + 1]
  if (next) return source.slice(0, entry.keyStart) + source.slice(next.keyStart)
  const previous = inner.members[at - 1]
  if (previous) return source.slice(0, previous.valueEnd) + source.slice(entry.valueEnd)
  return `${source.slice(0, inner.open + 1)}}${source.slice(inner.close + 1)}`
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
// MCP servers

/** The file a team commits at the project root; the ADR-0002 exception. */
const MCP_FILE = '.mcp.json'

function asObject(value: unknown): Record<string, unknown> | null {
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
function stringSet(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((member): member is string => typeof member === 'string'))
}

/** `stdio` / `http` / `sse` as declared, inferred from a command, or unknown. */
function transportOf(declaration: Record<string, unknown>): string {
  const declared = declaration['type']
  if (typeof declared === 'string' && declared !== '') return declared
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
  return {
    id: `mcp:${entry.scope}:${entry.key}`,
    kind: 'mcp',
    capabilities: capabilitiesFor('mcp', entry.scope),
    name: entry.name,
    scope: entry.scope,
    // Only the transport is taken off the declaration. `env` and `headers`
    // hold API keys and bearer tokens in the wild (domain.md), so neither
    // their values nor their names are ever built into an entity.
    transport: transportOf(entry.declaration),
    source: entry.source,
    project: entry.project,
    enabled: !entry.disabled.has(entry.name),
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
  const config = asObject(await safeReadJson(locator.userConfigFile, configDisplay, c))
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
    const orphan = (await safeStat(absPath, tildify(absPath, locator.home), c)) === null
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
    for (const [name, declaration] of mcpDeclarations(await safeReadJson(file, display, c))) {
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
  c: Collector
): Promise<PlacedRecord[]> {
  const records: PlacedRecord[] = []
  const display = tildify(root, locator.home)
  for (const entry of await safeReaddir(root, display, c)) {
    // A symlink is admitted in either shape; the read below is what decides
    // whether what it points at is the shape this directory claims to hold.
    const link = entry.isSymbolicLink()
    let name: string
    let target: string
    let manifest: string
    let manifestDisplay: string
    if (shape === 'skill-dir') {
      if (!entry.isDirectory() && !link) continue
      name = entry.name
      target = path.join(root, entry.name)
      manifest = path.join(target, SKILL_MANIFEST)
      manifestDisplay = `${display}/${entry.name}/${SKILL_MANIFEST}`
    } else {
      if (!entry.isFile() && !link) continue
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
      content = await fs.readFile(manifest, 'utf8')
    } catch (cause) {
      // A directory with no `SKILL.md` is not a skill, and a file that went
      // away between the listing and the read is simply gone — neither is
      // worth reporting. Anything else is.
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue
      c.fail('read-failed', manifestDisplay, cause)
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

/** The skill directories under `root`, as SkillInfo. */
async function readSkillDir(
  locator: StoreLocator,
  root: string,
  scope: SkillInfo['scope'],
  keyPrefix: string,
  enabled: boolean,
  owner: string | null,
  c: Collector
): Promise<SkillInfo[]> {
  return (await readPlacedDir(locator, root, 'skill-dir', c)).map((record) => ({
    id: `skill:${keyPrefix}:${record.name}`,
    kind: 'skill',
    capabilities: capabilitiesFor('skill', scope),
    name: record.name,
    description: record.description,
    scope,
    origin: tildify(record.target, locator.home),
    enabled,
    // ADR-0008: the owning project travels as a field. The renderer joins
    // on it rather than splitting `skill:project/<flat>:<name>` apart.
    projectId: owner
  }))
}

/**
 * The directory each placed kind lives in, and whether a project store has
 * one too (domain.md). Output styles are user-scope here because no project
 * store has been observed carrying them; kondo does not go looking for a
 * directory it has never seen.
 */
const PLACED_DIRS: Record<PlacedKind, { dir: string; inProject: boolean }> = {
  agent: { dir: 'agents', inProject: true },
  command: { dir: 'commands', inProject: true },
  rule: { dir: 'rules', inProject: true },
  'output-style': { dir: 'output-styles', inProject: false }
}

/**
 * Every entry of one placed kind, in the user store and in each verified
 * project. Read-only by construction: the scope resolves to a matrix row
 * refusing both toggles (ADR-0006 — Claude has no disable convention for
 * these) and refusing `move` until entry 028, so an id from this listing
 * cannot be mutated by whatever gets hold of one.
 */
export async function scanPlacedEntries(
  locator: StoreLocator,
  kind: PlacedKind,
  projects: VerifiedProject[],
  c: Collector
): Promise<PlacedEntryInfo[]> {
  const { dir, inProject } = PLACED_DIRS[kind]
  const roots: Array<[string, PlacedScope, string, string | null]> = [
    [path.join(locator.userRoot, dir), 'user', 'user', null]
  ]
  if (inProject) {
    for (const project of projects) {
      // ADR-0002: the project store is its .claude directory and nothing
      // above it, so the root is joined from there and never from the root.
      roots.push([
        path.join(project.absPath, '.claude', dir),
        'project',
        `project/${project.dirName}`,
        projectId(project.dirName)
      ])
    }
  }

  const entries: PlacedEntryInfo[] = []
  for (const [root, scope, keyPrefix, owner] of roots) {
    for (const record of await readPlacedDir(locator, root, 'markdown', c)) {
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

/** Directory names count as entries in either shape; so do symlinks to them. */
function isDirLike(entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): boolean {
  return entry.isDirectory() || entry.isSymbolicLink()
}

function isMarkdownLike(entry: {
  name: string
  isFile(): boolean
  isSymbolicLink(): boolean
}): boolean {
  return (
    (entry.isFile() || entry.isSymbolicLink()) &&
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
  const listing = await safeReaddir(root, display, c)
  const present = new Set(listing.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const held = new Set(listing.filter(isDirLike).map((entry) => entry.name))

  const count = async (
    dir: string,
    admits: (entry: { name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }) => boolean
  ): Promise<number> => {
    // The root listing already says which directories exist, so a store
    // holding none of them costs exactly one readdir in total.
    if (!held.has(dir)) return 0
    return (await safeReaddir(path.join(root, dir), `${display}/${dir}`, c)).filter(admits).length
  }

  return {
    skills: (await count('skills', isDirLike)) + (await count('skills.disabled', isDirLike)),
    agents: await count(PLACED_DIRS.agent.dir, isMarkdownLike),
    commands: await count(PLACED_DIRS.command.dir, isMarkdownLike),
    rules: await count(PLACED_DIRS.rule.dir, isMarkdownLike),
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
  c: Collector
): Promise<SkillInfo[]> {
  const roots: Array<[string, SkillInfo['scope'], string, boolean, string | null]> = [
    [path.join(locator.userRoot, 'skills'), 'user', 'user', true, null],
    [
      path.join(locator.userRoot, 'skills.disabled'),
      'user-disabled',
      'user-disabled',
      false,
      null
    ]
  ]
  for (const project of projects) {
    // ADR-0002: the project store is its .claude directory and nothing above
    // it. ADR-0006: skills.disabled is Claude's own convention, scoped.
    const claudeDir = path.join(project.absPath, '.claude')
    const owner = projectId(project.dirName)
    roots.push(
      [path.join(claudeDir, 'skills'), 'project', `project/${project.dirName}`, true, owner],
      [
        path.join(claudeDir, 'skills.disabled'),
        'project-disabled',
        `project-disabled/${project.dirName}`,
        false,
        owner
      ]
    )
  }

  const skills: SkillInfo[] = []
  for (const [root, scope, keyPrefix, enabled, owner] of roots) {
    skills.push(...(await readSkillDir(locator, root, scope, keyPrefix, enabled, owner, c)))
  }
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
 */
export async function scanPluginSkills(
  locator: StoreLocator,
  record: PluginRecord,
  c: Collector
): Promise<SkillInfo[]> {
  if (record.installAbs === null) return []
  // `plugin:<key>` by construction in `scanPlugins`, so the key is the rest.
  const key = record.info.id.slice('plugin:'.length)
  const skills = await readSkillDir(
    locator,
    path.join(record.installAbs, 'skills'),
    'plugin',
    `plugin/${key}`,
    // A plugin-shipped skill has no bench of its own: it is live exactly when
    // its plugin is, which the plugin's own row already says.
    true,
    // A plugin belongs to no project: it is installed once and reaches every
    // one of them, so the attribution field has nothing to say.
    null,
    c
  )
  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}
