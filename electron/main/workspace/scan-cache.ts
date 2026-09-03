import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * The tier-2 scan cache ADR-0007 decided on: what a transcript read cost is
 * kept under `<kondo-data>` keyed by `(path, size, mtime)`, so a file that
 * has not changed is never parsed twice and one that has always is.
 *
 * It holds no Claude truth (ADR-0006) — only a copy of what the store already
 * says — so it is disposable by design: deleting it costs re-parsing and
 * nothing else. That is also why nothing here reports into a collector. A
 * cache that cannot be read or written is a slower answer, never a wrong one,
 * and a "problem" raised over one would be a lie about the data (ADR-0005).
 *
 * The file is kondo's own, never a store's, so it is the one place in the
 * app that keeps absolute paths.
 */

/** Bumped whenever the shape of a cached value changes; older files are dropped. */
const VERSION = 1

interface CacheEntry {
  size: number
  mtimeMs: number
  value: unknown
}

interface CacheFile {
  version: number
  entries: Record<string, CacheEntry>
}

export interface ScanCache<T> {
  /**
   * What was cached for this file, or null when it is absent or either half
   * of the key moved on. Exact equality on both: a byte-identical rewrite
   * still changes the mtime, and that is a miss.
   */
  get(file: string, size: number, mtimeMs: number): T | null
  set(file: string, size: number, mtimeMs: number, value: T): void
  /** Persist what `set` added; a no-op when nothing did. */
  save(): Promise<void>
}

/**
 * Open one named cache under `<kondo-data>/scan-cache/`. One file per name,
 * so a namespace whose values change shape is dropped on its own rather than
 * taking every other namespace with it.
 */
export async function openScanCache<T>(
  kondoDataRoot: string,
  name: string
): Promise<ScanCache<T>> {
  const dir = path.join(kondoDataRoot, 'scan-cache')
  const file = path.join(dir, `${name}.json`)
  const entries = await read(file)
  let dirty = false

  return {
    get(target, size, mtimeMs) {
      const entry = entries[target]
      if (!entry || entry.size !== size || entry.mtimeMs !== mtimeMs) return null
      return entry.value as T
    },
    set(target, size, mtimeMs, value) {
      entries[target] = { size, mtimeMs, value }
      dirty = true
    },
    async save() {
      if (!dirty) return
      dirty = false
      const body: CacheFile = { version: VERSION, entries }
      // Written aside and renamed: a half-written file is exactly what makes
      // the next read unparseable, and this cache outlives the process.
      const temporary = `${file}.${process.pid}.tmp`
      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(temporary, JSON.stringify(body), 'utf8')
        await fs.rename(temporary, file)
      } catch {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
      }
    }
  }
}

/** Whatever the file holds, or an empty cache — never a throw. */
async function read(file: string): Promise<Record<string, CacheEntry>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const body = parsed as Partial<CacheFile>
  if (body.version !== VERSION || typeof body.entries !== 'object' || body.entries === null) {
    return {}
  }
  const entries: Record<string, CacheEntry> = {}
  for (const [key, entry] of Object.entries(body.entries)) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as CacheEntry).size === 'number' &&
      typeof (entry as CacheEntry).mtimeMs === 'number'
    ) {
      entries[key] = entry as CacheEntry
    }
  }
  return entries
}
