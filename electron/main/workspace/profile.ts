import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ClaudeProfile, Scan } from '../../../shared/contract'
import { tildify } from './display'
import { storeSetIdentity, type StoreLocator } from './locator'
import { isEnoent, overlapRefusal } from './scan'

/**
 * The Claude profile this process reads, and the record that keeps one data
 * root serving one profile. The selection itself is the locator's (ADR-0003);
 * this module only describes it for the renderer and guards Kondo's own data
 * root. Nothing here reads or writes a Claude store.
 */

/** Names the store set a data root serves; written once, then only read. */
const RECORD_FILE = 'stores.json'

/** What a launch would have to change to select another profile. */
const WINNER: Record<'fixture' | 'argument', string> = {
  fixture: 'KONDO_STORE_ROOT',
  argument: '--claude-config-dir'
}

/**
 * The profile as the renderer sees it: a display path and sentences, never a
 * path it could hand back (ADR-0008). Fixed for the life of the process.
 */
export function describeProfile(locator: StoreLocator): Scan<ClaudeProfile> {
  const { source, ignored } = locator.profile
  const winner = source === 'fixture' || source === 'argument' ? WINNER[source] : null
  return {
    data: {
      source,
      root: tildify(locator.userRoot, locator.home),
      ignored: ignored.map((selection) =>
        selection.reason === 'not-absolute'
          ? `Kondo is not using ${selection.setting}: it is not an absolute path.`
          : `Kondo is not using ${selection.setting} (${tildify(selection.root, locator.home)}): ${winner ?? 'another selection'} takes precedence.`
      )
    },
    errors: [],
    unknown: []
  }
}

/**
 * Claim `<kondo-data>` for this launch's store set, or refuse the launch in one
 * sentence. A journal step names a store rather than a root (ADR-0001), so a
 * journal and trash that already serve one profile must never be handed a
 * second one: an Undo would restore into the wrong store. The first launch
 * records the set; a launch with another set is refused before a workspace
 * exists, and nothing is migrated (ADR-0004).
 *
 * This is the earliest write kondo itself makes into `<kondo-data>` — before
 * the workspace and before any window — so it is also where a data root that
 * resolves inside a Claude store is refused, before `stores.json` could be
 * written into one (ADR-0001 decision 6).
 *
 * The record itself is read and written synchronously on purpose: it runs once
 * at startup, where there is no other Kondo process to race.
 */
export async function claimDataRoot(locator: StoreLocator, platform: NodeJS.Platform): Promise<string | null> {
  const root = locator.kondoDataRoot
  const file = path.join(root, RECORD_FILE)
  const display = tildify(file, locator.home)
  const overlap = await overlapRefusal(
    file, '<kondo-data>/stores.json', [locator.userRoot, locator.desktopRoot], locator.home
  )
  if (overlap !== null) return overlap
  const identity = JSON.stringify(storeSetIdentity(locator, platform))

  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    if (!isEnoent(cause)) {
      return `Kondo could not read ${display}, which records the Claude profile this data folder keeps history for. Nothing was changed.`
    }
    // `userRoot` is the spelling a person reads back in a refusal; `stores` is
    // what a later launch is compared against. Same-directory rename publishes
    // the whole record at once, so an interrupted first launch leaves no half.
    const record = { version: 1, stores: storeSetIdentity(locator, platform), userRoot: locator.userRoot }
    const temporary = path.join(root, `.${RECORD_FILE}-${randomUUID()}.tmp`)
    try {
      mkdirSync(root, { recursive: true })
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, file)
      return null
    } catch {
      return `Kondo could not record the Claude profile this data folder keeps history for (${display}). Nothing was changed.`
    }
  }

  let record: { stores?: unknown; userRoot?: unknown }
  try {
    record = (JSON.parse(text) ?? {}) as { stores?: unknown; userRoot?: unknown }
  } catch {
    record = {}
  }
  if (!Array.isArray(record.stores) || typeof record.userRoot !== 'string') {
    return `${display} is damaged, so Kondo cannot tell which Claude profile this data folder keeps history for. Nothing was changed.`
  }
  if (JSON.stringify(record.stores) === identity) return null
  return `This Kondo data folder (${tildify(root, locator.home)}) keeps the history of another Claude profile (${tildify(record.userRoot, locator.home)}). Nothing was changed. Give this profile a data folder of its own, or start Kondo without KONDO_DATA_ROOT, so one Undo history never serves two profiles.`
}
