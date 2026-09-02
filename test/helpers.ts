import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocator, type StoreLocator } from '../electron/main/workspace/locator'
import { flattenProjectPath } from '../electron/main/workspace/projects'

/**
 * Fixture-store builders (docs/testing.md): every test runs against a
 * synthetic tree in a temp directory. Nothing in this file may resolve a
 * real store path.
 */

export interface FixtureWorld {
  base: string
  home: string
  userRoot: string
  desktopRoot: string
  /** `<kondo-data>` for the fixture — outside both stores, as ADR-0001 requires. */
  kondoDataRoot: string
  locator: StoreLocator
  cleanup: () => Promise<void>
}

export async function makeWorld(): Promise<FixtureWorld> {
  // No hyphen in the prefix: the suites that still rely on the fallback
  // guess (rather than `registerProjects`) cannot round-trip one.
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kondotest'))
  const home = path.join(base, 'home')
  const userRoot = path.join(home, '.claude')
  const desktopRoot = path.join(base, 'desktop')
  const kondoDataRoot = path.join(base, 'kondo-data')
  await fs.mkdir(userRoot, { recursive: true })
  await fs.mkdir(desktopRoot, { recursive: true })
  const locator = createLocator({
    home,
    appData: null,
    userData: kondoDataRoot,
    platform: process.platform,
    env: { KONDO_STORE_ROOT: userRoot, KONDO_DESKTOP_STORE_ROOT: desktopRoot }
  })
  return {
    base,
    home,
    userRoot,
    desktopRoot,
    kondoDataRoot,
    locator,
    cleanup: () => fs.rm(base, { recursive: true, force: true })
  }
}

export async function writeFileTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
}

export function writeJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** Flatten an absolute path the way Claude Code names project directories. */
export function flattenPath(absPath: string): string {
  return flattenProjectPath(absPath)
}

/**
 * Register real paths in the fixture's `~/.claude.json`, the way Claude Code
 * does for every directory it has run in (ADR-0009). With this, a project
 * resolves whatever characters its path holds — no hyphen-free tmpdir needed.
 */
export async function registerProjects(world: FixtureWorld, paths: string[]): Promise<void> {
  const projects = Object.fromEntries(paths.map((absPath) => [absPath, {}]))
  await fs.writeFile(world.locator.userConfigFile, writeJson({ projects }), 'utf8')
}

export function skillManifest(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

export function transcriptLine(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`
}

export function healthyTranscript(sessionId: string): string {
  return (
    transcriptLine({ type: 'summary', leafUuid: 'leaf', sessionId }) +
    transcriptLine({
      type: 'user',
      timestamp: '2026-01-01T10:00:00.000Z',
      message: { role: 'user', content: 'hello kondo' }
    }) +
    transcriptLine({
      type: 'assistant',
      timestamp: '2026-01-01T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
    }) +
    transcriptLine({
      type: 'user',
      timestamp: '2026-01-01T10:01:00.000Z',
      message: { role: 'user', content: 'do the thing' }
    })
  )
}

export const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// ---------------------------------------------------------------------------
// Write-path probes (ADR-0001), shared by every mutation suite

/** Names + bytes of a whole tree, so "restored" means byte-for-byte. */
export async function hashTree(root: string): Promise<string> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true })
  const manifest = entries
    .map((entry) => {
      const rel = path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/')
      return entry.isDirectory() ? `${rel}/` : rel
    })
    .sort()
  const hash = createHash('sha256')
  for (const rel of manifest) {
    hash.update(rel)
    if (rel.endsWith('/')) continue
    hash.update(await fs.readFile(path.join(root, ...rel.split('/'))))
  }
  return hash.digest('hex')
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

/** Every fs entry point that can change bytes on disk. */
const WRITE_METHODS = ['open', 'rename', 'writeFile', 'mkdir', 'cp', 'copyFile', 'rm'] as const

/**
 * Wrap — not stub — every write entry point, appending each target to `into`
 * in call order. vi.spyOn replaces the implementation; ordering and boundary
 * proofs need the real call to still happen, so the originals are patched
 * back in by the returned restores.
 */
export function recordWrites(into: string[]): Array<() => void> {
  return WRITE_METHODS.map((method) => {
    const original = fs[method] as (...args: unknown[]) => unknown
    const patched = (...args: unknown[]): unknown => {
      if (typeof args[0] === 'string') into.push(args[0])
      return original(...args)
    }
    Object.defineProperty(fs, method, { value: patched, configurable: true, writable: true })
    return () =>
      Object.defineProperty(fs, method, { value: original, configurable: true, writable: true })
  })
}
