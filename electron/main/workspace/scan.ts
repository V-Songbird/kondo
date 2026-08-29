import fs from 'node:fs/promises'
import path from 'node:path'
import type { Dirent, Stats } from 'node:fs'
import type { Scan, ScanError, ScanErrorCode } from '../../../shared/contract'

/**
 * Scan plumbing (ADR-0005): fs wrappers that turn exceptions into itemized
 * errors so adapters return partial data instead of throwing.
 */

export interface Collector {
  errors: ScanError[]
  unknown: string[]
  fail(code: ScanErrorCode, displayPath: string, cause: unknown): void
}

export function collector(): Collector {
  const errors: ScanError[] = []
  const unknown: string[] = []
  return {
    errors,
    unknown,
    fail(code, displayPath, cause) {
      errors.push({ code, path: displayPath, message: describe(cause) })
    }
  }
}

export function finish<T>(data: T, c: Collector): Scan<T> {
  return { data, errors: c.errors, unknown: c.unknown }
}

export function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

export function isEnoent(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

/** readdir that reports failure to the collector; ENOENT is a plain empty. */
export async function safeReaddir(
  dir: string,
  display: string,
  c: Collector
): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (cause) {
    if (!isEnoent(cause)) c.fail('read-failed', display, cause)
    return []
  }
}

export async function safeStat(
  target: string,
  display: string,
  c: Collector
): Promise<Stats | null> {
  try {
    return await fs.stat(target)
  } catch (cause) {
    if (!isEnoent(cause)) c.fail('stat-failed', display, cause)
    return null
  }
}

export async function safeReadJson(
  file: string,
  display: string,
  c: Collector
): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (cause) {
    if (!isEnoent(cause)) c.fail('read-failed', display, cause)
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (cause) {
    c.fail('parse-failed', display, cause)
    return null
  }
}

/** True when target lies strictly inside root (never for root itself). */
export function pathWithin(target: string, root: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Bounded-concurrency map; order-preserving. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Recursive size of a directory tree; errors reported, never thrown. */
export async function directorySize(
  dir: string,
  display: string,
  c: Collector
): Promise<number> {
  let total = 0
  const entries = await safeReaddir(dir, display, c)
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    const childDisplay = `${display}/${entry.name}`
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      total += await directorySize(child, childDisplay, c)
    } else if (entry.isFile()) {
      const info = await safeStat(child, childDisplay, c)
      if (info) total += info.size
    }
  }
  return total
}
