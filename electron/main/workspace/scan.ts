import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Dirent, Stats } from 'node:fs'
import type { Scan, ScanError, ScanErrorCode } from '../../../shared/contract'
import { slashed, tildify } from './display'

/** Scan plumbing: failures are itemized so healthy siblings remain available. */
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

/** V8 quotes the parsed source in a JSON syntax error, so that text never crosses (ADR-0022). */
export const INVALID_JSON = 'Not valid JSON; its contents were skipped and are not shown.'

export function describe(cause: unknown): string {
  if (cause instanceof SyntaxError) return INVALID_JSON
  if (cause instanceof Error) return cause.message
  return String(cause)
}

/** Keeps each failure's code and display path, replacing its exception text (ADR-0022). */
export function redacted(c: Collector, message: string): Collector {
  return { errors: c.errors, unknown: c.unknown, fail: (code, displayPath) => c.fail(code, displayPath, message) }
}

export function isEnoent(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null &&
    (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

/** A directory authority, or one of ADR-0002's exact-file exceptions. */
export type ReadBoundary = string | { file: string }

export class BoundaryError extends Error {
  constructor(readonly code: 'out-of-store' | 'read-failed', message: string) {
    super(message)
  }
}

const samePath = (a: string, b: string): boolean => path.relative(a, b) === ''

/** Lexical containment only; resolve links before using as an I/O boundary. */
export function pathWithin(target: string, root: string): boolean {
  const rel = path.relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/** Store-relative display/plan path, with portable forward slashes. */
export const relativeTo = (root: string, target: string): string =>
  path.relative(root, target).split(path.sep).join('/')

/** Resolve missing destinations through their nearest existing ancestor. */
export async function realpathWithMissing(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch (cause) {
    if (!isEnoent(cause)) throw cause
    const entry = await fs.lstat(target).catch((error: unknown) => {
      if (!isEnoent(error)) throw error
      return null
    })
    if (entry !== null) {
      throw new BoundaryError('read-failed', 'Cannot resolve a dangling filesystem link.')
    }
    const parent = path.dirname(target)
    if (parent === target) throw cause
    return path.join(await realpathWithMissing(parent), path.basename(target))
  }
}

const OVERLAP_FIX =
  'Choose another KONDO_DATA_ROOT, or remove the link that points into the store.'

/**
 * ADR-0001 decision 6, by resolved path: kondo's own footprint must never sit
 * inside a Claude store, or its trash would show up in kondo's own scan and a
 * sweep could trash its own undo history. Returns the refusal to report, or
 * null when `kondoPath` stays outside every root.
 *
 * Both sides are resolved and a missing `<kondo-data>` tail resolves through
 * its nearest existing ancestor, so a link anywhere along either path is seen
 * — and seen at the moment of the call, because one can appear at any time.
 * The roots are the locator's (ADR-0003); nothing here derives one. A kondo
 * path that cannot be resolved is refused too: an unverifiable footprint is
 * not a proven-safe one.
 */
export async function overlapRefusal(
  kondoPath: string,
  display: string,
  roots: ReadonlyArray<string | null>,
  home: string | null = null
): Promise<string | null> {
  let resolved: string
  try {
    resolved = await realpathWithMissing(path.resolve(kondoPath))
  } catch (cause) {
    return `Kondo could not check whether ${display} sits outside Claude's stores, ` +
      `so nothing was read or changed. ${describe(cause)} ${OVERLAP_FIX}`
  }
  for (const root of roots) {
    if (root === null) continue
    // A store root that cannot be resolved holds nothing to write into.
    const store = await realpathWithMissing(path.resolve(root)).catch(() => null)
    if (store === null) continue
    if (!samePath(resolved, store) && !pathWithin(resolved, store)) continue
    return `${display} resolves inside the Claude store at ${home === null ? slashed(root) : tildify(root, home)}. ` +
      'Kondo keeps its journal, trash, preferences and caches outside every Claude store (ADR-0001), ' +
      `so nothing was read or changed. ${OVERLAP_FIX}`
  }
  return null
}

/**
 * Resolve against the owning store, never against a nested scan directory.
 * A configured root may itself be an alias. Exact-file exceptions authorize
 * only their basename under the resolved parent, never a redirected sibling.
 * These checks guard stable links, not every concurrent replacement race.
 */
export async function resolveAllowedPath(
  target: string,
  boundary: ReadBoundary,
  allowMissing = false
): Promise<string> {
  const exact = typeof boundary !== 'string'
  const root = path.resolve(exact ? path.dirname(boundary.file) : boundary)
  const absolute = path.resolve(target)
  if (exact ? !samePath(absolute, path.resolve(boundary.file)) :
    !samePath(absolute, root) && !pathWithin(absolute, root)) {
    throw new BoundaryError('out-of-store', 'The path leaves its allowed store boundary.')
  }
  const resolvedRoot = await realpathWithMissing(root)
  const resolved = await realpathWithMissing(absolute)
  const allowed = exact
    ? samePath(resolved, path.join(resolvedRoot, path.basename(boundary.file)))
    : samePath(resolved, resolvedRoot) || pathWithin(resolved, resolvedRoot)
  if (!allowed) {
    throw new BoundaryError('out-of-store', 'The resolved path leaves its allowed store boundary.')
  }
  return allowMissing ? resolved : await fs.realpath(resolved)
}

function failRead(c: Collector, display: string, cause: unknown, code: ScanErrorCode = 'read-failed'): void {
  if (!isEnoent(cause)) c.fail(cause instanceof BoundaryError ? cause.code : code, display, cause)
}

/** Validate directory entries too, so unsafe links never become cleanup candidates. */
export async function safeReaddir(
  dir: string,
  display: string,
  c: Collector,
  boundary: ReadBoundary
): Promise<Dirent[]> {
  try {
    const resolved = await resolveAllowedPath(dir, boundary)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    const checked = await mapPool(entries, 32, async (entry) => {
      try {
        const child = await resolveAllowedPath(path.join(dir, entry.name), boundary)
        if (entry.isSymbolicLink()) {
          const info = await fs.stat(child)
          if (info.isDirectory() && (samePath(child, resolved) || pathWithin(resolved, child))) {
            throw new BoundaryError('read-failed', 'A directory link loops into its ancestors.')
          }
          Object.assign(entry, {
            isDirectory: () => info.isDirectory(),
            isFile: () => info.isFile()
          })
        }
        return entry
      } catch (cause) {
        failRead(c, `${display}/${entry.name}`, cause)
        return null
      }
    })
    return checked.filter((entry): entry is Dirent => entry !== null)
  } catch (cause) {
    failRead(c, display, cause)
    return []
  }
}

export async function safeStat(
  target: string,
  display: string,
  c: Collector,
  boundary: ReadBoundary
): Promise<Stats | null> {
  try {
    return await fs.stat(await resolveAllowedPath(target, boundary))
  } catch (cause) {
    failRead(c, display, cause, 'stat-failed')
    return null
  }
}

export async function safeReadJson(
  file: string,
  display: string,
  c: Collector,
  boundary: ReadBoundary
): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(await resolveAllowedPath(file, boundary), 'utf8')
  } catch (cause) {
    failRead(c, display, cause)
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (cause) {
    c.fail('parse-failed', display, cause)
    return null
  }
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

export interface TreeEntry {
  relative: string
  directory: boolean
}

/**
 * Strict preflight for hashes/copies: a partial tree cannot prove equality.
 * Detect cycles per ancestry, allowing two independent aliases of safe data.
 */
export async function inspectTree(target: string, boundary: ReadBoundary): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  const walk = async (at: string, relative: string, ancestors: Set<string>): Promise<void> => {
    const resolved = await resolveAllowedPath(at, boundary)
    const info = await fs.stat(resolved)
    const directory = info.isDirectory()
    if (!directory && !info.isFile()) {
      throw new BoundaryError('read-failed', 'Only regular files and directories can be copied or hashed.')
    }
    entries.push({ relative, directory })
    if (!directory) return
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (ancestors.has(key)) throw new BoundaryError('read-failed', 'A directory link creates a recursive cycle.')
    const next = new Set(ancestors).add(key)
    for (const entry of await fs.readdir(resolved, { withFileTypes: true })) {
      await walk(path.join(at, entry.name), relative ? `${relative}/${entry.name}` : entry.name, next)
    }
  }
  await walk(target, '', new Set())
  return entries
}

/** Persisted logical fingerprints must name this format; bare legacy hashes are ambiguous. */
export const TREE_DIGEST_PREFIX = 'tree-v2:'

/** Hash typed, length-framed logical paths and bytes after strict tree preflight (ADR-0019). */
export async function digestTree(target: string, boundary: ReadBoundary): Promise<string> {
  const entries = await inspectTree(target, boundary)
  const hash = createHash('sha256').update(`kondo:${TREE_DIGEST_PREFIX}\0`)
  const field = (bytes: Buffer): void => {
    const size = Buffer.alloc(8)
    size.writeBigUInt64BE(BigInt(bytes.length))
    hash.update(size)
    hash.update(bytes)
  }
  for (const entry of entries.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)) {
    hash.update(entry.directory ? 'D' : 'F')
    field(Buffer.from(entry.relative, 'utf8'))
    if (!entry.directory) {
      field(await fs.readFile(await resolveAllowedPath(path.join(target, entry.relative), boundary)))
    }
  }
  return hash.digest('hex')
}

/** Copy a preflighted logical tree, validating each destination before I/O. */
export async function copyTree(
  from: string,
  to: string,
  sourceBoundary: ReadBoundary,
  destinationBoundary: ReadBoundary
): Promise<void> {
  const entries = await inspectTree(from, sourceBoundary)
  // Validate every destination before creating even the first directory.
  for (const entry of entries) {
    await resolveAllowedPath(path.join(to, entry.relative), destinationBoundary, true)
  }
  for (const entry of entries) {
    const source = await resolveAllowedPath(path.join(from, entry.relative), sourceBoundary)
    const destination = await resolveAllowedPath(path.join(to, entry.relative), destinationBoundary, true)
    if (entry.directory) {
      await fs.mkdir(destination, { recursive: true })
    } else {
      // Resolve its ancestor separately: mkdir must not follow an unchecked link.
      if (typeof destinationBoundary === 'string') {
        const parent = await resolveAllowedPath(path.dirname(path.join(to, entry.relative)), destinationBoundary, true)
        await fs.mkdir(parent, { recursive: true })
      }
      await fs.copyFile(source, await resolveAllowedPath(path.join(to, entry.relative), destinationBoundary, true))
    }
  }
}

/** Recursive size with partial results and per-directory cycle detection. */
export async function directorySize(
  dir: string,
  display: string,
  c: Collector,
  boundary: ReadBoundary
): Promise<number> {
  const walk = async (at: string, shown: string, ancestors: Set<string>): Promise<number> => {
    try {
      const resolved = await resolveAllowedPath(at, boundary)
      const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
      if (ancestors.has(key)) throw new BoundaryError('read-failed', 'A directory link creates a recursive cycle.')
      const next = new Set(ancestors).add(key)
      const entries = await safeReaddir(at, shown, c, boundary)
      const sizes = await mapPool(entries, 32, async (entry) => {
        const child = path.join(at, entry.name)
        const childDisplay = `${shown}/${entry.name}`
        if (entry.isDirectory()) return await walk(child, childDisplay, next)
        if (!entry.isFile()) return 0
        return (await safeStat(child, childDisplay, c, boundary))?.size ?? 0
      })
      return sizes.reduce((sum, size) => sum + size, 0)
    } catch (cause) {
      failRead(c, shown, cause)
      return 0
    }
  }
  return await walk(dir, display, new Set())
}
