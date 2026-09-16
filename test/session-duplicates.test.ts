import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  JournalEntryInfo,
  KondoApi,
  SessionDuplicateGroup,
  SessionSummary
} from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { openScanCache } from '../electron/main/workspace/scan-cache'
import {
  desktopReleased,
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

async function reviewedSessionTrash(api: KondoApi, ids: string[]) {
  const review = await api.sessionTrashPreview(ids)
  return api.sessionTrash(ids, review.data?.reviewToken)
}

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

    const done = await reviewedSessionTrash(api, [sessionId(UUID_A), sessionId(UUID_B)])
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

  // Entry 073, and the reason it is a blocker: a transcript is a file, and
  // renaming a file over a file replaces it without a word. Claude writing
  // at the same uuid between the sweep and the undo is the ordinary case.
  it('keeps a transcript written at the same uuid after the trash', async () => {
    const root = path.join(world.userRoot, 'projects', flattenPath(workdir))
    const done = await reviewedSessionTrash(api, [sessionId(UUID_A)])
    expect(done.errors).toEqual([])
    expect(await exists(path.join(root, `${UUID_A}.jsonl`))).toBe(false)

    // Claude, later that session, saving to the same file.
    const theirs = opening('their work, written after the sweep')
    await fs.writeFile(path.join(root, `${UUID_A}.jsonl`), theirs, 'utf8')

    const undone = await api.journalUndo(done.data?.id as string)
    expect(undone.errors).toEqual([])
    const undoId = (undone.data as JournalEntryInfo).id.slice('journal:'.length)

    // The trashed transcript came back...
    expect(await fs.readFile(path.join(root, `${UUID_A}.jsonl`), 'utf8')).toBe(opening(SHARED))
    // ...and theirs is in the undo's own trash rather than gone.
    const displaced = path.join(
      world.kondoDataRoot,
      'trash',
      undoId,
      'user',
      'projects',
      flattenPath(workdir),
      `${UUID_A}.jsonl`
    )
    expect(await fs.readFile(displaced, 'utf8')).toBe(theirs)
  })

  it('names the one session when only one was picked', async () => {
    const done = await reviewedSessionTrash(api, [sessionId(UUID_C)])
    expect(done.errors).toEqual([])
    expect(done.data?.kind).toBe('session')
    expect(done.data?.entityId).toBe(sessionId(UUID_C))
    expect(done.data?.stepCount).toBe(1)
  })

  it('refuses the whole set when one id no longer resolves', async () => {
    const before = await hashTree(world.userRoot)
    const refusal = await reviewedSessionTrash(api, [sessionId(UUID_A), sessionId(UUID_D)])
    expect(refusal.data).toBeNull()
    expect(refusal.errors[0]?.code).toBe('unknown-id')
    // Not one byte moved, and no entry promising an undo that never happened.
    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a desktop session in the matrix’s own words (ADR-0006)', async () => {
    const refusal = await reviewedSessionTrash(api, ['session:desktop:device-1/account-1/x'])
    expect(refusal.data).toBeNull()
    expect(refusal.errors[0]?.code).toBe('not-permitted')
    expect(refusal.errors[0]?.message).toMatch(/stays where it is/)
  })

  it('writes no entry for an empty selection', async () => {
    const nothing = await reviewedSessionTrash(api, [])
    expect(nothing.errors).toEqual([])
    expect(nothing.data).toBeNull()
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses a request that is not a list of ids', async () => {
    const bad = await reviewedSessionTrash(api, 'session:code:x/y' as never)
    expect(bad.errors[0]?.code).toBe('bad-request')
  })

  it('displaces a session named twice exactly once', async () => {
    const done = await reviewedSessionTrash(api, [sessionId(UUID_C), sessionId(UUID_C)])
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(1)
  })
})

describe('reviewed session removal (102)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const dir = 'D--Projects-reviewed'
  const id = (uuid = UUID_A): string => `session:code:${dir}/${uuid}`
  const file = (name: string): string => path.join(world.userRoot, 'projects', dir, name)
  const ids = (): string[] => [id(), id(UUID_B)]
  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'settings.json': '{}',
      [`projects/${dir}/${UUID_A}.jsonl`]: opening(SHARED),
      [`projects/${dir}/${UUID_A}/nested/agent.jsonl`]: opening(SHARED),
      [`projects/${dir}/${UUID_B}.jsonl`]: opening(SHARED)
    })
    await fs.utimes(file(`${UUID_A}.jsonl`), PINNED, PINNED)
    api = createWorkspace({ locator: world.locator, platform: process.platform, guessExists: async () => 'absent' })
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  const token = async (): Promise<string> => {
    const preview = await api.sessionTrashPreview(ids())
    expect(preview.errors).toEqual([])
    expect(preview.data?.count).toBe(2)
    expect(preview.data?.sessions.map((session) => session.id).sort()).toEqual(ids().sort())
    return preview.data!.reviewToken
  }

  it.each(['resume', 'same-size', 'metadata-only', 'removed', 'replaced', 'sidecar-added', 'sidecar-removed', 'sidecar-changed', 'marker-added', 'marker-changed'] as const)(
    'refuses the entire selection before journaling after %s', async (change) => {
      if (change === 'marker-changed') await fs.writeFile(file(`${UUID_A}.desktop-released.json`), '{"v":1}')
      const reviewToken = await token()
      if (change === 'resume') await fs.appendFile(file(`${UUID_A}.jsonl`), opening('new work'))
      if (change === 'same-size') {
        await fs.writeFile(file(`${UUID_A}.jsonl`), opening(REWRITTEN))
        await fs.utimes(file(`${UUID_A}.jsonl`), PINNED, PINNED)
      }
      if (change === 'metadata-only') await fs.utimes(file(`${UUID_A}.jsonl`), new Date(), new Date())
      if (change === 'removed' || change === 'replaced') {
        await fs.rename(file(`${UUID_A}.jsonl`), path.join(world.base, 'retained.jsonl'))
        if (change === 'replaced') {
          await fs.writeFile(file(`${UUID_A}.jsonl`), opening(SHARED))
          await fs.utimes(file(`${UUID_A}.jsonl`), PINNED, PINNED)
        }
      }
      if (change === 'sidecar-added') await writeFileTree(world.userRoot, { [`projects/${dir}/${UUID_B}/new.jsonl`]: opening('new state') })
      if (change === 'sidecar-removed') await fs.rename(file(UUID_A), path.join(world.base, 'retained-sidecar'))
      if (change === 'sidecar-changed') {
        const nested = file(`${UUID_A}/nested/agent.jsonl`)
        const before = await fs.stat(nested)
        await fs.writeFile(nested, opening(REWRITTEN))
        await fs.utimes(nested, before.atime, before.mtime)
      }
      if (change === 'marker-added') await fs.writeFile(file(`${UUID_A}.desktop-released.json`), '{"v":1}')
      if (change === 'marker-changed') await fs.writeFile(file(`${UUID_A}.desktop-released.json`), '{"v":2}')
      const before = await hashTree(world.userRoot)
      const result = await api.sessionTrash(ids(), reviewToken)
      expect(result.data).toBeNull()
      expect(result.errors[0]?.code).toBe('stale-plan')
      expect(await hashTree(world.userRoot)).toBe(before)
      expect(await exists(path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(false)
      expect(await exists(path.join(world.kondoDataRoot, 'trash'))).toBe(false)
    }
  )

  it('forces fresh inventory for the review and returns the reviewed metadata', async () => {
    const old = await api.sessionList(`project:code:${dir}`)
    await fs.appendFile(file(`${UUID_A}.jsonl`), opening('a new turn'))
    const current = await api.sessionTrashPreview([id()])
    expect(current.errors).toEqual([])
    expect(current.data?.sessions[0]?.bytes).toBeGreaterThan(old.data.find((session) => session.id === id())!.bytes)
    expect(current.data?.sessions[0]?.mtimeMs).toBe((await fs.stat(file(`${UUID_A}.jsonl`))).mtimeMs)
  })

  it('rejects missing/unknown/cross-workspace tokens and changed ID sets', async () => {
    const reviewToken = await token()
    expect((await api.sessionTrash(ids())).errors[0]?.code).toBe('stale-plan')
    expect((await api.sessionTrash(ids(), 'unknown')).errors[0]?.code).toBe('stale-plan')
    const other = createWorkspace({ locator: world.locator, platform: process.platform, guessExists: async () => 'absent' })
    expect((await other.sessionTrash(ids(), reviewToken)).errors[0]?.code).toBe('stale-plan')
    expect((await api.sessionTrash([id()], reviewToken)).errors[0]?.code).toBe('stale-plan')
    expect((await api.sessionTrash(ids(), reviewToken)).errors[0]?.code).toBe('stale-plan')
    expect((await api.journalList()).data).toEqual([])
  })

  it('keeps generic session trash closed', async () => {
    const reviewToken = await token()
    const result = await api.entityMutate(id(), { op: 'trash', reviewToken })
    expect(result.data).toBeNull()
    expect(result.errors[0]?.code).toBe('not-permitted')
    expect((await api.journalList()).data).toEqual([])
  })

  it('unchanged review streams full nested transcripts, applies once and undoes byte-for-byte', async () => {
    const before = await hashTree(world.userRoot)
    const read = vi.spyOn(fs, 'readFile')
    const reviewToken = await token()
    const result = await api.sessionTrash(ids(), reviewToken)
    expect(result.errors).toEqual([])
    expect(result.data?.stepCount).toBe(3)
    expect(read.mock.calls.some(([target]) => String(target).endsWith(`${UUID_A}.jsonl`) || String(target).endsWith('agent.jsonl'))).toBe(false)
    read.mockRestore()
    expect((await api.sessionTrash(ids(), reviewToken)).errors[0]?.code).toBe('stale-plan')
    expect((await api.journalUndo(result.data!.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
    const journal = await hashTree(world.kondoDataRoot)
    expect((await api.sessionTrash(ids(), reviewToken)).errors[0]?.code).toBe('stale-plan')
    expect(await hashTree(world.kondoDataRoot)).toBe(journal)
  })
})

/**
 * Entry 110: what the confirmation discloses before it exists (ADR-0016).
 *
 * The estimate said how many bytes would move; nothing said which files. These
 * cases hold the descriptors to the plan itself — every path named is a path
 * that moves, every path that moves is named, and nothing outside the selected
 * uuid namespace appears in either.
 */
describe('the removal disclosure (110)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const dir = 'D--Projects-disclosed'
  const other = 'D--Projects-second'
  const id = (uuid: string, at = dir): string => `session:code:${at}/${uuid}`
  const file = (name: string, at = dir): string =>
    path.join(world.userRoot, 'projects', at, name)

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'settings.json': '{}',
      // Every residual at once: transcript, sidecar directory, released marker.
      [`projects/${dir}/${UUID_A}.jsonl`]: opening(SHARED),
      [`projects/${dir}/${UUID_A}/nested/agent.jsonl`]: opening(SHARED),
      [`projects/${dir}/${UUID_A}.desktop-released.json`]: desktopReleased(),
      // A bare transcript, so the descriptor's nulls are exercised too.
      [`projects/${dir}/${UUID_B}.jsonl`]: opening(REWRITTEN),
      // A second project, so the identity list spans more than one row.
      [`projects/${other}/${UUID_C}.jsonl`]: opening(SHARED),
      // Records selected removal never touches (domain.md).
      'history.jsonl': '{"display":"kept"}\n',
      [`session-env/${UUID_A}/env.json`]: '{"kept":true}'
    })
    // The desktop store holds a file named with UUID_A's id, and nothing else.
    await writeFileTree(world.desktopRoot, {
      [`local-agent-mode-sessions/device-1/account-1/local_${UUID_A}.json`]: '{}'
    })
    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      guessExists: async () => 'absent'
    })
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  const preview = async (ids: string[]) => {
    const scan = await api.sessionTrashPreview(ids)
    expect(scan.errors).toEqual([])
    expect(scan.data).not.toBeNull()
    return scan.data!
  }

  it('names every residual of a session that has all three', async () => {
    const found = await preview([id(UUID_A)])
    expect(found.candidates).toHaveLength(1)
    const only = found.candidates[0]!
    expect(only.id).toBe(id(UUID_A))
    // Display text, tildified outward, never a raw absolute path (ADR-0002).
    for (const at of [only.transcript, only.sidecar, only.releasedMarker]) {
      expect(at).toMatch(/^~\//)
    }
    expect(only.transcript).toContain(`${UUID_A}.jsonl`)
    expect(only.sidecar).toContain(`${dir}/${UUID_A}`)
    expect(only.releasedMarker).toContain(`${UUID_A}.desktop-released.json`)
  })

  it('leaves the sidecar and marker null for a bare transcript', async () => {
    const only = (await preview([id(UUID_B)])).candidates[0]!
    expect(only.transcript).toContain(`${UUID_B}.jsonl`)
    expect(only.sidecar).toBeNull()
    expect(only.releasedMarker).toBeNull()
  })

  it('names exactly the paths the move then takes, and no others', async () => {
    const ids = [id(UUID_A), id(UUID_B)]
    const found = await preview(ids)
    const named = found.candidates.flatMap((candidate) =>
      [candidate.transcript, candidate.sidecar, candidate.releasedMarker]
        .filter((at): at is string => at !== null))
    expect(named).toHaveLength(4)
    // One step per named path: the disclosure is the plan, spelled out.
    const done = await api.sessionTrash(ids, found.reviewToken)
    expect(done.errors).toEqual([])
    expect(done.data?.stepCount).toBe(named.length)
    for (const name of [`${UUID_A}.jsonl`, `${UUID_A}.desktop-released.json`, UUID_A, `${UUID_B}.jsonl`]) {
      expect(await exists(file(name))).toBe(false)
    }
  })

  it('lists one identity per project the selection spans', async () => {
    const found = await preview([id(UUID_A), id(UUID_C, other)])
    expect(found.projects.map((project) => project.id)).toEqual([
      `project:code:${dir}`,
      `project:code:${other}`
    ])
    // No path was resolved for either, so the flattened key stands in as the
    // label rather than a guess at the real directory.
    expect(found.projects.map((project) => project.label)).toEqual([dir, other])
  })

  it('says one project once, however many of its conversations are picked', async () => {
    const found = await preview([id(UUID_A), id(UUID_B)])
    expect(found.projects).toHaveLength(1)
    expect(found.count).toBe(2)
  })

  it('keeps the desktop record, the prompt history and the snapshot (ADR-0016)', async () => {
    const ids = [id(UUID_A)]
    const found = await preview(ids)
    // The disclosure's Desktop line is conditional on this, and it is an ID
    // match: nothing opened either file to say so.
    expect(found.sessions[0]?.mirroredIn).toBe('desktop')
    const mirror = path.join(
      world.desktopRoot, 'local-agent-mode-sessions', 'device-1', 'account-1', `local_${UUID_A}.json`
    )
    const desktopBefore = await hashTree(world.desktopRoot)

    expect((await api.sessionTrash(ids, found.reviewToken)).errors).toEqual([])
    expect(await exists(mirror)).toBe(true)
    expect(await hashTree(world.desktopRoot)).toBe(desktopBefore)
    expect(await exists(path.join(world.userRoot, 'history.jsonl'))).toBe(true)
    expect(await exists(path.join(world.userRoot, 'session-env', UUID_A, 'env.json'))).toBe(true)
  })

  it('restores every named path on Undo, byte for byte', async () => {
    const before = await hashTree(world.userRoot)
    const ids = [id(UUID_A), id(UUID_B)]
    const found = await preview(ids)
    const done = await api.sessionTrash(ids, found.reviewToken)
    expect(done.errors).toEqual([])
    expect((await api.journalUndo(done.data!.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it('refuses the whole preview when an unknown sibling shares the uuid stem', async () => {
    await fs.writeFile(file(`${UUID_A}.notes.txt`), 'something kondo does not recognize')
    const scan = await api.sessionTrashPreview([id(UUID_A)])
    expect(scan.data).toBeNull()
    expect(scan.errors[0]?.code).toBe('stale-plan')
    expect(await exists(path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(false)
  })

  it('discloses nothing for a desktop id, or for a selection mixing the two', async () => {
    const desktop = 'session:desktop:device-1/account-1/x'
    for (const ids of [[desktop], [id(UUID_A), desktop]]) {
      const scan = await api.sessionTrashPreview(ids)
      expect(scan.data).toBeNull()
      expect(scan.errors[0]?.code).toBe('not-permitted')
    }
    expect(await exists(path.join(world.kondoDataRoot, 'journal.jsonl'))).toBe(false)
  })
})

/**
 * Entry 105, the selected-removal half of audit finding A10. `sessionTrashPlan`
 * has always moved the sidecar directory and the released marker with the
 * transcript; the confirmation quoted the transcript alone. The estimate is now
 * measured over the plan's own steps, so what the screen says and what the
 * trash gains are the same number.
 */
describe('companion bytes in the session-removal estimate (105)', () => {
  let world: FixtureWorld
  let api: KondoApi
  const dir = 'D--Projects-companions'
  const id = (uuid: string): string => `session:code:${dir}/${uuid}`
  const file = (name: string): string => path.join(world.userRoot, 'projects', dir, name)

  const MARKER = desktopReleased()
  const NESTED = '{"tool":"state"}'
  const COMPANION_BYTES = 5000
  const FILLER = 'x'.repeat(
    COMPANION_BYTES - Buffer.byteLength(MARKER) - Buffer.byteLength(NESTED)
  )

  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.userRoot, {
      'settings.json': '{}',
      // One transcript carrying exactly 5,000 bytes of companions...
      [`projects/${dir}/${UUID_A}.jsonl`]: opening(SHARED),
      [`projects/${dir}/${UUID_A}.desktop-released.json`]: MARKER,
      [`projects/${dir}/${UUID_A}/state.json`]: NESTED,
      [`projects/${dir}/${UUID_A}/nested/big.bin`]: FILLER,
      // ...and one carrying none, so the sum spans both shapes.
      [`projects/${dir}/${UUID_B}.jsonl`]: opening(REWRITTEN)
    })
    api = createWorkspace({
      locator: world.locator,
      platform: process.platform,
      guessExists: async () => 'absent'
    })
  })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  const trashBytes = async (): Promise<number> => (await api.trashSize()).data.bytes

  it('holds exactly 5,000 bytes of companions beside the transcript', async () => {
    let total = 0
    for (const name of [`${UUID_A}.desktop-released.json`, `${UUID_A}/state.json`, `${UUID_A}/nested/big.bin`]) {
      total += (await fs.stat(file(name))).size
    }
    expect(total).toBe(COMPANION_BYTES)
  })

  it('counts the companions the per-session transcript size leaves out (A10)', async () => {
    const preview = await api.sessionTrashPreview([id(UUID_A)])
    expect(preview.errors).toEqual([])
    const transcript = (await fs.stat(file(`${UUID_A}.jsonl`))).size
    // What the row shows is still one transcript...
    expect(preview.data?.sessions[0]?.bytes).toBe(transcript)
    // ...and what the confirmation shows is every byte that moves.
    expect(preview.data?.estimate.movingBytes).toBe(transcript + COMPANION_BYTES)
  })

  it('grows the trash by exactly the estimate it showed', async () => {
    const ids = [id(UUID_A), id(UUID_B)]
    const preview = await api.sessionTrashPreview(ids)
    expect(preview.errors).toEqual([])
    const estimate = preview.data!.estimate
    const before = await trashBytes()
    expect(estimate.trashBytesBefore).toBe(before)

    const done = await api.sessionTrash(ids, preview.data!.reviewToken)
    expect(done.errors).toEqual([])
    expect(await trashBytes()).toBe(estimate.trashBytesAfter)
    expect(await trashBytes()).toBe(before + estimate.movingBytes)
  })

  it('names what moves, what the trash then holds, and what an empty frees', async () => {
    const ids = [id(UUID_A), id(UUID_B)]
    const estimate = (await api.sessionTrashPreview(ids)).data!.estimate
    expect(estimate.trashBytesAfter).toBe(estimate.trashBytesBefore + estimate.movingBytes)
    expect(estimate.freedOnEmptyBytes).toBe(estimate.trashBytesAfter)
    expect(estimate.incomplete).toBe(false)

    const second = await api.sessionTrashPreview(ids)
    expect((await api.sessionTrash(ids, second.data!.reviewToken)).errors).toEqual([])
    // Moving frees nothing; only emptying does, and by the third figure.
    expect((await api.trashEmpty()).data.bytes).toBe(estimate.freedOnEmptyBytes)
  })
})
