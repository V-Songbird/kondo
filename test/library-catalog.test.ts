import { describe, expect, it } from 'vitest'
import type {
  HookGroup,
  McpServerInfo,
  PluginInfo,
  SkillDuplicateGroup,
  SkillInfo
} from '../shared/contract'
import {
  buildCatalog,
  countByKind,
  filterCatalog,
  findings,
  objectKey,
  scopeLabel
} from '../src/features/library/catalog'
import type { CatalogInput } from '../src/features/library/catalog'

const none = { allowed: false as const, reason: 'no', code: 'unsupported' as const }
const caps = { disable: none, enable: none, move: none, trash: none, clear: none }

const skill = (name: string, over: Partial<SkillInfo> = {}): SkillInfo =>
  ({
    id: `skill:${over.projectId ?? 'user'}:${name}`,
    kind: 'skill',
    capabilities: caps,
    name,
    description: null,
    scope: 'user',
    origin: `~/.claude/skills/${name}`,
    enabled: true,
    override: null,
    neverUsed: null,
    projectId: null,
    ...over
  }) as SkillInfo

const empty: CatalogInput = {
  skills: [],
  duplicates: [],
  plugins: [],
  hookGroups: [],
  mcp: [],
  placed: [],
  layers: [],
  projects: []
}

describe('the Library catalog', () => {
  it('makes one object per name, however many scopes hold it', () => {
    const input: CatalogInput = {
      ...empty,
      skills: [
        skill('run-kondo'),
        skill('run-kondo', { projectId: 'project:code:slag', scope: 'project' }),
        skill('hush')
      ]
    }
    const catalog = buildCatalog(input)
    expect(catalog.map((object) => object.name)).toEqual(['hush', 'run-kondo'])
    expect(catalog.find((object) => object.name === 'run-kondo')?.places).toBe(2)
  })

  it('says how many copies are off, and only says "off" when every one is', () => {
    const both = buildCatalog({
      ...empty,
      skills: [skill('a', { enabled: false }), skill('a', { projectId: 'p', enabled: false })]
    })
    expect(both[0]?.flags.map((flag) => flag.text)).toContain('off')

    const one = buildCatalog({
      ...empty,
      skills: [skill('a'), skill('a', { projectId: 'p', enabled: false })]
    })
    expect(one[0]?.flags.map((flag) => flag.text)).toContain('off in 1')
  })

  it('never calls a repeated name a redundant copy on a digest it does not have', () => {
    const unreadable: SkillDuplicateGroup = {
      name: 'razor',
      identical: false,
      members: [
        { skill: skill('razor'), digest: 'a1' },
        { skill: skill('razor', { projectId: 'p' }), digest: null }
      ]
    }
    const found = findings({ ...empty, duplicates: [unreadable] })
    expect(found).toHaveLength(1)
    expect(found[0]?.chip.text).toBe('one copy could not be read')
    expect(found[0]?.why).not.toContain('redundant')

    const differing: SkillDuplicateGroup = {
      ...unreadable,
      members: [
        { skill: skill('razor'), digest: 'a1' },
        { skill: skill('razor', { projectId: 'p' }), digest: 'b2' }
      ]
    }
    expect(findings({ ...empty, duplicates: [differing] })[0]?.chip.text).toBe(
      'same name, different contents'
    )

    const same: SkillDuplicateGroup = { ...differing, identical: true }
    expect(findings({ ...empty, duplicates: [same] })).toHaveLength(0)
  })

  it('reports a hook whose script is gone, and stays quiet about one it cannot check', () => {
    const groups: HookGroup[] = [
      {
        projectId: null,
        label: 'Global',
        hooks: [
          {
            id: 'hook:user:0',
            kind: 'hook',
            capabilities: caps,
            event: 'PreToolUse',
            matcher: 'Edit|Write',
            command: 'pwsh guard.ps1',
            script: { path: '~/.claude/hooks/guard.ps1', status: 'missing' },
            source: '~/.claude/settings.json',
            layer: 'user',
            projectId: null,
            projectLabel: null
          },
          {
            id: 'hook:user:1',
            kind: 'hook',
            capabilities: caps,
            event: 'Stop',
            matcher: null,
            command: '$CLAUDE_PROJECT_DIR/stop.ps1',
            script: { path: '$CLAUDE_PROJECT_DIR/stop.ps1', status: 'unverifiable' },
            source: '~/.claude/settings.json',
            layer: 'user',
            projectId: null,
            projectLabel: null
          }
        ]
      }
    ]
    const found = findings({ ...empty, hookGroups: groups })
    expect(found.map((finding) => finding.name)).toEqual(['PreToolUse · Edit|Write'])
    expect(found[0]?.why).toContain('~/.claude/hooks/guard.ps1')
  })

  it('counts copies separately from objects', () => {
    const input: CatalogInput = {
      ...empty,
      skills: [skill('a'), skill('a', { projectId: 'p' }), skill('b')],
      hookGroups: [
        {
          projectId: null,
          label: 'Global',
          hooks: [
            {
              id: 'hook:user:0',
              kind: 'hook',
              capabilities: caps,
              event: 'Stop',
              matcher: null,
              command: 'true',
              script: null,
              source: '~/.claude/settings.json',
              layer: 'user',
              projectId: null,
              projectLabel: null
            }
          ]
        }
      ]
    }
    const catalog = buildCatalog(input)
    const counts = countByKind(catalog, findings(input))
    expect(counts.find((count) => count.kind === 'skill')).toMatchObject({
      objects: 2,
      copies: 3
    })
    // A hook exists exactly once, so its two columns agree.
    expect(counts.find((count) => count.kind === 'hook')).toMatchObject({
      objects: 1,
      copies: 1
    })
  })

  it('flags an MCP declaration whose folder is gone', () => {
    const server: McpServerInfo = {
      id: 'mcp:user:ctx',
      kind: 'mcp',
      capabilities: caps,
      name: 'ctx',
      scope: 'user',
      transport: 'stdio',
      source: '~/.claude.json',
      project: 'D:/Projects/removed',
      enabled: true,
      orphan: true
    }
    const found = findings({ ...empty, mcp: [server] })
    expect(found[0]?.chip.text).toBe('project is gone')
  })

  it('flags a plugin switch with no plugin behind it', () => {
    const plugin = {
      id: 'plugin:ghost@acme',
      kind: 'plugin',
      capabilities: caps,
      name: 'ghost@acme',
      marketplace: 'acme',
      installed: false,
      version: null,
      installScope: 'user',
      installedAt: null,
      lastUpdated: null,
      installPath: '~/.claude/plugins/cache/acme/ghost',
      enabledIn: [],
      scopes: [],
      effectiveIn: []
    } as unknown as PluginInfo
    expect(findings({ ...empty, plugins: [plugin] })[0]?.chip.text).toBe('leftover')
    expect(buildCatalog({ ...empty, plugins: [plugin] })[0]?.flags[0]?.text).toBe('leftover')
  })

  it('filters over the name and the kind word, and never over an id', () => {
    const catalog = buildCatalog({ ...empty, skills: [skill('run-kondo'), skill('hush')] })
    expect(filterCatalog(catalog, 'kondo', null).map((object) => object.name)).toEqual([
      'run-kondo'
    ])
    expect(filterCatalog(catalog, 'skill', null)).toHaveLength(2)
    expect(filterCatalog(catalog, '', 'plugin')).toHaveLength(0)
  })

  it('names the user store Global and prints an id it cannot resolve', () => {
    expect(scopeLabel(null, [])).toBe('Global')
    expect(scopeLabel('project:code:x', [])).toBe('project:code:x')
  })

  it('builds a key from the kind and the name, and nothing else', () => {
    expect(objectKey('skill', 'run-kondo')).toBe('skill run-kondo')
  })
})
