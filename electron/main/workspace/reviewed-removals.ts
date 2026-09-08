import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'
import type { ScanError } from '../../../shared/contract'
import { inspectTree, resolveAllowedPath } from './scan'

/** Process-local reviews expire, are bounded, and are consumed before any await. */
export function createRemovalReviews<T>(now: () => number) {
  const entries = new Map<string, { value: T; expires: number; bytes: number }>()
  const maxBytes = 8 * 1024 * 1024
  let bytes = 0
  const remove = (token: string): void => {
    bytes -= entries.get(token)?.bytes ?? 0
    entries.delete(token)
  }
  return {
    issue(value: T): string | null {
      for (const [token, entry] of entries) if (entry.expires <= now()) remove(token)
      const size = Buffer.byteLength(JSON.stringify(value))
      if (size > maxBytes) return null
      while (entries.size >= 128 || bytes + size > maxBytes) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        remove(oldest)
      }
      const token = randomUUID()
      entries.set(token, { value: structuredClone(value), expires: now() + 15 * 60_000, bytes: size })
      bytes += size
      return token
    },
    take(token: unknown): T | null {
      if (typeof token !== 'string') return null
      const entry = entries.get(token)
      remove(token)
      return entry && entry.expires > now() ? entry.value : null
    }
  }
}

export function staleRemoval(at: string, detail = 'The removal review expired, was used, or is no longer available.'): ScanError {
  return { code: 'stale-plan', path: at, message: `${detail} Nothing moved. Review the selection again.` }
}

const metadata = (info: Stats): string => JSON.stringify([
  info.dev, info.ino, info.mode, info.size, info.birthtimeMs, info.mtimeMs, info.ctimeMs
])

/**
 * Main-only exact tree identity/content/activity snapshot. Every content read is
 * boundary checked and streamed, including transcripts nested in sidecars.
 * Rechecking metadata and membership detects observed mid-read changes; these
 * pathname checks are not a filesystem transaction against external writers.
 */
export async function snapshotRemovalTree(target: string, root: string): Promise<string> {
  const entries = await inspectTree(target, root)
  const ordered = entries.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)
  const hash = createHash('sha256')
  for (const entry of ordered) {
    const at = path.join(target, entry.relative)
    const resolved = await resolveAllowedPath(at, root)
    const parent = await resolveAllowedPath(path.dirname(at), root)
    const physical = path.join(parent, path.basename(at))
    const linkBefore = metadata(await fs.lstat(physical))
    const before = metadata(await fs.stat(resolved))
    hash.update(JSON.stringify([entry.relative, entry.directory, resolved, linkBefore, before]))
    if (!entry.directory) {
      const handle = await fs.open(await resolveAllowedPath(at, root), 'r')
      try {
        if (metadata(await handle.stat()) !== before) throw Error('The reviewed file changed while opening it.')
        const content = createHash('sha256')
        const buffer = Buffer.allocUnsafe(64 * 1024)
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
          if (bytesRead === 0) break
          content.update(buffer.subarray(0, bytesRead))
        }
        hash.update(content.digest('hex'))
        if (metadata(await handle.stat()) !== before) throw Error('The reviewed file changed while reading it.')
      } finally {
        await handle.close()
      }
    }
    if (await resolveAllowedPath(at, root) !== resolved ||
        metadata(await fs.stat(resolved)) !== before ||
        metadata(await fs.lstat(physical)) !== linkBefore) {
      throw Error('The reviewed entry changed while reading it.')
    }
  }
  const after = (await inspectTree(target, root))
    .sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)
  if (JSON.stringify(after) !== JSON.stringify(ordered)) throw Error('The reviewed tree membership changed while reading it.')
  return hash.digest('hex')
}