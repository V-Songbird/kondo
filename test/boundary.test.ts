import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createKindContext, kinds } from '../electron/main/workspace/kinds'
import { collector } from '../electron/main/workspace/scan'
import { scanSessionInventory } from '../electron/main/workspace/sessions'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  healthyTranscript,
  flattenPath,
  makeWorld,
  mcpServer,
  registerMcp,
  skillManifest,
  UUID_A,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The ADR-0002 boundary test: run every read API over a fixture world whose
 * verified project contains real files OUTSIDE .claude, recording every path
 * the workspace touches through node:fs/promises, and assert none escapes
 * the allowed roots. (Transcript streaming goes through node:fs
 * createReadStream, whose static import this spy cannot intercept; those
 * paths come from inventory records that are inside the user store by
 * construction.)
 */

describe('privacy boundary (ADR-0002)', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: {} }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill')
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ outputStyle: 'quiet' }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped'),
      'src/secret.ts': 'export const apiKey = "never-read-me"',
      'README.md': 'project file, off-limits',
      // Decoys at the project root: near-misses for the one file the
      // amendment names, and the instructions ADR-0002 keeps invisible.
      'CLAUDE.md': 'project instructions, off-limits',
      '.mcp.local.json': writeJson({ mcpServers: { sneaky: mcpServer() } })
    })
    await registerMcp(
      world,
      { mcpServers: { registry: mcpServer() }, projects: { [workdir]: {} } },
      { [workdir]: { mcpServers: { committed: mcpServer() } } }
    )
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('no read API touches a path outside the stores, ~/.claude.json and .claude', async () => {
    const spies = (['readdir', 'stat', 'readFile'] as const).map((method) =>
      vi.spyOn(fsp, method)
    )

    const projects = await api.sessionProjects()
    expect(projects.data[0]?.guessedPath).toBe(workdir)
    const sessions = await api.sessionList(projects.data[0]!.id)
    await api.sessionDetail(sessions.data[0]!.id)
    await api.storesOverview()
    await api.desktopSessions()
    await api.skillsList()
    await api.pluginsList()
    await api.hooksList()
    await api.settingsLayers()
    await api.journalList()
    await api.trashSize()

    // The mcp kind is the one listing that reaches outside a `.claude`
    // directory, so it runs inside the same recorded window. It has no API
    // method yet (entry 026 gives it one), so the registry is called direct.
    const c = collector()
    const inventory = (await scanSessionInventory(world.locator, process.platform)).data
    const servers = await kinds.mcp.discover(
      createKindContext({
        locator: world.locator,
        c,
        now: Date.now(),
        inventory: async () => inventory,
        projects: async () => [{ dirName: flattenPath(workdir), absPath: workdir }]
      })
    )
    expect(servers?.map((server) => server.name).sort()).toEqual(['committed', 'registry'])

    const claudeDir = path.join(workdir, '.claude')
    const within = (root: string, target: string): boolean => {
      const rel = path.relative(root, target)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    }
    const allowed = (target: string): boolean =>
      within(world.userRoot, target) ||
      within(world.desktopRoot, target) ||
      // Kondo's own footprint: the journal and the trash (ADR-0001).
      within(world.kondoDataRoot, target) ||
      // Claude's own registry, beside the user store (ADR-0009).
      target === world.locator.userConfigFile ||
      within(claudeDir, target) ||
      target === workdir ||
      // The single ADR-0002 amendment: project-scope MCP servers.
      target === path.join(workdir, '.mcp.json')

    const touched = spies
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call[0])
      .filter((argument): argument is string => typeof argument === 'string')
    expect(touched.length).toBeGreaterThan(0)
    for (const target of touched) {
      expect(allowed(target), `escaped the boundary: ${target}`).toBe(true)
    }
    expect(touched.some((target) => target.includes(path.join(workdir, 'src')))).toBe(false)

    // The pin. Everything touched outside a `.claude` directory and outside
    // kondo's own roots is exactly this list, asserted as a literal: the
    // project root (stat only), `~/.claude.json`, and `<project>/.mcp.json`.
    // Widening the boundary fails here rather than passing review — a new
    // read of `CLAUDE.md`, `package.json` or `.mcp.local.json` shows up as an
    // extra element and no amount of adding to `allowed` above hides it.
    const stores = [world.userRoot, world.desktopRoot, world.kondoDataRoot, claudeDir]
    const outside = [...new Set(touched)]
      .filter((target) => !stores.some((root) => within(root, target)))
      .sort()
    expect(outside).toEqual(
      [workdir, path.join(workdir, '.mcp.json'), world.locator.userConfigFile].sort()
    )
  })
})
