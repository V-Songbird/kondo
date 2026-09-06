import type {
  HookGroup,
  HookInfo,
  McpServerInfo,
  PlacedEntryInfo,
  PluginInfo,
  ProjectRow,
  SettingsLayerInfo,
  SkillDuplicateGroup,
  SkillInfo
} from '../../../shared/contract'

/**
 * The Library's catalog: one row per *named object*, not one row per project.
 *
 * Kondo already knows that a skill sits in four scopes, that two copies digest
 * identically, that a hook names a script that is gone, and which settings
 * layer switched something off. It computes all of it and throws it away,
 * because until now the only shape the renderer had was one project at a
 * time. This module is the join that makes the object the row.
 *
 * Everything here is pure and takes what the bridge already returns, so it is
 * testable without a DOM the way `project-rows.ts` and `orphan-rows.ts` are.
 * Nothing parses an id or a path (ADR-0008): objects group by `name`, and a
 * project's display label comes from a lookup on `ProjectRow.id`.
 */

/** Which register a chip speaks in. Mirrors the four state classes. */
export type Tone = 'ok' | 'off' | 'bad' | 'unknown' | 'fact'

export interface Flag {
  text: string
  tone: Tone
}

export type LibraryKind =
  | 'skill'
  | 'plugin'
  | 'hook'
  | 'mcp'
  | 'agent'
  | 'command'
  | 'rule'
  | 'output-style'
  | 'settings'

/** What a kind is called on screen. Sentence case, and never a hue. */
export const KIND_LABEL: Record<LibraryKind, string> = {
  skill: 'skill',
  plugin: 'plugin',
  hook: 'hook',
  mcp: 'mcp server',
  agent: 'agent',
  command: 'command',
  rule: 'rule',
  'output-style': 'output style',
  settings: 'settings file'
}

/** The order kinds are listed in, and the order the segments sit in. */
export const KIND_ORDER: LibraryKind[] = [
  'skill',
  'plugin',
  'hook',
  'mcp',
  'agent',
  'command',
  'rule',
  'output-style',
  'settings'
]

export interface LibraryObject {
  /** Selection id and React key. Built from kind and name, never parsed. */
  key: string
  kind: LibraryKind
  name: string
  /** How many places hold this object, or state something about it. */
  places: number
  /** How many copies exist, which is not the same number as places. */
  copies: number
  flags: Flag[]
}

/** Something kondo found that is worth a look, and what is wrong with it. */
export interface Finding {
  key: string
  name: string
  kind: LibraryKind
  where: string
  chip: Flag
  why: string
}

export interface CatalogInput {
  skills: SkillInfo[]
  duplicates: SkillDuplicateGroup[]
  plugins: PluginInfo[]
  hookGroups: HookGroup[]
  mcp: McpServerInfo[]
  placed: PlacedEntryInfo[]
  layers: SettingsLayerInfo[]
  projects: ProjectRow[]
}

export function objectKey(kind: LibraryKind, name: string): string {
  return `${kind} ${name}`
}

/**
 * A scope's name on screen. The user store is `Global`; a project is whatever
 * its row is called, and an id with no row is printed as the id rather than
 * guessed at — an honest null beats a plausible label.
 */
export function scopeLabel(projectId: string | null, projects: ProjectRow[]): string {
  if (projectId === null) return 'Global'
  const row = projects.find((project) => project.id === projectId)
  return row?.name ?? projectId
}

/** Every hook on the machine, flattened out of its per-scope groups. */
export function allHooks(groups: HookGroup[]): HookInfo[] {
  return groups.flatMap((group) => group.hooks)
}

/** What a hook is called: the event, and the matcher when it has one. */
export function hookName(hook: HookInfo): string {
  return hook.matcher === null ? hook.event : `${hook.event} · ${hook.matcher}`
}

/**
 * The verdict on a repeated skill name. Kondo groups the copies and says
 * nothing about which to keep — a name repeated with different bytes is two
 * skills, and a copy it could not read is not evidence of anything.
 */
function duplicateFlag(group: SkillDuplicateGroup | undefined): Flag | null {
  if (group === undefined) return null
  if (group.identical) return { text: 'identical copies', tone: 'ok' }
  if (group.members.some((member) => member.digest === null)) {
    return { text: 'one copy could not be read', tone: 'unknown' }
  }
  return { text: 'same name, different contents', tone: 'unknown' }
}

function skillObjects(input: CatalogInput): LibraryObject[] {
  const byName = new Map<string, SkillInfo[]>()
  for (const skill of input.skills) {
    const list = byName.get(skill.name)
    if (list) list.push(skill)
    else byName.set(skill.name, [skill])
  }
  return [...byName].map(([name, members]) => {
    const flags: Flag[] = []
    const verdict = duplicateFlag(input.duplicates.find((group) => group.name === name))
    if (verdict) flags.push(verdict)
    const off = members.filter((member) => !member.enabled).length
    if (off > 0) {
      flags.push({ text: off === members.length ? 'off' : `off in ${off}`, tone: 'off' })
    }
    // Claude's own skillUsage record, not a count kondo keeps — and only worth
    // saying when every copy is unused.
    if (members.length > 0 && members.every((member) => member.neverUsed === true)) {
      flags.push({ text: 'never used', tone: 'unknown' })
    }
    return {
      key: objectKey('skill', name),
      kind: 'skill' as const,
      name,
      places: members.length,
      copies: members.length,
      flags
    }
  })
}

function pluginObjects(input: CatalogInput): LibraryObject[] {
  return input.plugins.map((plugin) => {
    const stated = plugin.scopes.filter((scope) => scope.enabled !== null)
    const on = stated.filter((scope) => scope.enabled === true).length
    const flags: Flag[] = []
    if (!plugin.installed) {
      flags.push({ text: 'leftover', tone: 'bad' })
    } else if (stated.length === 0) {
      flags.push({ text: 'nothing says', tone: 'unknown' })
    } else if (on === stated.length) {
      flags.push({ text: stated.length === 1 ? 'on' : `on in ${on}`, tone: 'ok' })
    } else if (on === 0) {
      flags.push({ text: 'off', tone: 'off' })
    } else {
      flags.push({ text: `on in ${on} of ${stated.length}`, tone: 'ok' })
    }
    if (plugin.version !== null) flags.push({ text: plugin.version, tone: 'fact' })
    return {
      key: objectKey('plugin', plugin.name),
      kind: 'plugin' as const,
      name: plugin.name,
      places: stated.length,
      copies: 1,
      flags
    }
  })
}

/** A hook exists exactly once, so a hook's places and copies are both 1. */
function hookObjects(input: CatalogInput): LibraryObject[] {
  return allHooks(input.hookGroups).map((hook) => {
    const flags: Flag[] = []
    if (hook.script === null) {
      flags.push({ text: 'no script named', tone: 'fact' })
    } else if (hook.script.status === 'missing') {
      flags.push({ text: 'not found', tone: 'bad' })
    } else if (hook.script.status === 'unverifiable') {
      flags.push({ text: 'cannot check', tone: 'unknown' })
    } else {
      flags.push({ text: 'on disk', tone: 'ok' })
    }
    flags.push({ text: hook.layer, tone: 'fact' })
    return {
      key: objectKey('hook', `${hookName(hook)} ${hook.id}`),
      kind: 'hook' as const,
      name: hookName(hook),
      places: 1,
      copies: 1,
      flags
    }
  })
}

function mcpObjects(input: CatalogInput): LibraryObject[] {
  const byName = new Map<string, McpServerInfo[]>()
  for (const server of input.mcp) {
    const list = byName.get(server.name)
    if (list) list.push(server)
    else byName.set(server.name, [server])
  }
  return [...byName].map(([name, members]) => {
    const flags: Flag[] = []
    if (members.some((member) => member.orphan)) {
      flags.push({ text: 'project is gone', tone: 'bad' })
    } else if (members.every((member) => !member.enabled)) {
      flags.push({ text: 'off', tone: 'off' })
    } else {
      flags.push({ text: 'on', tone: 'ok' })
    }
    return {
      key: objectKey('mcp', name),
      kind: 'mcp' as const,
      name,
      places: members.length,
      copies: members.length,
      flags
    }
  })
}

function placedObjects(input: CatalogInput): LibraryObject[] {
  const byKey = new Map<string, PlacedEntryInfo[]>()
  for (const entry of input.placed) {
    const key = objectKey(entry.kind, entry.name)
    const list = byKey.get(key)
    if (list) list.push(entry)
    else byKey.set(key, [entry])
  }
  return [...byKey].flatMap(([key, members]) => {
    const first = members[0]
    if (first === undefined) return []
    return [
      {
        key,
        kind: first.kind as LibraryKind,
        name: first.name,
        places: members.length,
        copies: members.length,
        flags: [] as Flag[]
      }
    ]
  })
}

function layerObjects(input: CatalogInput): LibraryObject[] {
  return input.layers.map((layer) => ({
    key: objectKey('settings', layer.id),
    kind: 'settings' as const,
    name: `${scopeLabel(layer.projectId, input.projects)} · ${layer.layer}`,
    places: 1,
    copies: 1,
    flags: layer.exists
      ? [{ text: `${layer.keys.length} keys`, tone: 'fact' as const }]
      : [{ text: 'not created yet', tone: 'unknown' as const }]
  }))
}

/** Every named object Claude loads on this machine, in kind order. */
export function buildCatalog(input: CatalogInput): LibraryObject[] {
  const objects = [
    ...skillObjects(input),
    ...pluginObjects(input),
    ...hookObjects(input),
    ...mcpObjects(input),
    ...placedObjects(input),
    ...layerObjects(input)
  ]
  const rank = new Map(KIND_ORDER.map((kind, index) => [kind, index]))
  return objects.sort((a, b) => {
    const byKind = (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99)
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name)
  })
}

/** Substring match over the name and the kind's own word. */
export function filterCatalog(
  objects: LibraryObject[],
  query: string,
  kind: LibraryKind | null
): LibraryObject[] {
  const needle = query.trim().toLowerCase()
  return objects.filter((object) => {
    if (kind !== null && object.kind !== kind) return false
    if (needle === '') return true
    return (
      object.name.toLowerCase().includes(needle) ||
      KIND_LABEL[object.kind].includes(needle)
    )
  })
}

export interface KindCount {
  kind: LibraryKind
  objects: number
  copies: number
  findings: number
}

/**
 * The machine at a glance. `copies` is not `places`: a hook exists exactly
 * once, so hooks read n of n, while a skill in four scopes is one object and
 * four copies.
 */
export function countByKind(objects: LibraryObject[], findings: Finding[]): KindCount[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    objects: objects.filter((object) => object.kind === kind).length,
    copies: objects
      .filter((object) => object.kind === kind)
      .reduce((sum, object) => sum + object.copies, 0),
    findings: findings.filter((finding) => finding.kind === kind).length
  })).filter((count) => count.objects > 0 || count.findings > 0)
}

/**
 * What needs a look, and why. Getting this to zero is the answer to "am I
 * done" — a question no screen in the app answers today. Every row here is
 * evidence with its own sentence, never a verdict about what to remove.
 */
export function findings(input: CatalogInput): Finding[] {
  const found: Finding[] = []

  for (const hook of allHooks(input.hookGroups)) {
    if (hook.script?.status !== 'missing') continue
    found.push({
      key: objectKey('hook', `${hookName(hook)} ${hook.id}`),
      name: hookName(hook),
      kind: 'hook',
      where: hook.source,
      chip: { text: 'not found', tone: 'bad' },
      why: `The script it runs is not on disk: ${hook.script.path}`
    })
  }

  for (const server of input.mcp) {
    if (!server.orphan) continue
    found.push({
      key: objectKey('mcp', server.name),
      name: server.name,
      kind: 'mcp',
      where: server.source,
      chip: { text: 'project is gone', tone: 'bad' },
      why: 'The folder this declaration points at is no longer on disk.'
    })
  }

  for (const group of input.duplicates) {
    if (group.identical) continue
    const unreadable = group.members.some((member) => member.digest === null)
    found.push({
      key: objectKey('skill', group.name),
      name: group.name,
      kind: 'skill',
      where: `${group.members.length} scopes`,
      chip: unreadable
        ? { text: 'one copy could not be read', tone: 'unknown' }
        : { text: 'same name, different contents', tone: 'unknown' },
      why: unreadable
        ? 'Kondo cannot say it is the same skill.'
        : 'The copies differ, so neither is redundant.'
    })
  }

  for (const plugin of input.plugins) {
    if (plugin.installed) continue
    found.push({
      key: objectKey('plugin', plugin.name),
      name: plugin.name,
      kind: 'plugin',
      where: plugin.scopes.find((scope) => scope.enabled !== null)?.path ?? plugin.installPath,
      chip: { text: 'leftover', tone: 'bad' },
      why: `${plugin.name} is not installed; this key states a plugin that is not there.`
    })
  }

  return found
}
