import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppearancePreferences, KondoApi, Scan } from '../../../shared/contract'
import { DEFAULT_THEME, isThemeId } from '../../../shared/themes'
import type { StoreLocator } from './locator'
import { collector, describe, finish, isEnoent, overlapRefusal } from './scan'

const FILE_NAME = 'appearance.json'
const DISPLAY_PATH = '<kondo-data>/appearance.json'

// Reads join writes so a later request cannot overtake a pending selection.
// Keyed by file, including across workspaces sharing one injected app root.
const queues = new Map<string, Promise<void>>()

function serial<T>(file: string, action: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? file.toLowerCase() : file
  const result = (queues.get(key) ?? Promise.resolve()).then(action)
  const tail = result.then(() => {}, () => {})
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return result
}

/** App preferences live outside Claude's stores and never use its mutation journal. */
export function createAppearance(locator: StoreLocator): Pick<KondoApi, 'appearanceGet' | 'appearanceSet'> {
  const root = path.resolve(locator.kondoDataRoot)
  const file = path.join(root, FILE_NAME)
  // Resolved at each call rather than here: a link into a Claude store can
  // appear after this workspace was built (ADR-0001 decision 6). Paths only —
  // this runs before the first window and opens no Claude document.
  const overlaps = (): Promise<string | null> =>
    overlapRefusal(file, DISPLAY_PATH, [locator.userRoot, locator.desktopRoot], locator.home)

  const read = async (): Promise<Scan<AppearancePreferences>> => {
    const c = collector()
    const fallback = { theme: DEFAULT_THEME }
    const refusal = await overlaps()
    if (refusal !== null) {
      c.fail('out-of-store', DISPLAY_PATH, `${refusal} Using Chalk.`)
      return finish(fallback, c)
    }
    let raw: string
    try {
      // A misplaced directory or link is not an appearance document. Do not
      // follow a link into another application's configuration.
      if (!(await fs.lstat(file)).isFile()) {
        c.fail('read-failed', DISPLAY_PATH, 'Appearance preferences must be a regular file. Using Chalk.')
        return finish(fallback, c)
      }
      raw = await fs.readFile(file, 'utf8')
    } catch (cause) {
      if (!isEnoent(cause)) {
        c.fail('read-failed', DISPLAY_PATH, `Could not read appearance preferences. Using Chalk. ${describe(cause)}`)
      }
      return finish(fallback, c)
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
          !('theme' in parsed) || !isThemeId(parsed.theme)) {
        c.fail('parse-failed', DISPLAY_PATH, 'The saved appearance is not recognized. Using Chalk; choose a theme to replace it.')
        return finish(fallback, c)
      }
      return finish({ theme: parsed.theme }, c)
    } catch {
      c.fail('parse-failed', DISPLAY_PATH, 'Appearance preferences contain invalid JSON. Using Chalk; choose a theme to replace it.')
      return finish(fallback, c)
    }
  }

  return {
    appearanceGet: () => serial(file, read),
    appearanceSet: (theme) => serial(file, async () => {
      const previous = await read()
      if (!isThemeId(theme)) {
        return {
          ...previous,
          errors: [...previous.errors, {
            code: 'bad-request', path: '(appearance)', message: 'Choose one of Kondo’s listed themes.'
          }]
        }
      }
      // Checked again immediately before the write: `read` above yields, and
      // its refusal is already the first error in `previous`.
      if (await overlaps() !== null) return previous

      const temporary = path.join(root, `.appearance-${randomUUID()}.tmp`)
      let temporaryCreated = false
      try {
        await fs.mkdir(root, { recursive: true })
        // Same-directory rename publishes complete JSON at once. Exclusive
        // creation avoids collisions and never truncates the previous file.
        const handle = await fs.open(temporary, 'wx', 0o600)
        temporaryCreated = true
        try {
          await handle.writeFile(`${JSON.stringify({ theme }, null, 2)}\n`, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.rename(temporary, file)
        return { data: { theme }, errors: [], unknown: [] }
      } catch (cause) {
        return {
          ...previous,
          errors: [...previous.errors, {
            code: 'write-failed', path: DISPLAY_PATH,
            message: `Could not save the theme. Your previous preference was kept. ${describe(cause)}`
          }]
        }
      } finally {
        // Never remove the destination or recurse. An interrupted process can
        // leave only its own harmless temporary; it is never read as a preference.
        if (temporaryCreated) await fs.rm(temporary, { force: true }).catch(() => {})
      }
    })
  }
}
