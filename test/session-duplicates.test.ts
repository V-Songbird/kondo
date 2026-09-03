import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, SessionDuplicateGroup, SessionSummary } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { openScanCache } from '../electron/main/workspace/scan-cache'
import {
  exists,
  flattenPath,
  hashTree,
  makeWorld,
  registerProjects,
  transcriptLine,
  UUID_A,
  UUID_B,
  UUID_C,
  writeFileTree,
  type FixtureWorld
} from './helpers'

/**
 * Duplicate sessions (entry 034), which is two features wearing one word.
 *
 * The same session id in two stores is tier-1: a join over listings kondo
 * already makes. The same opening prompt inside one project is tier-2, and
 * everything asserted about it here is about what it does NOT read — one
 * project rather than the store, the head of a transcript rather than the
 * file, and nothing at all for a session whose size and mtime have not moved
 * (ADR-0007). The trash below is one plan for the whole selection, undone as
 * a unit (ADR-0001).
 */

const UUID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const UUID_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

/** Same length as REWRITTEN, so a rewrite can hold the file's size still. */
const SHARED = 'refactor the transcript reader'
const REWRITTEN = 'rewrite the plugin installer!!'
/** The same request, restated. Different bytes, same normalized signature. */
const RESTATED = '  Refactor, the  TRANSCRIPT reader!  '
/** Set by hand so a rewrite can put the mtime back on exactly its old value. */
const PINNED = new Date(1_780_000_000_000)

/** A transcript whose opening is exactly `prompt`. */
function opening(prompt: string): string {
  return (
    transcriptLine({ type: 'summary', leafUuid: 'leaf', sessionId: UUID_A }) +
    transcriptLine({
      type: 'user',
      timestamp: '2026-01-01T10:00:00.000Z',
      message: { role: 'user', content: prompt }
    }) +
    transcriptLine({
      type: 'assistant',
      timestamp: '2026-01-01T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'sure' }] }
    })
  )
}

describe('sessions mirrored across stores', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: opening('one'),
      [`projects/${flattenPath(workdir)}/${UUID_B}.jsonl`]: opening('two')
    })
    // The desktop store holds one of the two under its own naming: the same
    // uuid, wrapped in `local_<uuid>.json` (domain.md).
    await writeFileTree(world.desktopRoot, {
      [`local-agent-mode-sessions/device-1/account-1/local_${UUID_A}.json`]: '{}',
      // A desktop session of its own, matching nothing in the code store.
      [`local-agent-mode-sessions/device-1/account-1/local_${UUID_E}.json`]: '{}'
    })
    await registerProjects(world, [workdir])
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const sessions = async (): Promise<SessionSummary[]> => {
    const scan = await api.sessionList(`project:code:${flattenPath(workdir)}`)
    expect(scan.errors).toEqual([])
    return scan.data
  }

  it('names the other store on a session both stores hold', async () => {
    const found = await sessions()
    const mirrored = found.find((session) => session.uuid === UUID_A)
    expect(mirrored?.mirroredIn).toBe('desktop')
  })

  it('leaves mirroredIn null for a session only the code store has', async () => {
    const found = await sessions()
    expect(found.find((session) => session.uuid === UUID_B)?.mirroredIn).toBeNull()
  })

  it('opens no transcript to say so — the join is two listings (ADR-0007)', async () => {
    const readFile = vi.spyOn(fs, 'readFile')
    await sessions()
    const opened = readFile.mock.calls.map((call) => String(call[0]))
    expect(opened.some((target) => target.endsWith('.jsonl'))).toBe(false)
    expect(opened.some((target) => target.endsWith('.json') && target.includes('local_'))).toBe(
      false
    )
  })

  it('carries the flag through the project page as well', async () => {
    const detail = await api.projectDetail(`project:code:${flattenPath(workdir)}`)
    expect(detail.data?.sessions.find((session) => session.uuid === UUID_A)?.mirroredIn).toBe(
      'desktop'
    )
  })
})

describe('near-identical opening prompts within one project', () => {
  let world: FixtureWorld
  let workdir: string
  let otherdir: string
  let api: KondoApi

  const projectId = (): string => `project:code:${flattenPath(workdir)}`
  const transcript = (uuid: string): string =>
    path.join(world.userRoot, 'projects', flattenPath(workdir), `${uuid}.jsonl`)

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    otherdir = path.join(world.base, 'work', 'other')
    await writeFileTree(world.userRoot, {
      // Two sessions of the same work restarted: the punctuation and case
      // differ, the request does not.
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: opening(SHARED),
      [`projects/${flattenPath(workdir)}/${UUID_B}.jsonl`]: opening(RESTATED),
      // A different request entirely.
      [`projects/${flattenPath(workdir)}/${UUID_C}.jsonl`]: opening('ship the release notes'),
      // Two sessions opening with a word too short to be evidence.
      [`projects/${flattenPath(workdir)}/${UUID_D}.jsonl`]: opening('ok'),
      [`projects/${flattenPath(workdir)}/${UUID_E}.jsonl`]: opening('ok'),
      // Another project, with a duplicate pair of its own that this call
      // must never see.
      [`projects/${flattenPath(otherdir)}/${UUID_A}.jsonl`]: opening('audit the settings layers'),
      [`projects/${flattenPath(otherdir)}/${UUID_B}.jsonl`]: opening('audit the settings layers')
    })
    await registerProjects(world, [workdir, otherdir])
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  const groups = async (): Promise<SessionDuplicateGroup[]> => {
    const scan = await api.sessionNearDuplicates(projectId())
    expect(scan.errors).toEqual([])
    return scan.data
  }

  it('groups two sessions that open the same way once normalized', async () => {
    const found = await groups()
    expect(found).toHaveLength(1)
    expect(found[0]?.members.map((member) => member.uuid).sort()).toEqual(
      [UUID_A, UUID_B].sort()
    )
    // The prompt shown is a member's opening as it was written — never the
    // normalized key the grouping actually ran on.
    expect([SHARED, RESTATED]).toContain(found[0]?.prompt)
  })

  it('leaves out a lone opening and an opening too short to mean anything', async () => {
    const grouped = (await groups()).flatMap((group) =>
      group.members.map((member) => member.uuid)
    )
    expect(grouped).not.toContain(UUID_C)
    // Both of these open with "ok". Two of them is still not evidence.
    expect(grouped).not.toContain(UUID_D)
    expect(grouped).not.toContain(UUID_E)
  })

  it('reads only the project it was given', async () => {
    const found = await groups()
    // The other project has a duplicate pair of its own; a store-wide pass
    // would have returned it.
    expect(found).toHaveLength(1)
    for (const member of found[0]?.members ?? []) {
      expect(member.projectId).toBe(projectId())
    }
    // And the proof in kondo's own cache: only this project's transcripts
    // were ever opened.
    const cached = JSON.parse(
      await fs.readFile(
        path.join(world.kondoDataRoot, 'scan-cache', 'first-prompt.json'),
        'utf8'
      )
    ) as { entries: Record<string, unknown> }
    const keys = Object.keys(cached.entries)
    expect(keys).toHaveLength(5)
    expect(keys.some((key) => key.includes(flattenPath(otherdir)))).toBe(false)
  })

  it('refuses an id that is not a project', async () => {
    const bad = await api.sessionNearDuplicates('session:code:whatever/x')
    expect(bad.data).toEqual([])
    expect(bad.errors[0]?.code).toBe('bad-request')
  })

  it('skips a transcript it cannot parse rather than failing the scan (ADR-0005)', async () => {
    await fs.writeFile(transcript(UUID_C), 'not json at all\n{"type":"user"\n', 'utf8')
    const scan = await api.sessionNearDuplicates(projectId())
    // Unparseable lines cost that session its opening and cost the rest
    // nothing: the pair still groups, and no error is raised for a file that
    // was readable but held nothing kondo understood.
    expect(scan.errors).toEqual([])
    expect(scan.data).toHaveLength(1)
  })

  it('hits the cache while size and mtime hold, and misses once one moves', async () => {
    // Pinned by hand, so the rewrite below can put the mtime back on exactly
    // the value the first read cached rather than one a millisecond off.
    await fs.utimes(transcript(UUID_A), PINNED, PINNED)
    const before = await fs.stat(transcript(UUID_A))
    await api.sessionProjects(true)
    expect(await groups()).toHaveLength(1)

    // Rewrite one member's opening WITHOUT moving either half of the key:
    // same byte length, same mtime.
    await fs.writeFile(transcript(UUID_A), opening(REWRITTEN), 'utf8')
    await fs.utimes(transcript(UUID_A), PINNED, PINNED)
    expect(
      (await fs.stat(transcript(UUID_A))).size,
      'the rewrite must not change the size'
    ).toBe(before.size)

    // A fresh inventory, so a miss cannot be hidden by the tier-1 cache.
    await api.sessionProjects(true)
    // Still grouped: the key did not move, so the transcript was not re-read
    // and what the cache remembers is what the answer is built from.
    expect(await groups()).toHaveLength(1)

    // Now move the mtime alone. Same bytes as the rewrite, new key.
    const moved = new Date(PINNED.getTime() + 60_000)
    await fs.utimes(transcript(UUID_A), moved, moved)
    await api.sessionProjects(true)
    // Re-read, and the two no longer open the same way.
    expect(await groups()).toEqual([])
  })
})

describe('the scan cache itself (ADR-0007)', () => {
  let world: FixtureWorld
  let file: string

  beforeEach(async () => {
    world = await makeWorld()
    file = path.join(world.base, 'a-transcript.jsonl')
    await fs.writeFile(file, opening(SHARED), 'utf8')
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('survives the process it was written in', async () => {
    const info = await fs.stat(file)
    const first = await openScanCache<{ prompt: string }>(world.kondoDataRoot, 'probe')
    first.set(file, info.size, info.mtimeMs, { prompt: SHARED })
    await first.save()

    const second = await openScanCache<{ prompt: string }>(world.kondoDataRoot, 'probe')
    expect(second.get(file, info.size, info.mtimeMs)?.prompt).toBe(SHARED)
  })

  it('misses when either half of the key moved', async () => {
    const info = await fs.stat(file)
    const cache = await openScanCache<{ prompt: string }>(world.kondoDataRoot, 'probe')
    cache.set(file, info.size, info.mtimeMs, { prompt: SHARED })
    expect(cache.get(file, info.size + 1, info.mtimeMs)).toBeNull()
    expect(cache.get(file, info.size, info.mtimeMs + 1)).toBeNull()
    expect(cache.get(path.join(world.base, 'elsewhere.jsonl'), info.size, info.mtimeMs)).toBeNull()
  })

  it('starts empty on a file it cannot parse rather than throwing', async () => {
    const cacheFile = path.join(world.kondoDataRoot, 'scan-cache', 'probe.json')
    await fs.mkdir(path.dirname(cacheFile), { recursive: true })
    await fs.writeFile(cacheFile, '{ this is not json', 'utf8')
    const info = await fs.stat(file)
    const cache = await openScanCache<{ prompt: string }>(world.kondoDataRoot, 'probe')
    expect(cache.get(file, info.size, info.mtimeMs)).toBeNull()
  })

  it('writes nothing when nothing was cached', async () => {
    const cache = await openScanCache<{ prompt: string }>(world.kondoDataRoot, 'probe')
    await cache.save()
    expect(await exists(path.join(world.kondoDataRoot, 'scan-cache'))).toBe(false)
  })
})

describe('trashing a chosen set of sessions (ADR-0001)', () => {
  let world: FixtureWorld
  let workdir: string
  let api: KondoApi

  const sessionId = (uuid: string): string => `session:code:${flattenPath(workdir)}/${uuid}`

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    await writeFileTree(world.userRoot, {
      [`projects/${flattenPath(workdir)}/${UUID_A}.jsonl`]: opening(SHARED),
      // A sidecar directory: session state that must ride along, or it is
      // tomorrow's orphan.
      [`projects/${flattenPath(workdir)}/${UUID_A}/state.json`]: '{"tool":"state"}',
      [`projects/${flattenPath(workdir)}/${UUID_B}.jsonl`]: opening(SHARED),
      [`projects/${flattenPath(workdir)}/${UUID_C}.jsonl`]: opening('keep me')
    })
    await registerProjects(world, [workdir])
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('is one journal entry for the whole selection, and undo restores all of it', async () => {
    const before = await hashTree(world.userRoot)

    const done = await api.sessionTrash([sessionId(UUID_A), sessionId(UUID_B)])
    expect(done.errors).toEqual([])
    expect(done.data?.op).toBe('trash')
    // Two transcripts and the one sidecar, in a single entry.
    expect(done.data?.stepCount).toBe(3)
    const root = path.join(world.userRoot, 'projects', flattenPath(workdir))
    expect(await exists(path.join(root, `${UUID_A}.jsonl`))).toBe(false)
    expect(await exists(path.join(root, UUID_A))).toBe(false)
    expect(await exists(path.join(root, `${UUID_B}.jsonl`))).toBe(false)
    // The one that was not picked is untouched.
    expect(await exists(path.join(root, `${UUID_C}.jsonl`))).toBe(true)
    // Nothing was unlinked — the bytes are in kondo's trash.
    expect((await api.trashSize()).data.bytes).toBeGreaterThan(0)

    const undone = await api.journalUndo(done.data?.id as string)
    expect(undone.errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('names the one session when only one was picked', async () => {
    const done = await api.sessionTrash([sessionId(UUID_C)])
    expect(done.errors).toEqual([])
    expect(done.data?.kind).toBe('session')
    expect(done.data?.entityId).toBe(sessionId(UUID_C))
    expect(done.data?.stepCount).toBe(1)
  })

  it('refuses the whole set when one id no longer resolves', async () => {
    const before = await hashTree(world.userRoot)
    const refusal = await api.sessionTrash([sessionId(UUID_A), sessionId(UUID_D)])
    expect(refusal.data).toBeNull()
    expect(refusal.errors[0]?.code).toBe('unknown-id')
    // Not one byte moved, and no entry promising an undo that never happened.
    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a desktop session in the matrix’s own words (ADR-0006)', async () => {
    const refusal = await api.sessionTrash(['session:desktop:device-1/account-1/x'])
    expect(refusal.data).toBeNull()
    expect(refusal.errors[0]?.code).toBe('not-permitted')
    expect(refusal.errors[0]?.message).toMatch(/stays where it is/)
  })

  it('writes no entry for an empty selection', async () => {
    const nothing = await api.sessionTrash([])
    expect(nothing.errors).toEqual([])
    expect(nothing.data).toBeNull()
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a request that is not a list of ids', async () => {
    const bad = await api.sessionTrash('session:code:x/y' as never)
    expect(bad.errors[0]?.code).toBe('bad-request')
  })

  it('displaces a session named twice exactly once', async () => {
    const done = await api.sessionTrash([sessionId(UUID_C), sessionId(UUID_C)])
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(1)
  })
})
