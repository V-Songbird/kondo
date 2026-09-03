import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readFirstUserPrompt, summarizeTranscript } from '../electron/main/workspace/jsonl'
import { healthyTranscript, makeWorld, transcriptLine, UUID_A, type FixtureWorld } from './helpers'

/**
 * Every read stream this module opened, so a test can ask how far it got.
 * `bytesRead` is the only honest answer to "does getting an opening read the
 * transcript?" — the wrapper passes the real stream straight through.
 */
const opened = vi.hoisted(() => ({ streams: [] as ReadStream[] }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>): ReadStream => {
      const stream = actual.createReadStream(...args)
      opened.streams.push(stream)
      return stream
    }
  }
})

describe('summarizeTranscript', () => {
  let world: FixtureWorld
  beforeEach(async () => {
    world = await makeWorld()
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('summarizes a healthy transcript', async () => {
    const file = path.join(world.base, 'healthy.jsonl')
    await fs.writeFile(file, healthyTranscript(UUID_A))
    const summary = await summarizeTranscript(file)
    expect(summary.lineCount).toBe(4)
    expect(summary.messageCount).toBe(3)
    expect(summary.badLines).toBe(0)
    expect(summary.firstTimestamp).toBe('2026-01-01T10:00:00.000Z')
    expect(summary.lastTimestamp).toBe('2026-01-01T10:01:00.000Z')
    expect(summary.firstUserPrompt).toBe('hello kondo')
  })

  it('counts malformed lines without failing the summary (ADR-0005)', async () => {
    const file = path.join(world.base, 'broken.jsonl')
    await fs.writeFile(
      file,
      transcriptLine({ type: 'summary', sessionId: UUID_A }) +
        'this is not json\n' +
        transcriptLine({
          type: 'user',
          timestamp: '2026-01-02T00:00:00.000Z',
          message: { role: 'user', content: 'still here' }
        })
    )
    const summary = await summarizeTranscript(file)
    expect(summary.badLines).toBe(1)
    expect(summary.messageCount).toBe(1)
    expect(summary.firstUserPrompt).toBe('still here')
  })

  it('truncates a huge first user prompt, as the contract promises', async () => {
    const file = path.join(world.base, 'huge.jsonl')
    await fs.writeFile(
      file,
      transcriptLine({
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'x'.repeat(100_000) }
      })
    )
    const summary = await summarizeTranscript(file)
    expect(summary.firstUserPrompt).not.toBeNull()
    expect(summary.firstUserPrompt!.length).toBeLessThanOrEqual(280)
  })

  it('handles an empty transcript', async () => {
    const file = path.join(world.base, 'empty.jsonl')
    await fs.writeFile(file, '')
    const summary = await summarizeTranscript(file)
    expect(summary).toEqual({
      lineCount: 0,
      messageCount: 0,
      badLines: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      firstUserPrompt: null
    })
  })
})

describe('readFirstUserPrompt', () => {
  let world: FixtureWorld
  beforeEach(async () => {
    world = await makeWorld()
    opened.streams.length = 0
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('returns the opening user message', async () => {
    const file = path.join(world.base, 'healthy.jsonl')
    await fs.writeFile(file, healthyTranscript(UUID_A))
    // The transcript's second user message says something else; the opening
    // is the first, not the last.
    expect(await readFirstUserPrompt(file)).toBe('hello kondo')
  })

  it('skips malformed lines ahead of the opening (ADR-0005)', async () => {
    const file = path.join(world.base, 'broken.jsonl')
    await fs.writeFile(
      file,
      'not json\n' +
        transcriptLine({ type: 'user', message: { role: 'user', content: null } }) +
        transcriptLine({
          type: 'user',
          timestamp: '2026-01-02T00:00:00.000Z',
          message: { role: 'user', content: 'still here' }
        })
    )
    expect(await readFirstUserPrompt(file)).toBe('still here')
  })

  it('answers null for a transcript with no user message at all', async () => {
    const file = path.join(world.base, 'silent.jsonl')
    await fs.writeFile(file, transcriptLine({ type: 'summary', sessionId: UUID_A }))
    expect(await readFirstUserPrompt(file)).toBeNull()
  })

  it('truncates the opening, as the contract promises', async () => {
    const file = path.join(world.base, 'huge.jsonl')
    await fs.writeFile(
      file,
      transcriptLine({ type: 'user', message: { role: 'user', content: 'x'.repeat(100_000) } })
    )
    expect((await readFirstUserPrompt(file))?.length).toBeLessThanOrEqual(280)
  })

  it('stops at the opening instead of reading the transcript out (ADR-0007)', async () => {
    const file = path.join(world.base, 'long.jsonl')
    const tail = transcriptLine({
      type: 'assistant',
      timestamp: '2026-01-01T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(2_000) }] }
    })
    await fs.writeFile(
      file,
      transcriptLine({
        type: 'user',
        timestamp: '2026-01-01T10:00:00.000Z',
        message: { role: 'user', content: 'the opening' }
      }) + tail.repeat(2_000)
    )
    const size = (await fs.stat(file)).size
    expect(size).toBeGreaterThan(2_000_000)

    opened.streams.length = 0
    expect(await readFirstUserPrompt(file)).toBe('the opening')
    // A chunk or two off the front, nowhere near the file.
    expect(opened.streams.at(-1)?.bytesRead).toBeLessThan(size / 4)

    // The summary has to reach the last line to bound the session in time,
    // so it does read it all — which is the contrast this test exists for.
    opened.streams.length = 0
    await summarizeTranscript(file)
    expect(opened.streams.at(-1)?.bytesRead).toBe(size)
  })
})
