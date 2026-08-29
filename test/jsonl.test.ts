import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { summarizeTranscript } from '../electron/main/workspace/jsonl'
import { healthyTranscript, makeWorld, transcriptLine, UUID_A, type FixtureWorld } from './helpers'

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
