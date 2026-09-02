import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  healthyTranscript,
  flattenPath,
  makeWorld,
  registerProjects,
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
      'README.md': 'project file, off-limits'
    })
    await registerProjects(world, [workdir])
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

    const claudeDir = path.join(workdir, '.claude')
    const allowed = (target: string): boolean => {
      const inside = (root: string) => {
        const rel = path.relative(root, target)
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
      }
      return (
        inside(world.userRoot) ||
        inside(world.desktopRoot) ||
        // Kondo's own footprint: the journal and the trash (ADR-0001).
        inside(world.kondoDataRoot) ||
        // Claude's own registry, beside the user store (ADR-0009).
        target === world.locator.userConfigFile ||
        inside(claudeDir) ||
        target === workdir
      )
    }

    const touched = spies
      .flatMap((spy) => spy.mock.calls)
      .map((call) => call[0])
      .filter((argument): argument is string => typeof argument === 'string')
    expect(touched.length).toBeGreaterThan(0)
    for (const target of touched) {
      expect(allowed(target), `escaped the boundary: ${target}`).toBe(true)
    }
    expect(touched.some((target) => target.includes(path.join(workdir, 'src')))).toBe(false)
  })
})
