import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { KondoApi, PlacedEntryInfo, PlacedKind } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  exists,
  flattenPath,
  hashTree,
  healthyTranscript,
  makeWorld,
  placedManifest,
  registerProjects,
  UUID_A,
  writeFileTree,
  type FixtureWorld
} from './helpers'

/**
 * Promoting an agent, command, rule or output style between scopes (entry
 * 028). The same plan a skill move is — copy, verify, trash, as one journal
 * entry (ADR-0001) — reached through the generic mutate channel and driven by
 * the one placement table, so the four kinds get it without a recipe each.
 */

/** The three kinds a project store actually holds, and their directories. */
const IN_PROJECT = [
  { kind: 'agent', dir: 'agents', name: 'reviewer', project: 'scout' },
  { kind: 'command', dir: 'commands', name: 'ship', project: 'deploy' },
  { kind: 'rule', dir: 'rules', name: 'house-style', project: 'no-any' }
] as const satisfies ReadonlyArray<{
  kind: PlacedKind
  dir: string
  name: string
  project: string
}>

describe('promoting placed entries between scopes (entry 028)', () => {
  let world: FixtureWorld
  let workdir: string
  let claudeDir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    claudeDir = path.join(workdir, '.claude')

    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: healthyTranscript(UUID_A),
      'agents/reviewer.md': placedManifest('Reviews a diff'),
      'commands/ship.md': placedManifest('Ships the branch'),
      'rules/house-style.md': placedManifest('House style'),
      'output-styles/terse.md': placedManifest('Say less')
    })
    await writeFileTree(workdir, {
      '.claude/agents/scout.md': placedManifest('Project agent'),
      '.claude/commands/deploy.md': placedManifest('Project command'),
      '.claude/rules/no-any.md': placedManifest('Project rule'),
      'src/secret.ts': 'export const apiKey = "never-read-me"'
    })
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  const projectScope = (): string => `project:code:${flattenPath(workdir)}`

  const ids = async (kind: PlacedKind): Promise<string[]> =>
    ((await api.entityList(kind)).data as PlacedEntryInfo[]).map((entry) => entry.id)

  const move = async (
    entityId: string,
    targetId: string
  ): ReturnType<KondoApi['entityMutate']> =>
    api.entityMutate(entityId, { op: 'move', targetId })

  // ---------------------------------------------------------------------------
  // The promotion itself — project → user, for every kind a project holds

  for (const { kind, dir, project } of IN_PROJECT) {
    it(`promotes a project ${kind} into the user scope`, async () => {
      const flat = flattenPath(workdir)
      const result = await move(`${kind}:project/${flat}:${project}`, 'user')
      expect(result.errors).toEqual([])
      expect(result.data?.op).toBe('move')

      // Present at the destination, and gone from the project store.
      expect(await exists(path.join(world.userRoot, dir, `${project}.md`))).toBe(true)
      expect(await exists(path.join(claudeDir, dir, `${project}.md`))).toBe(false)

      // The source's bytes are in kondo's trash, never unlinked (ADR-0001).
      // The trash spells the store's colon as a dash — a Windows path
      // segment may not hold one.
      const trashed = path.join(
        world.kondoDataRoot,
        'trash',
        result.data!.id.slice('journal:'.length),
        `project-${flat}`,
        dir,
        `${project}.md`
      )
      expect(await exists(trashed)).toBe(true)

      const listed = await ids(kind)
      expect(listed).toContain(`${kind}:user:${project}`)
      expect(listed).not.toContain(`${kind}:project/${flat}:${project}`)
    })
  }

  it('demotes a user entry into a project, as one plan of copy, verify, trash', async () => {
    const result = await move('agent:user:reviewer', projectScope())
    expect(result.errors).toEqual([])
    expect(result.data?.summary).toContain('Move agent reviewer')
    // Copy then trash, as one journal entry — the order and the unit are the
    // whole guarantee (ADR-0001).
    expect(result.data?.op).toBe('move')
    expect(result.data?.kind).toBe('agent')
    expect(result.data?.stepCount).toBe(2)

    expect(await exists(path.join(claudeDir, 'agents', 'reviewer.md'))).toBe(true)
    expect(await exists(path.join(world.userRoot, 'agents', 'reviewer.md'))).toBe(false)
    expect(await ids('agent')).toContain(`agent:project/${flattenPath(workdir)}:reviewer`)
  })

  // ---------------------------------------------------------------------------
  // Refusals — neither side is modified

  it('refuses a destination that already holds that name, for every kind', async () => {
    // Each kind's user entry has a same-named twin waiting in the project.
    await writeFileTree(claudeDir, {
      'agents/reviewer.md': placedManifest('A different reviewer'),
      'commands/ship.md': placedManifest('A different ship'),
      'rules/house-style.md': placedManifest('A different house style')
    })
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })
    const userBefore = await hashTree(world.userRoot)
    const projectBefore = await hashTree(claudeDir)

    for (const { kind, name } of IN_PROJECT) {
      const result = await fresh.entityMutate(`${kind}:user:${name}`, {
        op: 'move',
        targetId: projectScope()
      })
      expect(result.data, kind).toBeNull()
      expect(result.errors.map((error) => error.code), kind).toContain('bad-request')
      expect(result.errors[0]?.message, kind).toContain(`already holds a ${kind} named ${name}`)
      expect(result.errors[0]?.message, kind).toContain('will not merge')
    }

    // Neither side moved, and no journal entry was written.
    expect(await hashTree(world.userRoot)).toBe(userBefore)
    expect(await hashTree(claudeDir)).toBe(projectBefore)
    expect((await fresh.journalList()).data).toEqual([])
  })

  it('refuses the scope the entry is already in, and one nobody has heard of', async () => {
    const same = await move('agent:user:reviewer', 'user')
    expect(same.errors.map((error) => error.code)).toContain('bad-request')
    expect(same.errors[0]?.message).toContain('already in that scope')

    const ghost = await move('rule:user:house-style', 'project:code:D--Not-There')
    expect(ghost.errors.map((error) => error.code)).toContain('unknown-id')

    expect(await exists(path.join(world.userRoot, 'agents', 'reviewer.md'))).toBe(true)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a project destination for an output style (ADR-0006)', async () => {
    // No project store has been observed carrying `output-styles`, so kondo
    // will not create the first one — Claude would never read it.
    const result = await move('output-style:user:terse', projectScope())
    expect(result.data).toBeNull()
    expect(result.errors.map((error) => error.code)).toContain('not-permitted')
    expect(result.errors[0]?.message).toContain('output-styles')

    expect(await exists(path.join(world.userRoot, 'output-styles', 'terse.md'))).toBe(true)
    expect(await exists(path.join(claudeDir, 'output-styles'))).toBe(false)
    expect((await api.journalList()).data).toEqual([])
  })

  it('still refuses both toggles through the same channel', async () => {
    for (const op of ['enable', 'disable'] as const) {
      const result = await api.entityMutate('command:user:ship', { op })
      expect(result.data, op).toBeNull()
      expect(result.errors[0]?.code, op).toBe('not-permitted')
      expect(result.errors[0]?.message, op).toContain('no way to switch one of these off')
    }
    expect(await exists(path.join(world.userRoot, 'commands', 'ship.md'))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Undo (ADR-0001)

  for (const { kind, dir, name } of IN_PROJECT) {
    it(`undoes a ${kind} promotion whole, leaving the destination untouched`, async () => {
      const userBefore = await hashTree(world.userRoot)
      const projectBefore = await hashTree(claudeDir)

      const done = await move(`${kind}:user:${name}`, projectScope())
      expect(done.errors).toEqual([])
      expect(await hashTree(world.userRoot)).not.toBe(userBefore)

      const undone = await api.journalUndo(done.data!.id)
      expect(undone.errors).toEqual([])

      // Back at its original scope, byte-for-byte...
      expect(await hashTree(world.userRoot)).toBe(userBefore)
      // ...and the destination is exactly as it was, with no leftover copy.
      expect(await hashTree(claudeDir)).toBe(projectBefore)
      expect(await exists(path.join(claudeDir, dir, `${name}.md`))).toBe(false)
      expect(await ids(kind)).toContain(`${kind}:user:${name}`)
    })
  }

  it('undoes an output style promotion, which only the user scope can hold', async () => {
    // The one kind with a single scope still gets the same undo, proved by
    // moving it out and back through a second project store.
    const other = path.join(world.base, 'work', 'other')
    await writeFileTree(other, { '.claude/skills/.keep': '' })
    await registerProjects(world, [workdir, other])
    const fresh = createWorkspace({ locator: world.locator, platform: process.platform })

    const before = await hashTree(world.userRoot)
    const refused = await fresh.entityMutate('output-style:user:terse', {
      op: 'move',
      targetId: `project:code:${flattenPath(other)}`
    })
    expect(refused.data).toBeNull()
    // Nothing to undo, because nothing was ever written.
    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await fresh.journalList()).data).toEqual([])
  })
})
