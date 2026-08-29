import path from 'node:path'
import type { DesktopSession, StoreEntry, StoreReport } from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { directorySize, safeReaddir, safeStat, type Collector } from './scan'
import { capabilitiesFor } from './capabilities'
import { tildify } from './display'

/**
 * Desktop-app store adapter. Inventory only: names, sizes, mtimes. Identity
 * and token files (`ant-*`, `buddy-tokens.json`, …) are statted for size
 * like everything else but their contents are never opened (SECURITY.md).
 */

const SESSIONS_DIR = 'local-agent-mode-sessions'
const SESSION_FILE = /^local_(.+)\.json$/
/** Session-support entries that are normal inside an account directory. */
const KNOWN_ACCOUNT_ENTRIES = /^(agent$|artifacts\.json$|cowork-)/

export async function desktopStoreReport(
  locator: StoreLocator,
  c: Collector
): Promise<StoreReport> {
  const root = locator.desktopRoot
  if (!root) return { root: '(unresolved)', exists: false, entries: [], totalBytes: 0 }
  const display = tildify(root, locator.home)
  const info = await safeStat(root, display, c)
  if (!info) return { root: display, exists: false, entries: [], totalBytes: 0 }

  const entries: StoreEntry[] = []
  for (const entry of await safeReaddir(root, display, c)) {
    const child = path.join(root, entry.name)
    const childDisplay = `${display}/${entry.name}`
    const stat = await safeStat(child, childDisplay, c)
    if (!stat) continue
    entries.push({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      bytes: entry.isDirectory() ? await directorySize(child, childDisplay, c) : stat.size,
      mtimeMs: stat.mtimeMs
    })
  }
  entries.sort((a, b) => b.bytes - a.bytes)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  return { root: display, exists: true, entries, totalBytes }
}

export async function desktopSessions(
  locator: StoreLocator,
  c: Collector
): Promise<DesktopSession[]> {
  const root = locator.desktopRoot
  if (!root) return []
  const base = path.join(root, SESSIONS_DIR)
  const baseDisplay = tildify(base, locator.home)
  const sessions: DesktopSession[] = []

  for (const top of await safeReaddir(base, baseDisplay, c)) {
    if (!top.isDirectory()) continue
    const topDir = path.join(base, top.name)
    for (const account of await safeReaddir(topDir, `${baseDisplay}/${top.name}`, c)) {
      if (!account.isDirectory()) continue
      const accountDir = path.join(topDir, account.name)
      const accountDisplay = `${baseDisplay}/${top.name}/${account.name}`
      const entries = await safeReaddir(accountDir, accountDisplay, c)
      const dirNames = new Set(
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      )
      for (const entry of entries) {
        const match = entry.isFile() ? SESSION_FILE.exec(entry.name) : null
        if (!match || match[1] === undefined) {
          const isSidecar = entry.isDirectory() && SESSION_FILE.test(`${entry.name}.json`)
          if (!isSidecar && !KNOWN_ACCOUNT_ENTRIES.test(entry.name)) {
            c.unknown.push(`${accountDisplay}/${entry.name}`)
          }
          continue
        }
        const file = path.join(accountDir, entry.name)
        const stat = await safeStat(file, `${accountDisplay}/${entry.name}`, c)
        if (!stat) continue
        let bytes = stat.size
        const sidecar = entry.name.replace(/\.json$/, '')
        if (dirNames.has(sidecar)) {
          bytes += await directorySize(
            path.join(accountDir, sidecar),
            `${accountDisplay}/${sidecar}`,
            c
          )
        }
        sessions.push({
          id: `session:desktop:${top.name}/${account.name}/${match[1]}`,
          kind: 'session',
          capabilities: capabilitiesFor('session', 'desktop'),
          accountId: account.name,
          name: match[1],
          bytes,
          mtimeMs: stat.mtimeMs
        })
      }
    }
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return sessions
}
