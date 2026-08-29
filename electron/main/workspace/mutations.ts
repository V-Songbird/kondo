import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  EntityKind,
  JournalEntryInfo,
  JournalOp,
  Scan,
  ScanErrorCode,
  TrashReport
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import { collector, describe, directorySize, finish, isEnoent, pathWithin } from './scan'
import { tildify } from './display'

/**
 * The write path (ADR-0001): every mutation is journaled durably before the
 * store is touched, nothing is unlinked, and `undo` puts it all back. Every
 * future write feature goes through `mutate` rather than calling fs itself.
 *
 * Paths never come from a caller as absolutes: a step names a store root and
 * a path relative to it, and `resolveIn` refuses anything that escapes.
 *
 * `user` and `desktop` are fixed by the locator. Any other name is resolved
 * by `extraRoot` — the workspace's project stores, which are discovered per
 * scan and cannot be known here (ADR-0003).
 */

/** Resolves a store name the locator does not fix; null when unknown. */
export type ExtraRoot = (store: string) => Promise<string | null>

// ---------------------------------------------------------------------------
// What a caller plans

export type PlannedStep =
  /** Rename inside one store. Refused when the destination already exists. */
  | { type: 'move'; store: string; from: string; to: string }
  /**
   * Copy into another store, leaving the source alone. The copy is verified
   * against the source before the step is allowed to succeed, so a later
   * `trash` of the same source can never be the thing that loses it
   * (ADR-0001's copy → verify → trash recipe). Refused when the destination
   * already exists.
   */
  | { type: 'copy'; store: string; from: string; toStore: string; to: string }
  /** Displace into `<kondo-data>/trash/<journal-id>/`; never an unlink. */
  | { type: 'trash'; store: string; from: string }
  /** Write a file, keeping any bytes it displaces. */
  | { type: 'write'; store: string; at: string; content: string }

export interface MutationPlan {
  op: JournalOp
  /** The registry kind this plan acts on (`kinds.ts`). */
  kind: EntityKind
  /** The ADR-0008 id of the entity being changed. */
  entityId: string
  summary: string
  steps: PlannedStep[]
}

// ---------------------------------------------------------------------------
// What the journal records

interface JournalStep {
  type: 'move' | 'copy' | 'trash' | 'write'
  /** Named store root of the source; the journal holds no absolute path. */
  store: string
  /** Source (`move`, `copy`, `trash`) or target (`write`), under `store`. */
  from: string
  /** Destination of a `move` or `copy`, relative to `toStore`. */
  to?: string
  /** Store the destination of a `copy` lands in; absent means `store`. */
  toStore?: string
  /** Path under `<kondo-data>/trash/<id>/` holding the displaced bytes. */
  displaced?: string
  /** Directories this step created under `createdIn`, deepest first. */
  created?: string[]
}

/** The store `created` is relative to — the destination for a `copy`. */
const createdIn = (step: JournalStep): string => step.toStore ?? step.store

interface JournalRecord {
  id: string
  at: string
  op: JournalOp
  kind: EntityKind
  entityId: string
  summary: string
  steps: JournalStep[]
  /** Journal id this entry reverses, when it is itself an undo. */
  undoOf: string | null
}

const ID_PREFIX = 'journal:'

export interface Mutations {
  /** Journal, then act. The only way anything in this app writes. */
  mutate(plan: MutationPlan): Promise<Scan<JournalEntryInfo | null>>
  /** Reverse one entry by its `journal:<id>`; the undo is itself journaled. */
  undo(journalId: string): Promise<Scan<JournalEntryInfo | null>>
  list(): Promise<Scan<JournalEntryInfo[]>>
  trashSize(): Promise<Scan<TrashReport>>
  /**
   * Remove the trash's contents for good — ADR-0001's only destructive act,
   * and the only method here that ever unlinks a store's bytes. It is its
   * own operation on purpose: nothing in `mutate` or `undo` calls it.
   */
  emptyTrash(): Promise<Scan<TrashReport>>
}

/** A refusal that happens before anything is written; carries its seam code. */
class Refused extends Error {
  constructor(
    readonly code: ScanErrorCode,
    readonly at: string,
    message: string
  ) {
    super(message)
  }
}

export function createMutations(
  locator: StoreLocator,
  now: () => number = Date.now,
  extraRoot: ExtraRoot = () => Promise.resolve(null)
): Mutations {
  const kondoData = locator.kondoDataRoot
  const journalFile = path.join(kondoData, 'journal.jsonl')
  const trashRoot = path.join(kondoData, 'trash')

  const roots = new Map<string, string>([['user', locator.userRoot]])
  if (locator.desktopRoot) roots.set('desktop', locator.desktopRoot)

  // ADR-0001 decision 6: kondo's trash inside a store would show up in
  // kondo's own scan, and a sweep could trash its own undo history.
  const nested = [...roots.values()].find(
    (root) => kondoData === root || pathWithin(kondoData, root)
  )

  // -------------------------------------------------------------------------
  // Paths

  const rootOf = async (store: string): Promise<string> => {
    const fixed = roots.get(store)
    if (fixed !== undefined) return fixed
    const dynamic = await extraRoot(store)
    if (dynamic === null) {
      throw new Refused('out-of-store', store, `Unknown store root "${store}".`)
    }
    // ADR-0001 decision 6, for a root the locator did not fix at startup.
    if (kondoData === dynamic || pathWithin(kondoData, dynamic)) {
      throw new Refused(
        'out-of-store',
        store,
        `Kondo's data directory sits inside "${store}" — refusing to write (ADR-0001).`
      )
    }
    return dynamic
  }

  const resolveIn = async (store: string, relative: string): Promise<string> => {
    const root = await rootOf(store)
    const target = path.resolve(root, relative)
    if (!pathWithin(target, root)) {
      throw new Refused('out-of-store', relative, 'A step may not leave its store root.')
    }
    return target
  }

  // A project store is named `project:<dirName>` and no Windows path segment
  // may hold a colon, so the trash spells it with a dash. The journal keeps
  // the real store name; both the write and its undo come through here, so
  // the two always agree on where the displaced bytes went.
  const trashPath = (journalId: string, displaced: string): string =>
    path.join(trashRoot, journalId, ...displaced.replaceAll(':', '-').split('/'))

  const exists = async (target: string): Promise<boolean> => {
    try {
      await fs.stat(target)
      return true
    } catch (cause) {
      if (isEnoent(cause)) return false
      throw cause
    }
  }

  /** Directories that must be created to hold `target`, deepest first. */
  const missingAncestors = async (target: string, root: string): Promise<string[]> => {
    const made: string[] = []
    let current = path.dirname(target)
    while (pathWithin(current, root) && !(await exists(current))) {
      made.push(path.relative(root, current).split(path.sep).join('/'))
      current = path.dirname(current)
    }
    return made
  }

  /**
   * A tree reduced to one hash: every relative name in sorted order, and the
   * bytes of every file. Two trees with the same digest hold the same skill.
   */
  const digestTree = async (root: string): Promise<string> => {
    const hash = createHash('sha256')
    if (!(await fs.stat(root)).isDirectory()) {
      hash.update(await fs.readFile(root))
      return hash.digest('hex')
    }
    const names = (await fs.readdir(root, { withFileTypes: true, recursive: true }))
      .map((entry) => {
        const relative = path
          .relative(root, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join('/')
        return entry.isDirectory() ? `${relative}/` : relative
      })
      .sort()
    for (const relative of names) {
      hash.update(relative)
      if (relative.endsWith('/')) continue
      hash.update(await fs.readFile(path.join(root, ...relative.split('/'))))
    }
    return hash.digest('hex')
  }

  /**
   * ADR-0001's `verify`: the destination is proven to hold the source's bytes
   * before anything releases the source. A read that throws is a failure too
   * — the answer to "is this copy good?" is only ever yes on proof.
   */
  const verifyCopy = async (from: string, to: string): Promise<string | null> => {
    try {
      const [source, destination] = await Promise.all([digestTree(from), digestTree(to)])
      if (source === destination) return null
      return `The copy at ${path.basename(to)} does not match its source; nothing was removed.`
    } catch (cause) {
      return `The copy could not be verified (${describe(cause)}); nothing was removed.`
    }
  }

  /** Move that survives a store and `<kondo-data>` on different volumes. */
  const relocate = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(path.dirname(to), { recursive: true })
    try {
      await fs.rename(from, to)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
      // Copy, verify, then release the source — ADR-0001's move recipe. A
      // project on one volume and `<kondo-data>` on another is ordinary, so
      // this path carries the same proof the `copy` step does.
      await fs.cp(from, to, { recursive: true })
      const unverified = await verifyCopy(from, to)
      if (unverified !== null) throw new Refused('read-failed', to, unverified)
      await fs.rm(from, { recursive: true })
    }
  }

  /** Remove directories a step created, only while they are still empty. */
  const dropCreated = async (created: string[] | undefined, store: string): Promise<void> => {
    for (const relative of created ?? []) {
      try {
        await fs.rmdir(await resolveIn(store, relative))
      } catch {
        // Not empty any more, or already gone: leaving it is always safe.
      }
    }
  }

  // -------------------------------------------------------------------------
  // Journal file

  const appendJournal = async (record: JournalRecord): Promise<void> => {
    await fs.mkdir(kondoData, { recursive: true })
    const handle = await fs.open(journalFile, 'a')
    try {
      await handle.write(`${JSON.stringify(record)}\n`)
      // The invariant is ordering, not best effort: the entry is on the
      // platter before a single store byte moves.
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const readJournal = async (): Promise<{ records: JournalRecord[]; scan: Scan<null> }> => {
    const c = collector()
    let raw: string
    try {
      raw = await fs.readFile(journalFile, 'utf8')
    } catch (cause) {
      if (!isEnoent(cause)) c.fail('read-failed', 'journal.jsonl', cause)
      return { records: [], scan: finish(null, c) }
    }
    const records: JournalRecord[] = []
    for (const [index, line] of raw.split('\n').entries()) {
      if (line.trim() === '') continue
      try {
        records.push(JSON.parse(line) as JournalRecord)
      } catch (cause) {
        // ADR-0005: one bad line costs that line, never the whole history.
        c.fail('parse-failed', `journal.jsonl:${index + 1}`, cause)
      }
    }
    return { records, scan: finish(null, c) }
  }

  const toInfo = (record: JournalRecord, undoneBy: string | null): JournalEntryInfo => ({
    id: `${ID_PREFIX}${record.id}`,
    at: record.at,
    op: record.op,
    kind: record.kind,
    entityId: record.entityId,
    summary: record.summary,
    stepCount: record.steps.length,
    undoneBy,
    isUndo: record.undoOf !== null
  })

  /** `undoneBy` is derived from the undo entries, so the file stays append-only. */
  const undoLinks = (records: JournalRecord[]): Map<string, string> => {
    const links = new Map<string, string>()
    for (const record of records) {
      if (record.undoOf) links.set(record.undoOf, `${ID_PREFIX}${record.id}`)
    }
    return links
  }

  const refuse = (code: ScanErrorCode, at: string, message: string): Scan<JournalEntryInfo | null> => ({
    data: null,
    errors: [{ code, path: at, message }],
    unknown: []
  })

  const nestedMessage = (): string =>
    `Kondo's data directory sits inside the store at ${nested} — refusing to write (ADR-0001).`

  const misconfigured = (): Scan<JournalEntryInfo | null> =>
    refuse('bad-request', kondoData, nestedMessage())

  const trashDisplay = (): string => tildify(trashRoot, locator.home)

  /** What the trash holds right now: its size and how many entries hold it. */
  const readTrash = async (): Promise<Scan<TrashReport>> => {
    const c = collector()
    const display = trashDisplay()
    let entryCount = 0
    try {
      const entries = await fs.readdir(trashRoot, { withFileTypes: true })
      entryCount = entries.filter((entry) => entry.isDirectory()).length
    } catch (cause) {
      if (!isEnoent(cause)) c.fail('read-failed', display, cause)
    }
    const bytes = await directorySize(trashRoot, display, c)
    return finish({ root: display, bytes, entryCount }, c)
  }

  // -------------------------------------------------------------------------
  // Execution

  const runSteps = async (
    journalId: string,
    planned: PlannedStep[],
    steps: JournalStep[]
  ): Promise<void> => {
    for (const [index, step] of steps.entries()) {
      if (step.type === 'move') {
        const destination = await resolveIn(step.store, step.to as string)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await relocate(await resolveIn(step.store, step.from), destination)
      } else if (step.type === 'copy') {
        const toStore = step.toStore as string
        const source = await resolveIn(step.store, step.from)
        const destination = await resolveIn(toStore, step.to as string)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.cp(source, destination, { recursive: true })
        const unverified = await verifyCopy(source, destination)
        if (unverified !== null) {
          // The half-copy is kondo's own doing and the source has not been
          // touched, so it goes to this entry's trash rather than an unlink,
          // and the step fails before anything can release the original.
          await relocate(destination, trashPath(journalId, `${toStore}/${step.to}`))
          throw new Refused('read-failed', step.to as string, unverified)
        }
      } else if (step.type === 'trash') {
        await relocate(
          await resolveIn(step.store, step.from),
          trashPath(journalId, step.displaced as string)
        )
      } else {
        const target = await resolveIn(step.store, step.from)
        if (step.displaced) {
          await fs.mkdir(path.dirname(trashPath(journalId, step.displaced)), { recursive: true })
          await fs.cp(target, trashPath(journalId, step.displaced), { recursive: true })
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, (planned[index] as { content: string }).content, 'utf8')
      }
    }
  }

  const planSteps = async (journalId: string, planned: PlannedStep[]): Promise<JournalStep[]> => {
    const steps: JournalStep[] = []
    for (const step of planned) {
      const relative = step.type === 'write' ? step.at : step.from
      const target = await resolveIn(step.store, relative)
      const root = await rootOf(step.store)
      const displaced = `${step.store}/${relative}`

      if (step.type === 'move') {
        const destination = await resolveIn(step.store, step.to)
        if (!(await exists(target))) {
          throw new Refused('read-failed', relative, 'Nothing to move at that path.')
        }
        if (await exists(destination)) {
          throw new Refused('bad-request', step.to, 'The destination already exists.')
        }
        steps.push({
          type: 'move',
          store: step.store,
          from: relative,
          to: step.to,
          created: await missingAncestors(destination, root)
        })
      } else if (step.type === 'copy') {
        const destination = await resolveIn(step.toStore, step.to)
        if (!(await exists(target))) {
          throw new Refused('read-failed', relative, 'Nothing to copy at that path.')
        }
        if (await exists(destination)) {
          throw new Refused('bad-request', step.to, 'The destination already exists.')
        }
        steps.push({
          type: 'copy',
          store: step.store,
          from: relative,
          to: step.to,
          toStore: step.toStore,
          created: await missingAncestors(destination, await rootOf(step.toStore))
        })
      } else if (step.type === 'trash') {
        if (!(await exists(target))) {
          throw new Refused('read-failed', relative, 'Nothing to trash at that path.')
        }
        steps.push({ type: 'trash', store: step.store, from: relative, displaced })
      } else {
        const had = await exists(target)
        steps.push({
          type: 'write',
          store: step.store,
          from: relative,
          ...(had ? { displaced } : {}),
          created: await missingAncestors(target, root)
        })
      }
    }
    return steps
  }

  const newId = (): string =>
    `${now().toString(36).padStart(9, '0')}-${randomUUID().slice(0, 8)}`

  const write = async (record: JournalRecord, act: () => Promise<void>): Promise<void> => {
    await appendJournal(record)
    await act()
  }

  return {
    async mutate(plan: MutationPlan): Promise<Scan<JournalEntryInfo | null>> {
      if (nested) return misconfigured()
      const id = newId()
      let steps: JournalStep[]
      try {
        steps = await planSteps(id, plan.steps)
      } catch (cause) {
        if (cause instanceof Refused) return refuse(cause.code, cause.at, cause.message)
        return refuse('read-failed', plan.entityId, describe(cause))
      }

      const record: JournalRecord = {
        id,
        at: new Date(now()).toISOString(),
        op: plan.op,
        kind: plan.kind,
        entityId: plan.entityId,
        summary: plan.summary,
        steps,
        undoOf: null
      }
      try {
        await write(record, () => runSteps(id, plan.steps, steps))
      } catch (cause) {
        // The entry may already be on disk; that is the point — whatever ran
        // before the failure is reversible through `undo`. A step that
        // refused (an unverified copy) carries its own reason and code.
        if (cause instanceof Refused) return refuse(cause.code, cause.at, cause.message)
        return refuse('read-failed', plan.entityId, describe(cause))
      }
      return { data: toInfo(record, null), errors: [], unknown: [] }
    },

    async undo(journalId: string): Promise<Scan<JournalEntryInfo | null>> {
      if (nested) return misconfigured()
      if (typeof journalId !== 'string' || !journalId.startsWith(ID_PREFIX)) {
        return refuse('bad-request', String(journalId), 'undo expects a journal: id.')
      }
      const key = journalId.slice(ID_PREFIX.length)
      const { records, scan } = await readJournal()
      const original = records.find((record) => record.id === key)
      if (!original) {
        return {
          data: null,
          errors: [
            ...scan.errors,
            {
              code: 'unknown-id',
              path: journalId,
              message: 'No journal entry with that id.'
            }
          ],
          unknown: scan.unknown
        }
      }
      if (original.undoOf !== null) {
        return refuse('bad-request', journalId, 'An undo entry cannot itself be undone.')
      }
      if (undoLinks(records).has(key)) {
        return refuse('bad-request', journalId, 'That entry has already been undone.')
      }

      const id = newId()
      // Reversing a `write` or a `copy` displaces bytes kondo itself put
      // there, so the undo has journal steps of its own and its own trash
      // directory. A `move` and a `trash` only put back what was already
      // recorded, and add nothing here.
      const steps: JournalStep[] = original.steps.flatMap((step) => {
        if (step.type === 'write') {
          return [
            {
              type: 'trash' as const,
              store: step.store,
              from: step.from,
              displaced: `${step.store}/${step.from}`
            }
          ]
        }
        if (step.type === 'copy') {
          const store = step.toStore as string
          const from = step.to as string
          return [{ type: 'trash' as const, store, from, displaced: `${store}/${from}` }]
        }
        return []
      })
      const record: JournalRecord = {
        id,
        at: new Date(now()).toISOString(),
        op: original.op,
        kind: original.kind,
        entityId: original.entityId,
        summary: `Undo: ${original.summary}`,
        steps,
        undoOf: key
      }

      const act = async (): Promise<void> => {
        for (const step of [...original.steps].reverse()) {
          if (step.type === 'move') {
            await relocate(
              await resolveIn(step.store, step.to as string),
              await resolveIn(step.store, step.from)
            )
          } else if (step.type === 'copy') {
            // The source came back on the reversed `trash` step before this
            // one, so the copy is now the spare. It is displaced into the
            // undo's own trash, never unlinked — and it may not be there at
            // all if the copy is what failed.
            const destination = await resolveIn(step.toStore as string, step.to as string)
            if (await exists(destination)) {
              await relocate(destination, trashPath(id, `${step.toStore}/${step.to}`))
            }
          } else if (step.type === 'trash') {
            await relocate(
              trashPath(original.id, step.displaced as string),
              await resolveIn(step.store, step.from)
            )
          } else {
            const target = await resolveIn(step.store, step.from)
            // Nothing is destroyed: the current bytes go to the undo's trash
            // before whatever they displaced comes back.
            if (await exists(target)) {
              await relocate(target, trashPath(id, `${step.store}/${step.from}`))
            }
            if (step.displaced) {
              await fs.mkdir(path.dirname(target), { recursive: true })
              await fs.cp(trashPath(original.id, step.displaced), target, { recursive: true })
            }
          }
          await dropCreated(step.created, createdIn(step))
        }
      }

      try {
        await write(record, act)
      } catch (cause) {
        // The commonest way an undo fails is the one worth a sentence rather
        // than an errno: its displaced bytes were emptied out of the trash.
        // Emptying is the single thing undo cannot survive (ADR-0001), so
        // say that instead of handing the UI a raw rename failure.
        if (isEnoent(cause)) {
          return refuse(
            'read-failed',
            journalId,
            "The files this entry would put back are no longer in kondo's trash — it was emptied, and emptying is the one thing undo cannot survive."
          )
        }
        return refuse('read-failed', journalId, describe(cause))
      }
      return { data: toInfo(record, null), errors: scan.errors, unknown: scan.unknown }
    },

    async list(): Promise<Scan<JournalEntryInfo[]>> {
      const { records, scan } = await readJournal()
      const links = undoLinks(records)
      const entries = records
        .map((record) => toInfo(record, links.get(record.id) ?? null))
        .reverse()
      return { data: entries, errors: scan.errors, unknown: scan.unknown }
    },

    trashSize(): Promise<Scan<TrashReport>> {
      return readTrash()
    },

    /**
     * ADR-0001's only destructive act. It removes `<kondo-data>/trash/` and
     * nothing else — no store, and not the `journal.jsonl` sitting beside
     * it, so the history stays readable after the bytes it could restore
     * are gone. Every other method above only ever displaces.
     *
     * Deliberately not journaled: an entry claiming an undo that cannot
     * happen is the one lie the journal must not tell.
     */
    async emptyTrash(): Promise<Scan<TrashReport>> {
      if (nested) {
        return {
          data: { root: trashDisplay(), bytes: 0, entryCount: 0 },
          errors: [{ code: 'bad-request', path: kondoData, message: nestedMessage() }],
          unknown: []
        }
      }
      const before = await readTrash()
      const c = collector()
      try {
        await fs.rm(trashRoot, { recursive: true, force: true })
      } catch (cause) {
        c.fail('read-failed', before.data.root, cause)
      }
      // A recursive remove can stop half way, so what went is the difference
      // between the two measurements — never what was asked for.
      const after = await readTrash()
      return {
        data: {
          root: before.data.root,
          bytes: Math.max(0, before.data.bytes - after.data.bytes),
          entryCount: Math.max(0, before.data.entryCount - after.data.entryCount)
        },
        errors: [...before.errors, ...c.errors, ...after.errors],
        unknown: [...before.unknown, ...after.unknown]
      }
    }
  }
}
