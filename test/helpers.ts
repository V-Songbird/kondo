import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocator, type StoreLocator } from '../electron/main/workspace/locator'

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
  // No hyphen in the prefix: several tests flatten/unflatten real fixture
  // paths, and '-' is the one character the flattening cannot round-trip.
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
  if (process.platform === 'win32') {
    return absPath.replace(/^([A-Za-z]):\\/, '$1--').replaceAll('\\', '-')
  }
  return absPath.replaceAll('/', '-')
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
