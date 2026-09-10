import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  BoundaryError,
  inspectTree,
  isEnoent,
  pathWithin,
  realpathWithMissing,
  resolveAllowedPath,
  type ReadBoundary
} from './scan'

export interface PhysicalEntry {
  relative: string
  kind: 'directory' | 'file' | 'link'
  bytes: number
  link?: string
  directoryLink?: boolean
}

const same = (a: string, b: string): boolean => path.relative(a, b) === ''
const inside = (at: string, root: string): boolean => same(at, root) || pathWithin(at, root)
const keyOf = (at: string): string => process.platform === 'win32' ? at.toLowerCase() : at
function fail(message: string): never {
  throw new BoundaryError('read-failed', message)
}

/** Resolve ancestors only: archived link text is metadata, never a read grant. */
async function physicalPath(at: string, boundary: ReadBoundary, missing = false): Promise<string> {
  if (typeof boundary !== 'string') return resolveAllowedPath(at, boundary, missing)
  const absolute = path.resolve(at)
  const root = path.resolve(boundary)
  if (!inside(absolute, root)) throw new BoundaryError('out-of-store', 'The path leaves its allowed store boundary.')
  if (same(absolute, root)) return resolveAllowedPath(at, boundary, missing)
  const parent = await resolveAllowedPath(path.dirname(absolute), boundary, missing)
  return path.join(parent, path.basename(absolute))
}

export async function inspectPhysicalTree(
  from: string,
  boundary: ReadBoundary,
  onError?: (at: string, cause: unknown) => void
): Promise<PhysicalEntry[]> {
  const result: PhysicalEntry[] = []
  const walk = async (at: string, relative: string): Promise<void> => {
    try {
      const physical = await physicalPath(at, boundary)
      const info = await fs.lstat(physical)
      if (info.isSymbolicLink()) {
        result.push({ relative, kind: 'link', bytes: 0, link: await fs.readlink(physical) })
      } else if (info.isDirectory()) {
        result.push({ relative, kind: 'directory', bytes: 0 })
        for (const entry of await fs.readdir(physical, { withFileTypes: true })) {
          await walk(path.join(at, entry.name), relative ? `${relative}/${entry.name}` : entry.name)
        }
      } else if (info.isFile()) {
        result.push({ relative, kind: 'file', bytes: info.size })
      } else {
        fail('Only regular files, directories and filesystem links can be relocated.')
      }
    } catch (cause) {
      if (onError === undefined) throw cause
      onError(at, cause)
    }
  }
  await walk(from, '')
  return result
}

/**
 * Check the future tree rather than following archived links from the trash.
 * Directory traversal here reads names/metadata only, including safe sibling
 * targets in the destination store. Virtual entries replace any current occupant.
 */
async function validateFuture(to: string, boundary: ReadBoundary, entries: PhysicalEntry[]): Promise<void> {
  const future = await physicalPath(to, boundary, true)
  const authority: ReadBoundary = typeof boundary === 'string'
    ? await realpathWithMissing(boundary)
    : { file: await resolveAllowedPath(boundary.file, boundary, true) }
  const byRelative = new Map(entries.map((entry) => [keyOf(entry.relative), entry]))
  interface FutureNode { at: string; directory: boolean; virtual: boolean }
  const resolve = async (target: string, links = new Set<string>()): Promise<FutureNode> => {
    let at = path.resolve(target)
    if (!inside(at, future)) {
      at = await realpathWithMissing(at)
      await resolveAllowedPath(at, authority, true)
      if (!inside(at, future)) {
        const info = await fs.stat(at)
        if (!info.isDirectory() && !info.isFile()) fail('A restored link has an unsupported target.')
        return { at, directory: info.isDirectory(), virtual: false }
      }
    }
    const relative = path.relative(future, at).split(path.sep).join('/')
    const segments = relative ? relative.split('/') : []
    for (let count = 0; count <= segments.length; count += 1) {
      const prefix = segments.slice(0, count).join('/')
      const entry = byRelative.get(keyOf(prefix))
      if (entry === undefined) fail('A restored link would be dangling.')
      if (entry.kind === 'link') {
        const linkAt = path.join(future, prefix)
        const key = keyOf(linkAt)
        if (links.has(key)) fail('A restored link creates a recursive cycle.')
        const linked = path.resolve(path.dirname(linkAt), entry.link as string)
        const chain = new Set(links).add(key)
        const base = await resolve(linked, chain)
        entry.directoryLink = base.directory
        if (count === segments.length) return base
        if (!base.directory) fail('A restored link traverses a regular file.')
        return resolve(path.join(base.at, ...segments.slice(count)), chain)
      }
      if (count < segments.length && entry.kind !== 'directory') fail('A restored link traverses a regular file.')
      if (count === segments.length) return { at, directory: entry.kind === 'directory', virtual: true }
    }
    return fail('The restored path could not be validated.')
  }
  const walk = async (at: string, ancestors: Set<string>): Promise<void> => {
    const node = await resolve(at)
    if (!node.directory) return
    const key = keyOf(node.at)
    if (ancestors.has(key)) fail('A restored directory link creates a recursive cycle.')
    const next = new Set(ancestors).add(key)
    if (node.virtual) {
      const relative = path.relative(future, node.at).split(path.sep).join('/')
      for (const entry of entries) {
        if (entry.relative && keyOf(path.posix.dirname(entry.relative)) === keyOf(relative || '.')) {
          await walk(path.join(future, entry.relative), next)
        }
      }
    } else {
      for (const entry of await fs.readdir(node.at, { withFileTypes: true })) {
        await walk(path.join(node.at, entry.name), next)
      }
    }
  }
  await walk(future, new Set())
}

async function prepare(
  from: string,
  to: string,
  sourceBoundary: ReadBoundary,
  destinationBoundary: ReadBoundary,
  restore: boolean
): Promise<PhysicalEntry[]> {
  // Archived links may currently point outside trash. A normal source has no
  // such exception: strict source inspection proves its logical tree first.
  const logical = restore ? null : await inspectTree(from, sourceBoundary)
  const entries = await inspectPhysicalTree(from, sourceBoundary)
  if (logical !== null) {
    const kinds = new Map(logical.map((entry) => [entry.relative, entry.directory]))
    for (const entry of entries) {
      if (entry.kind !== 'link') continue
      const directory = kinds.get(entry.relative)
      if (directory === undefined) fail('The source link could not be validated.')
      entry.directoryLink = directory
    }
  }
  await resolveAllowedPath(to, destinationBoundary, true)
  for (const entry of entries) {
    await resolveAllowedPath(path.join(to, entry.relative), destinationBoundary, true)
  }
  if (restore) await validateFuture(to, destinationBoundary, entries)
  return entries
}

/** Read-only preflight; restore=true means links must be safe in the live destination. */
export async function preflightRelocation(
  from: string,
  to: string,
  sourceBoundary: ReadBoundary,
  destinationBoundary: ReadBoundary,
  restore = false
): Promise<void> {
  await prepare(from, to, sourceBoundary, destinationBoundary, restore)
}

/** Persisted physical fingerprints must name this format; bare legacy hashes are ambiguous. */
export const PHYSICAL_DIGEST_PREFIX = 'physical-v2:'

export async function physicalDigest(from: string, boundary: ReadBoundary): Promise<string> {
  const entries = await inspectPhysicalTree(from, boundary)
  const hash = createHash('sha256').update(`kondo:${PHYSICAL_DIGEST_PREFIX}\0`)
  const size = (length: number): Buffer => {
    const framed = Buffer.alloc(8)
    framed.writeBigUInt64BE(BigInt(length))
    return framed
  }
  const field = (value: string): void => {
    const bytes = Buffer.from(value, 'utf8')
    hash.update(size(bytes.length))
    hash.update(bytes)
  }
  for (const entry of entries.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0)) {
    hash.update(entry.kind === 'directory' ? 'D' : entry.kind === 'file' ? 'F' : 'L')
    field(entry.relative)
    if (entry.kind === 'link') field(entry.link as string)
    if (entry.kind === 'file') {
      hash.update(size(entry.bytes))
      const at = await resolveAllowedPath(path.join(from, entry.relative), boundary)
      const handle = await fs.open(at, 'r')
      try {
        const before = await handle.stat()
        if (!before.isFile() || before.size !== entry.bytes) {
          fail('The recovery source changed while reading it.')
        }
        const buffer = Buffer.allocUnsafe(64 * 1024)
        let observed = 0
        for (;;) {
          const requested = Math.min(buffer.length, entry.bytes - observed + 1)
          const { bytesRead } = await handle.read(buffer, 0, requested, null)
          if (bytesRead === 0) break
          observed += bytesRead
          if (observed > entry.bytes) fail('The recovery source changed while reading it.')
          hash.update(buffer.subarray(0, bytesRead))
        }
        const after = await handle.stat()
        if (observed !== entry.bytes || before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
          fail('The recovery source changed while reading it.')
        }
      } finally {
        await handle.close()
      }
    }
  }
  return hash.digest('hex')
}

/** Preserve link entries through rename or an explicit non-dereferencing EXDEV copy. */
export async function relocateTree(
  from: string,
  to: string,
  sourceBoundary: ReadBoundary,
  destinationBoundary: ReadBoundary,
  restore = false
): Promise<void> {
  const entries = await prepare(from, to, sourceBoundary, destinationBoundary, restore)
  const destination = await resolveAllowedPath(to, destinationBoundary, true)
  const occupied = await fs.lstat(destination).catch((cause: unknown) => {
    if (!isEnoent(cause)) throw cause
    return null
  })
  if (occupied !== null) fail('The relocation destination already exists.')
  if (typeof destinationBoundary === 'string') {
    await fs.mkdir(await resolveAllowedPath(path.dirname(to), destinationBoundary, true), { recursive: true })
  }
  try {
    await fs.rename(
      await physicalPath(from, sourceBoundary),
      await resolveAllowedPath(to, destinationBoundary, true)
    )
    return
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
  }
  // Own the destination exclusively before writing its contents. A handled
  // copy/verification failure removes only this incomplete copy, so undo can
  // never mistake it for saved source bytes. Exact-file exceptions stay exact.
  const root = entries[0]
  if (root === undefined) fail('The relocation source has no directory entry.')
  const linkType = (entry: PhysicalEntry): 'junction' | 'dir' | 'file' =>
    entry.directoryLink ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'
  let owned = false
  let verified = false
  try {
    const target = await resolveAllowedPath(to, destinationBoundary, true)
    if (root.kind === 'directory') {
      await fs.mkdir(target)
      owned = true
    } else if (root.kind === 'link') {
      await fs.symlink(root.link as string, target, linkType(root))
      owned = true
    } else {
      const handle = await fs.open(target, 'wx')
      owned = true
      await handle.close()
    }
    for (const entry of entries) {
      if (entry.relative === '' && entry.kind !== 'file') continue
      const relativeSource = path.join(from, entry.relative)
      const relativeDestination = path.join(to, entry.relative)
      if (entry.kind === 'directory') {
        await fs.mkdir(await resolveAllowedPath(relativeDestination, destinationBoundary, true))
      } else if (entry.kind === 'link') {
        // Junctions need no Windows file-symlink privilege; Node exposes their
        // target text but no reparse-tag API. Directory links retain identity.
        await fs.symlink(entry.link as string,
          await physicalPath(relativeDestination, destinationBoundary, true), linkType(entry))
      } else {
        await fs.copyFile(
          await resolveAllowedPath(relativeSource, sourceBoundary),
          await resolveAllowedPath(relativeDestination, destinationBoundary, true),
          entry.relative === '' ? 0 : constants.COPYFILE_EXCL
        )
      }
    }
    const [before, after] = await Promise.all([
      physicalDigest(from, sourceBoundary), physicalDigest(to, destinationBoundary)
    ])
    if (before !== after) fail('The relocated copy does not match its source; nothing was removed.')
    verified = true
    await inspectPhysicalTree(from, sourceBoundary)
    await fs.rm(await physicalPath(from, sourceBoundary), { recursive: true })
  } catch (cause) {
    // Once verified, the destination may be the only complete copy if removing
    // the source fails partway. Preserve it in that case.
    if (owned && !verified) {
      try {
        await inspectPhysicalTree(to, destinationBoundary)
        await fs.rm(await physicalPath(to, destinationBoundary), { recursive: true, force: true })
      } catch {
        // Keep the original failure; no cleanup may follow an unsafe ancestor.
      }
    }
    throw cause
  }
}
