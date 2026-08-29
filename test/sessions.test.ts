import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { scanSessionInventory, toSessionProjects, toSessionSummaries } from '../electron/main/workspace/sessions'
import {
  healthyTranscript,
  makeWorld,
  UUID_A,
  UUID_B,
  UUID_C,
  writeFileTree,
  type FixtureWorld
} from './helpers'

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
      'memory/notes.md': 'project memory',
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
    expect(byUuid.get(UUID_A)?.hasSidecar).toBe(false)
    expect(byUuid.get(UUID_B)?.hasSidecar).toBe(true)

    expect(scan.unknown.some((entry) => entry.endsWith('stray.txt'))).toBe(true)
    expect(scan.unknown.some((entry) => entry.includes('memory'))).toBe(false)
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
