import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
 * Integration through the public KondoApi surface — the same calls the IPC
 * layer delegates to, run against a fixture world.
 */

describe('workspace (KondoApi)', () => {
  let world: FixtureWorld
  let api: KondoApi
  let workdir: string

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    const flattened = flattenPath(workdir)

    await writeFileTree(world.userRoot, {
      [`projects/${flattened}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'settings.json': writeJson({ enabledPlugins: {} }),
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill')
    })
    await writeFileTree(workdir, {
      '.claude/settings.json': writeJson({ outputStyle: 'quiet' }),
      '.claude/skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Project-scoped')
    })

    // The registry names the project whatever the tmpdir looks like (ADR-0009),
    // so the real stat does the verifying here — no injected probe.
    await registerProjects(world, [workdir])
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('lists projects and sessions by id, and streams a session detail', async () => {
    const projects = await api.sessionProjects()
    expect(projects.data).toHaveLength(1)
    const project = projects.data[0]!
    expect(project.guessedPath).toBe(workdir)

    const sessions = await api.sessionList(project.id)
    expect(sessions.errors).toEqual([])
    expect(sessions.data).toHaveLength(1)

    const detail = await api.sessionDetail(sessions.data[0]!.id)
    expect(detail.errors).toEqual([])
    expect(detail.data?.messageCount).toBe(3)
    expect(detail.data?.firstUserPrompt).toBe('hello kondo')
  })

  it('rejects malformed and unknown ids with typed errors, never throwing', async () => {
    const bad = await api.sessionList('not-an-id')
    expect(bad.errors[0]?.code).toBe('bad-request')

    const probe = await api.sessionDetail('session:code:../../../etc/passwd')
    expect(probe.data).toBeNull()
    expect(probe.errors[0]?.code).toBe('unknown-id')

    const gone = await api.sessionList('project:code:D--Not-There')
    expect(gone.errors[0]?.code).toBe('unknown-id')
  })

  it('surfaces skills and settings from the verified project', async () => {
    const skills = await api.skillsList()
    const ids = skills.data.map((skill) => skill.id)
    expect(ids).toContain('skill:user:alpha-skill')
    expect(ids.some((id) => id.endsWith(':delta-skill'))).toBe(true)

    const layers = await api.settingsLayers()
    const project = layers.data.find((layer) => layer.layer === 'project')
    expect(project?.exists).toBe(true)
    expect(project?.keys).toContain('outputStyle')
  })

  it('exposes an empty journal and trash before anything has been written', async () => {
    const journal = await api.journalList()
    expect(journal.errors).toEqual([])
    expect(journal.data).toEqual([])

    const trash = await api.trashSize()
    expect(trash.errors).toEqual([])
    expect(trash.data.bytes).toBe(0)
    expect(trash.data.entryCount).toBe(0)
    expect(trash.data.root.endsWith('trash')).toBe(true)
  })

  it('keeps appearance preferences separate from Claude settings and the journal', async () => {
    expect((await api.appearanceGet()).data.theme).toBe('chalk')
    expect(await api.appearanceSet('carbon')).toEqual({ data: { theme: 'carbon' }, errors: [], unknown: [] })
    expect((await api.appearanceGet()).data.theme).toBe('carbon')
    expect((await api.journalList()).data).toEqual([])
    const layers = await api.settingsLayers()
    expect(layers.data.every((layer) => !layer.keys.includes('theme'))).toBe(true)
  })

  it('refuses an undo id that is not a journal id', async () => {
    const bad = await api.journalUndo('skill:user:alpha-skill')
    expect(bad.data).toBeNull()
    expect(bad.errors[0]?.code).toBe('bad-request')
  })

  it('summarizes both stores in the overview', async () => {
    const overview = await api.storesOverview()
    expect(overview.data.sessions.projectCount).toBe(1)
    // Every member of this store's union has a transcript, so the two
    // project figures agree — the other half of the pair in projects-home.
    expect(overview.data.sessions.transcriptProjectCount).toBe(1)
    expect(overview.data.sessions.sessionCount).toBe(1)
    expect(overview.data.sessions.transcriptBytes).toBeGreaterThan(0)
    expect(overview.data.user.exists).toBe(true)
    expect(overview.data.user.entries.some((entry) => entry.name === 'skills')).toBe(true)
    expect(overview.data.desktop.exists).toBe(true)
  })
})
