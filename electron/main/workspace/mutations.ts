import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
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
 */

// ---------------------------------------------------------------------------
// What a caller plans

export type PlannedStep =
  /** Rename inside one store. Refused when the destination already exists. */
  | { type: 'move'; store: string; from: string; to: string }
  /** Displace into `<kondo-data>/trash/<journal-id>/`; never an unlink. */
  | { type: 'trash'; store: string; from: string }
  /** Write a file, keeping any bytes it displaces. */
  | { type: 'write'; store: string; at: string; content: string }

export interface MutationPlan {
  op: JournalOp
  kind: string
  /** The ADR-0008 id of the entity being changed. */
  entityId: string
  summary: string
  steps: PlannedStep[]
}

// ---------------------------------------------------------------------------
// What the journal records

interface JournalStep {
  type: 'move' | 'trash' | 'write'
  /** Named store root; the journal never holds an absolute path. */
  store: string
  /** Source (`move`, `trash`) or target (`write`), relative to `store`. */
  from: string
  /** Destination of a `move`, relative to `store`. */
  to?: string
  /** Path under `<kondo-data>/trash/<id>/` holding the displaced bytes. */
  displaced?: string
  /** Store-relative directories this step created, deepest first. */
  created?: string[]
}

interface JournalRecord {
  id: string
  at: string
  op: JournalOp
  kind: string
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

export function createMutations(locator: StoreLocator, now: () => number = Date.now): Mutations {
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

  const resolveIn = (store: string, relative: string): string => {
    const root = roots.get(store)
    if (root === undefined) {
      throw new Refused('out-of-store', store, `Unknown store root "${store}".`)
    }
    const target = path.resolve(root, relative)
    if (!pathWithin(target, root)) {
      throw new Refused('out-of-store', relative, 'A step may not leave its store root.')
    }
    return target
  }

  const trashPath = (journalId: string, displaced: string): string =>
    path.join(trashRoot, journalId, ...displaced.split('/'))

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
  const missingAncestors = async (target: string, store: string): Promise<string[]> => {
    const root = roots.get(store) as string
    const made: string[] = []
    let current = path.dirname(target)
    while (pathWithin(current, root) && !(await exists(current))) {
      made.push(path.relative(root, current).split(path.sep).join('/'))
      current = path.dirname(current)
    }
    return made
  }

  /** Move that survives a store and `<kondo-data>` on different volumes. */
  const relocate = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(path.dirname(to), { recursive: true })
    try {
      await fs.rename(from, to)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
      // Copy, verify, then release the source — ADR-0001's move recipe.
      await fs.cp(from, to, { recursive: true })
      if (!(await exists(to))) throw cause
      await fs.rm(from, { recursive: true })
    }
  }

  /** Remove directories a step created, only while they are still empty. */
  const dropCreated = async (created: string[] | undefined, store: string): Promise<void> => {
    for (const relative of created ?? []) {
      try {
        await fs.rmdir(resolveIn(store, relative))
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

  const misconfigured = (): Scan<JournalEntryInfo | null> =>
    refuse(
      'bad-request',
      kondoData,
      `Kondo's data directory sits inside the store at ${nested} — refusing to write (ADR-0001).`
    )

  // -------------------------------------------------------------------------
  // Execution

  const runSteps = async (
    journalId: string,
    planned: PlannedStep[],
    steps: JournalStep[]
  ): Promise<void> => {
    for (const [index, step] of steps.entries()) {
      if (step.type === 'move') {
        await fs.mkdir(path.dirname(resolveIn(step.store, step.to as string)), { recursive: true })
        await relocate(resolveIn(step.store, step.from), resolveIn(step.store, step.to as string))
      } else if (step.type === 'trash') {
        await relocate(
          resolveIn(step.store, step.from),
          trashPath(journalId, step.displaced as string)
        )
      } else {
        const target = resolveIn(step.store, step.from)
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
      const target = resolveIn(step.store, relative)
      const displaced = `${step.store}/${relative}`

      if (step.type === 'move') {
        const destination = resolveIn(step.store, step.to)
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
          created: await missingAncestors(destination, step.store)
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
          created: await missingAncestors(target, step.store)
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
        // before the failure is reversible through `undo`.
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
      // Reversing a `write` displaces the bytes kondo wrote, so the undo has
      // journal steps of its own and its own trash directory.
      const steps: JournalStep[] = original.steps
        .filter((step) => step.type === 'write')
        .map((step) => ({
          type: 'trash' as const,
          store: step.store,
          from: step.from,
          displaced: `${step.store}/${step.from}`
        }))
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
              resolveIn(step.store, step.to as string),
              resolveIn(step.store, step.from)
            )
          } else if (step.type === 'trash') {
            await relocate(
              trashPath(original.id, step.displaced as string),
              resolveIn(step.store, step.from)
            )
          } else {
            const target = resolveIn(step.store, step.from)
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
          await dropCreated(step.created, step.store)
        }
      }

      try {
        await write(record, act)
      } catch (cause) {
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

    async trashSize(): Promise<Scan<TrashReport>> {
      const c = collector()
      const display = tildify(trashRoot, locator.home)
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
  }
}
