import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  HookInfo,
  PluginInfo,
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
}

export async function readSettingsLayers(
  locator: StoreLocator,
  projects: VerifiedProject[],
  c: Collector
): Promise<SettingsLayer[]> {
  const layers: SettingsLayer[] = []

  const read = async (
    id: string,
    layer: 'user' | 'project' | 'local',
    file: string
  ): Promise<void> => {
    const display = tildify(file, locator.home)
    const stat = await safeStat(file, display, c)
    const capabilities = capabilitiesFor('settings', layer)
    if (!stat) {
      layers.push({
        info: {
          id,
          kind: 'settings',
          capabilities,
          layer,
          path: display,
          exists: false,
          bytes: 0,
          keys: []
        },
        parsed: null
      })
      return
    }
    const json = await safeReadJson(file, display, c)
    const parsed =
      typeof json === 'object' && json !== null && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null
    layers.push({
      info: {
        id,
        kind: 'settings',
        capabilities,
        layer,
        path: display,
        exists: true,
        bytes: stat.size,
        keys: parsed ? Object.keys(parsed) : []
      },
      parsed
    })
  }

  await read('settings:user:user', 'user', path.join(locator.userRoot, 'settings.json'))
  for (const project of projects) {
    const claudeDir = path.join(project.absPath, '.claude')
    await read(
      `settings:project:${project.dirName}`,
      'project',
      path.join(claudeDir, 'settings.json')
    )
    await read(
      `settings:local:${project.dirName}`,
      'local',
      path.join(claudeDir, 'settings.local.json')
    )
  }
  return layers
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
        enabledIn: layers
          .filter((layer) => pluginEnabledIn(layer, key))
          .map((layer) => layer.info.path)
      },
      installAbs
    })
  }
  records.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return records
}

function pluginEnabledIn(layer: SettingsLayer, key: string): boolean {
  const enabled = layer.parsed?.['enabledPlugins']
  if (Array.isArray(enabled)) return enabled.includes(key)
  if (typeof enabled === 'object' && enabled !== null) {
    return Boolean((enabled as Record<string, unknown>)[key])
  }
  return false
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
    await addFrom(
      path.join(project.absPath, '.claude', 'skills'),
      'project',
      `project/${project.dirName}`,
      true
    )
  }

  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}
