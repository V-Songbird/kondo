import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'
import type { ScanError } from '../../../shared/contract'
import type { MutationPlan } from './mutations'
import { inspectPhysicalTree } from './relocation'
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

/** Bytes under a reviewed step set, and whether every one of them was read. */
export interface ReviewedBytes {
  bytes: number
  /** False when a reviewed path could not be read: the sum is a floor. */
  complete: boolean
}

/** A key already counted, or nested inside one — either way, counted. */
function alreadyCounted(counted: Set<string>, key: string): boolean {
  if (counted.has(key)) return true
  for (let at = key.indexOf('/'); at !== -1; at = key.indexOf('/', at + 1)) {
    if (counted.has(key.slice(0, at))) return true
  }
  return false
}

/**
 * What a reviewed removal will move: regular-file bytes under the `trash`
 * steps of the plan a review token binds, counted the way the trash counts
 * its own occupancy — `inspectPhysicalTree` sums regular files and gives
 * directories and links nothing. Same rule on both sides, so the trash grows
 * by exactly this.
 *
 * Measured from the step set and never from a second walk of the store: a
 * figure derived from anything else can disagree with what actually moves.
 * A session's sidecar directory and released marker are steps of the same
 * plan as its transcript, which is what puts their bytes in this number.
 *
 * `counted` carries the paths already measured, so a path — or one nested
 * inside a counted path — is never counted twice. Passing one set across
 * several plans is what keeps category figures disjoint and makes the sum of
 * a multi-category selection its union.
 */
export async function reviewedBytes(
  plan: MutationPlan | null,
  rootOf: (store: string) => string | null,
  counted: Set<string> = new Set(),
  onError?: (at: string, cause: unknown) => void
): Promise<ReviewedBytes> {
  let bytes = 0
  let complete = true
  for (const step of plan?.steps ?? []) {
    if (step.type !== 'trash') continue
    const root = rootOf(step.store)
    // A step whose store has no root cannot be measured or, for that matter,
    // moved; the sweep itself refuses it. Here it only makes the sum a floor.
    if (root === null) {
      complete = false
      continue
    }
    const key = `${step.store}\0${step.from}`
    if (alreadyCounted(counted, key)) continue
    counted.add(key)
    const target = path.join(root, ...step.from.split('/'))
    try {
      for (const entry of await inspectPhysicalTree(target, root, onError && ((at, cause) => {
        complete = false
        onError(at, cause)
      }))) {
        bytes += entry.bytes
      }
    } catch (cause) {
      complete = false
      onError?.(target, cause)
    }
  }
  return { bytes, complete }
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