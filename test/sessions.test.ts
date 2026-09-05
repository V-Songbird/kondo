import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { scanSessionInventory, toSessionProjects, toSessionSummaries } from '../electron/main/workspace/sessions'
import { flattenProjectPath } from '../electron/main/workspace/projects'
import {
  desktopReleased,
  healthyTranscript,
  makeWorld,
  registerProjects,
  UUID_A,
  UUID_B,
  UUID_C,
  writeFileTree,
  type FixtureWorld
} from './helpers'

const UUID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const NOW = Date.parse('2026-03-01T00:00:00.000Z')
const OLD = new Date('2025-11-01T00:00:00.000Z')

describe('scanSessionInventory', () => {
  let world: FixtureWorld
  beforeEach(async () => {
    world = await makeWorld()
    const project = path.join(world.userRoot, 'projects', 'D--Projects-app')
    await writeFileTree(project, {
      [`${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      [`${UUID_B}.jsonl`]: '',
      [`${UUID_B}/tool-state.json`]: '{}',
      [`${UUID_C}/leftover.txt`]: 'orphaned sidecar',
      // The desktop app released UUID_A; UUID_D's marker outlived its transcript.
      [`${UUID_A}.desktop-released.json`]: desktopReleased(),
      [`${UUID_D}.desktop-released.json`]: desktopReleased(),
      'memory/notes.md': 'project memory',
      '.benchmarks/razor-vs-ponytail/runs/20260705-231056/result.json': '{}',
      'stray.txt': 'what is this'
    })
    // UUID_A is old enough to be stale; UUID_B is fresh.
    await fs.utimes(path.join(project, `${UUID_A}.jsonl`), OLD, OLD)
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('inventories transcripts, sidecars, orphans, and unknown entries', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform, async () => false)
    expect(scan.errors).toEqual([])
    expect(scan.data.projects).toHaveLength(1)

    const project = scan.data.projects[0]!
    expect(project.dirName).toBe('D--Projects-app')
    expect(project.guessedPath).toBeNull()
    expect(project.sessions).toHaveLength(2)
    expect(project.orphanDirs).toEqual([UUID_C])

    const byUuid = new Map(project.sessions.map((session) => [session.uuid, session]))
    // The sidecar's real directory name, not a flag: the sweep has to
    // displace that exact directory, and the match that found it ignores case.
    expect(byUuid.get(UUID_A)?.sidecar).toBeNull()
    expect(byUuid.get(UUID_B)?.sidecar).toBe(UUID_B)

    expect(scan.unknown.some((entry) => entry.endsWith('stray.txt'))).toBe(true)
    expect(scan.unknown.some((entry) => entry.includes('memory'))).toBe(false)
    // Claude-written entries kondo knows about are never reported as unknown.
    expect(scan.unknown.some((entry) => entry.includes('.benchmarks'))).toBe(false)
    expect(scan.unknown.some((entry) => entry.includes('desktop-released'))).toBe(false)
    expect(project.hasMemory).toBe(true)
  })

  it('attaches the desktop app’s released marker to its session, and orphans one without (entry 059)', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform, async () => false)
    const project = scan.data.projects[0]!
    const byUuid = new Map(project.sessions.map((session) => [session.uuid, session]))
    expect(byUuid.get(UUID_A)?.released).toBe(`${UUID_A}.desktop-released.json`)
    expect(byUuid.get(UUID_B)?.released).toBeNull()
    expect(project.orphanMarkers).toEqual([`${UUID_D}.desktop-released.json`])

    const summaries = toSessionSummaries(project, Date.now(), new Set())
    expect(summaries.find((s) => s.uuid === UUID_A)?.releasedByDesktop).toBe(true)
    expect(summaries.find((s) => s.uuid === UUID_B)?.releasedByDesktop).toBe(false)
  })

  it('projects the inventory into contract shapes with staleness', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform, async () => false)
    const projects = toSessionProjects(scan.data, NOW)
    expect(projects[0]!.id).toBe('project:code:D--Projects-app')
    expect(projects[0]!.sessionCount).toBe(2)
    expect(projects[0]!.staleCount).toBe(1)
    expect(projects[0]!.orphanCount).toBe(1)
    expect(projects[0]!.transcriptBytes).toBeGreaterThan(0)

    const summaries = toSessionSummaries(scan.data.projects[0]!, NOW)
    const stale = summaries.find((session) => session.uuid === UUID_A)
    expect(stale?.stale).toBe(true)
    expect(stale?.id).toBe(`session:code:D--Projects-app/${UUID_A}`)
  })

  it('names a hyphenated project through ~/.claude.json and stats only that path', async () => {
    const workdir = path.join(world.base, 'work', 'my-app')
    await fs.mkdir(workdir, { recursive: true })
    await writeFileTree(path.join(world.userRoot, 'projects', flattenProjectPath(workdir)), {
      [`${UUID_A}.jsonl`]: healthyTranscript(UUID_A)
    })
    await registerProjects(world, [workdir])

    const probed: string[] = []
    const scan = await scanSessionInventory(world.locator, process.platform, async (target) => {
      probed.push(target)
      return target === workdir
    })
    const project = scan.data.projects.find((p) => p.dirName === flattenProjectPath(workdir))
    expect(project?.guessedPath).toBe(workdir)
    expect(probed).toContain(workdir)
  })

  it('marks a transcripts-only project, with no path and no store behind it', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform, async () => false)
    const project = scan.data.projects[0]!
    expect(project.sources).toEqual(['transcripts'])
    // Unlocated and not gone: no registry key named it and the guess never
    // verified, which says nothing about whether the folder still exists.
    expect(project.location).toBe('unlocated')
    expect(project.hasStore).toBe(false)
  })

  it('returns an empty inventory for a store with no projects directory', async () => {
    const empty = await makeWorld()
    try {
      const scan = await scanSessionInventory(empty.locator, process.platform, async () => false)
      expect(scan.data.projects).toEqual([])
      expect(scan.errors).toEqual([])
    } finally {
      await empty.cleanup()
    }
  })
})

describe('the project set is the union of the registry and projects/', () => {
  let world: FixtureWorld
  let withStore: string
  let deleted: string

  beforeEach(async () => {
    world = await makeWorld()
    // Three members, one per way of being a project: a registry key with a
    // store and no transcripts, a registry key whose directory is gone, and a
    // transcripts directory the registry has never heard of.
    withStore = path.join(world.base, 'work', 'registered')
    deleted = path.join(world.base, 'work', 'deleted')
    await writeFileTree(withStore, { '.claude/settings.json': '{}' })
    await registerProjects(world, [withStore, deleted])
    await writeFileTree(path.join(world.userRoot, 'projects', 'not-a-flattened-root'), {
      [`${UUID_A}.jsonl`]: healthyTranscript(UUID_A)
    })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('lists a registry key with no transcripts, and says where it came from', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform)
    expect(scan.errors).toEqual([])
    expect(scan.data.projects.map((project) => project.dirName).sort()).toEqual(
      [
        flattenProjectPath(deleted),
        flattenProjectPath(withStore),
        'not-a-flattened-root'
      ].sort()
    )

    const registered = scan.data.byDirName.get(flattenProjectPath(withStore))!
    expect(registered.sources).toEqual(['registry'])
    expect(registered.sessions).toEqual([])
    expect(registered.guessedPath).toBe(path.normalize(withStore))
    expect(registered.location).toBe('here')
    // A registry key with a `.claude` is a store kondo can write into, even
    // with no transcripts to its name.
    expect(registered.hasStore).toBe(true)
  })

  it('keeps a registry key whose directory is gone, with nothing behind it', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform)
    const dead = scan.data.byDirName.get(flattenProjectPath(deleted))!
    // The key IS the path (ADR-0009), so it survives the missing directory —
    // that is the whole dead-project signal.
    expect(dead.guessedPath).toBe(path.normalize(deleted))
    expect(dead.location).toBe('gone')
    expect(dead.hasStore).toBe(false)
    expect(dead.sources).toEqual(['registry'])
  })

  it('names both sources when a project is in the registry and on disk', async () => {
    await writeFileTree(
      path.join(world.userRoot, 'projects', flattenProjectPath(withStore)),
      { [`${UUID_A}.jsonl`]: healthyTranscript(UUID_A) }
    )
    const scan = await scanSessionInventory(world.locator, process.platform)
    const both = scan.data.byDirName.get(flattenProjectPath(withStore))!
    expect(both.sources).toEqual(['registry', 'transcripts'])
    expect(both.sessions).toHaveLength(1)
    expect(both.hasStore).toBe(true)
    // Counted once: the union joins on the flattened path, it does not double.
    expect(
      scan.data.projects.filter(
        (project) => project.dirName === flattenProjectPath(withStore)
      )
    ).toHaveLength(1)
  })

  it('projects the union into contract shapes with its attribution intact', async () => {
    const scan = await scanSessionInventory(world.locator, process.platform)
    const projects = toSessionProjects(scan.data, Date.parse('2026-03-01T00:00:00.000Z'))
    const registered = projects.find(
      (project) => project.dirName === flattenProjectPath(withStore)
    )!
    expect(registered.id).toBe(`project:code:${flattenProjectPath(withStore)}`)
    expect(registered.hasStore).toBe(true)
    expect(registered.location).toBe('here')
    expect(registered.sources).toEqual(['registry'])
    expect(registered.sessionCount).toBe(0)
  })
})
