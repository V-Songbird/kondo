import { createReadStream } from 'node:fs'
import readline from 'node:readline'
import { truncate } from './display'
import { resolveAllowedPath, type ReadBoundary } from './scan'

/** Contract: SessionDetail.firstUserPrompt is truncated for display. */
const MAX_PROMPT_CHARS = 280

/**
 * Streaming transcript reads (ADR-0007): transcripts reach hundreds of
 * megabytes, so lines are consumed one at a time and never accumulated.
 */

export interface TranscriptSummary {
  lineCount: number
  messageCount: number
  badLines: number
  firstTimestamp: string | null
  lastTimestamp: string | null
  firstUserPrompt: string | null
}

export async function summarizeTranscript(file: string, boundary: ReadBoundary): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {
    lineCount: 0,
    messageCount: 0,
    badLines: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    firstUserPrompt: null
  }

  const stream = createReadStream(await resolveAllowedPath(file, boundary), { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (line.trim() === '') continue
      summary.lineCount += 1
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        summary.badLines += 1
        continue
      }
      if (typeof event !== 'object' || event === null) {
        summary.badLines += 1
        continue
      }
      const record = event as Record<string, unknown>
      const timestamp = typeof record['timestamp'] === 'string' ? record['timestamp'] : null
      if (timestamp) {
        summary.firstTimestamp ??= timestamp
        summary.lastTimestamp = timestamp
      }
      const type = record['type']
      if (type === 'user' || type === 'assistant') {
        summary.messageCount += 1
        if (type === 'user' && summary.firstUserPrompt === null) {
          const text = extractText(record['message'])
          summary.firstUserPrompt = text === null ? null : truncate(text, MAX_PROMPT_CHARS)
        }
      }
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  return summary
}

/**
 * The opening user message and nothing after it. `summarizeTranscript` has to
 * reach the last line to bound a session in time; this one stops at the first
 * user message it can read, so the near-duplicate scan pays a few kilobytes
 * per session instead of a whole transcript (ADR-0007).
 *
 * A malformed line is skipped rather than fatal, and a transcript with no
 * readable user message answers null (ADR-0005).
 */
export async function readFirstUserPrompt(file: string, boundary: ReadBoundary): Promise<string | null> {
  const stream = createReadStream(await resolveAllowedPath(file, boundary), { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (line.trim() === '') continue
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof event !== 'object' || event === null) continue
      const record = event as Record<string, unknown>
      if (record['type'] !== 'user') continue
      const text = extractText(record['message'])
      // A user event whose content kondo cannot read is not the opening; the
      // stream goes on to the next one rather than calling the session blank.
      if (text === null) continue
      return truncate(text, MAX_PROMPT_CHARS)
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  return null
}

function extractText(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null
  const content = (message as Record<string, unknown>)['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (
        typeof part === 'object' &&
        part !== null &&
        (part as Record<string, unknown>)['type'] === 'text' &&
        typeof (part as Record<string, unknown>)['text'] === 'string'
      ) {
        return (part as Record<string, unknown>)['text'] as string
      }
    }
  }
  return null
}
