import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createLocator } from '../electron/main/workspace/locator'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  healthyTranscript,
  hashTree,
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
    expect(projects.errors).toEqual([])
    expect(project).not.toHaveProperty('guessedPath')
    expect(project).toMatchObject({
      id: `project:code:${flattenPath(workdir)}`,
      sources: ['registry', 'transcripts'],
      location: 'here',
      hasStore: true
    })
    const entities = await api.entityList('project')
    expect(entities.errors).toEqual([])
    expect(entities.data).toEqual(projects.data)
    for (const entity of entities.data) expect(entity).not.toHaveProperty('guessedPath')
    const row = (await api.projectsList()).data.find((candidate) => candidate.id === project.id)
    expect(row).toMatchObject({ name: 'proj', location: 'here', hasStore: true })
    const projectDetail = await api.projectDetail(project.id)
    expect(projectDetail.errors).toEqual([])
    expect(projectDetail.data?.row).toMatchObject({
      name: row!.name, parent: row!.parent, label: row!.label,
      location: 'here', hasStore: true, throwaway: row!.throwaway
    })

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

  it('previews exact session identities without writes and refuses changed bytes before journaling', async () => {
    const projectId = `project:code:${flattenPath(workdir)}`
    const sessions = (await api.sessionList(projectId)).data
    const ids = sessions.map((session) => session.id)
    const before = await hashTree(world.userRoot)
    const review = await api.sessionTrashPreview(ids)
    expect(review.errors).toEqual([])
    expect(review.data).toMatchObject({ count: 1, reviewToken: expect.any(String), sessions })
    expect(review.data!.reviewToken).not.toContain(world.base)
    expect(await hashTree(world.userRoot)).toBe(before)
    await expect(fs.readFile(path.join(world.kondoDataRoot, 'journal.jsonl')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    await fs.appendFile(path.join(world.userRoot, 'projects', flattenPath(workdir), `${UUID_A}.jsonl`),
      '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'resumed fixture conversation' } }))
    const changed = await hashTree(world.userRoot)
    const refused = await api.sessionTrash(ids, review.data!.reviewToken)
    expect(refused.data).toBeNull()
    expect(refused.errors.map((error) => error.code)).toContain('stale-plan')
    expect(await hashTree(world.userRoot)).toBe(changed)
    await expect(fs.readFile(path.join(world.kondoDataRoot, 'journal.jsonl')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an unknown session review identity without issuing a token', async () => {
    const review = await api.sessionTrashPreview(['session:code:../../../outside'])
    expect(review.data).toBeNull()
    expect(review.errors[0]?.code).toBe('unknown-id')
    expect((await api.journalList()).data).toEqual([])
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

describe('workspace first read without user data', () => {
  let world: FixtureWorld

  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => { await world.cleanup() })

  it.each([
    { state: 'absent', exists: false },
    { state: 'empty directory', exists: true }
  ])('keeps an $state user store honest and quiet', async ({ exists }) => {
    // makeWorld creates its user store. Use a new home so absence is real,
    // while the desktop, registry, app data and temporary roots stay injected.
    const home = path.join(world.base, 'fresh-home')
    await fs.mkdir(home)
    const locator = createLocator({
      home,
      appData: null,
      userData: world.kondoDataRoot,
      tmpRoot: world.base,
      platform: process.platform,
      env: { KONDO_DESKTOP_STORE_ROOT: world.desktopRoot }
    })
    expect(locator.userRoot).toBe(path.join(home, '.claude'))
    expect(locator.userConfigFile).toBe(path.join(home, '.claude.json'))
    await expect(fs.lstat(locator.userRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    if (exists) await fs.mkdir(locator.userRoot)
    const expectedHome = exists ? ['.claude'] : []
    expect(await fs.readdir(home)).toEqual(expectedHome)

    const freshWorkspace = (): KondoApi => createWorkspace({ locator, platform: process.platform })
    const overview = await freshWorkspace().storesOverview()
    expect(overview.errors).toEqual([])
    expect(overview.unknown).toEqual([])
    expect(overview.data.user).toEqual({ root: '~/.claude', exists, entries: [], totalBytes: 0 })
    expect(overview.data.sessions).toEqual({
      projectCount: 0,
      transcriptProjectCount: 0,
      sessionCount: 0,
      staleCount: 0,
      transcriptBytes: 0
    })

    // Each listing is the first call on its own workspace, with no inventory
    // warmed by the overview or another listing.
    for (const method of ['sessionProjects', 'skillsList', 'hooksList', 'configOrphansPreview'] as const) {
      expect(await freshWorkspace()[method](), method).toEqual({ data: [], errors: [], unknown: [] })
    }
    expect(await fs.readdir(home)).toEqual(expectedHome)
    if (exists) {
      expect(await fs.readdir(locator.userRoot)).toEqual([])
    } else {
      await expect(fs.lstat(locator.userRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
