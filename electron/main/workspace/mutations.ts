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
import {
  collector,
  describe,
  digestTree,
  directorySize,
  finish,
  isEnoent,
  pathWithin
} from './scan'
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

/**
 * The store name `~/.claude.json` answers to (ADR-0003, ADR-0010). Its root
 * is the directory the file sits in, and a step in it may name that one file
 * and nothing else — the home directory is not a store.
 */
export const USER_CONFIG_STORE = 'user-config'

// ---------------------------------------------------------------------------
// Byte edits (ADR-0010)

/**
 * One replacement inside a file's text: `remove` characters at `at` become
 * `insert`. Offsets are relative to the result of every edit BEFORE this one
 * in its list, so two edits that would have overlapped as absolute spans —
 * removing adjacent members of the same JSON object — need no arithmetic
 * between them and each stays as narrow as what it removes.
 */
export interface SpliceEdit {
  at: number
  remove: number
  insert: string
}

/** The text after `edits`; null when one of them addresses outside it. */
export function applyEdits(source: string, edits: readonly SpliceEdit[]): string | null {
  let text = source
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.at) ||
      !Number.isInteger(edit.remove) ||
      edit.at < 0 ||
      edit.remove < 0 ||
      edit.at + edit.remove > text.length
    ) {
      return null
    }
    text = text.slice(0, edit.at) + edit.insert + text.slice(edit.at + edit.remove)
  }
  return text
}

/**
 * The edits that put `source` back, given the same list that changed it.
 * Each one is captured against the text as it stood when its forward edit
 * ran, and the list is reversed — so applying it to the spliced bytes is the
 * inverse splice ADR-0010 undoes by.
 */
export function invertEdits(
  source: string,
  edits: readonly SpliceEdit[]
): SpliceEdit[] | null {
  const inverse: SpliceEdit[] = []
  let text = source
  for (const edit of edits) {
    const applied = applyEdits(text, [edit])
    if (applied === null) return null
    inverse.push({
      at: edit.at,
      remove: edit.insert.length,
      insert: text.slice(edit.at, edit.at + edit.remove)
    })
    text = applied
  }
  return inverse.reverse()
}

/** The digest a `splice` names: sha256 of the file's text as kondo read it. */
export function digestSource(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

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
  /**
   * Change only the spans `edits` name, and only while the file still holds
   * the bytes `expectDigest` was taken from (ADR-0010). A file Claude has
   * rewritten since the plan was made refuses the step rather than losing
   * what Claude wrote; the undo is the inverse of `edits`, applied to the
   * file as it then stands rather than to a snapshot.
   */
  | {
      type: 'splice'
      store: string
      at: string
      expectDigest: string
      edits: SpliceEdit[]
    }

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
  type: 'move' | 'copy' | 'trash' | 'write' | 'splice'
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
  /** A `splice`'s edits, in the order they were applied (ADR-0010). */
  edits?: SpliceEdit[]
  /** The digest the file had before them; the step refuses without it. */
  expectDigest?: string
  /** The digest they produced; the undo refuses without it. */
  resultDigest?: string
  /**
   * The inverse of `edits`, against the bytes they produced. Held here
   * because the text they removed exists nowhere else: a splice displaces
   * nothing into the trash, so this list IS what ADR-0001 reverses by.
   */
  undoEdits?: SpliceEdit[]
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
  /**
   * Journal id this entry marks as failed part way through. The entry above
   * it was written before its steps ran (ADR-0001 decision 5) and describes
   * work that only partly happened; the file is append-only (the 001
   * lesson), so the correction is a following line, never an edit.
   */
  failedOf?: string
}

const JOURNAL_KINDS = new Set<string>([
  'skill', 'plugin', 'hook', 'settings', 'session', 'project', 'mcp',
  'agent', 'command', 'rule', 'output-style', 'store'
] satisfies EntityKind[])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const isSpliceEdits = (value: unknown): value is SpliceEdit[] =>
  Array.isArray(value) && value.every((edit: unknown) =>
    isObject(edit) &&
    typeof edit.at === 'number' && Number.isSafeInteger(edit.at) && edit.at >= 0 &&
    typeof edit.remove === 'number' && Number.isSafeInteger(edit.remove) && edit.remove >= 0 &&
    typeof edit.insert === 'string'
  )

/** Validate the entire step before undo can act on any part of its entry. */
const isJournalStep = (value: unknown): value is JournalStep => {
  if (!isObject(value) || typeof value.store !== 'string' || typeof value.from !== 'string') {
    return false
  }
  if (
    (value.to !== undefined && typeof value.to !== 'string') ||
    (value.toStore !== undefined && typeof value.toStore !== 'string') ||
    (value.displaced !== undefined && typeof value.displaced !== 'string') ||
    (value.created !== undefined && !isStringArray(value.created)) ||
    (value.edits !== undefined && !isSpliceEdits(value.edits)) ||
    (value.undoEdits !== undefined && !isSpliceEdits(value.undoEdits)) ||
    (value.expectDigest !== undefined && typeof value.expectDigest !== 'string') ||
    (value.resultDigest !== undefined && typeof value.resultDigest !== 'string')
  ) {
    return false
  }
  switch (value.type) {
    case 'move':
      return typeof value.to === 'string'
    case 'copy':
      return typeof value.to === 'string' && typeof value.toStore === 'string'
    case 'trash':
      return typeof value.displaced === 'string'
    case 'write':
      return true
    case 'splice':
      return typeof value.expectDigest === 'string' && typeof value.resultDigest === 'string' &&
        isSpliceEdits(value.edits) && isSpliceEdits(value.undoEdits)
    default:
      return false
  }
}

/** Optional historical fields may be absent; extra metadata is left alone. */
const isJournalRecord = (value: unknown): value is JournalRecord =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.at === 'string' &&
  (value.op === 'move' || value.op === 'settings-edit' || value.op === 'trash') &&
  typeof value.kind === 'string' && JOURNAL_KINDS.has(value.kind) &&
  typeof value.entityId === 'string' &&
  typeof value.summary === 'string' &&
  (value.undoOf === null || typeof value.undoOf === 'string') &&
  (value.failedOf === undefined || typeof value.failedOf === 'string') &&
  Array.isArray(value.steps) && value.steps.every(isJournalStep)

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

  // The one file the `user-config` store may name (ADR-0010). Its root is a
  // directory kondo never scans and writes nothing else into, so it is
  // deliberately absent from `roots` above: it takes no part in the nested
  // check below, where `<kondo-data>` under the same home is ordinary.
  const userConfigName = path.basename(locator.userConfigFile)

  // ADR-0001 decision 6: kondo's trash inside a store would show up in
  // kondo's own scan, and a sweep could trash its own undo history.
  const nested = [...roots.values()].find(
    (root) => kondoData === root || pathWithin(kondoData, root)
  )

  // -------------------------------------------------------------------------
  // Paths

  const rootOf = async (store: string): Promise<string> => {
    if (store === USER_CONFIG_STORE) return locator.userConfigRoot
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
    if (store === USER_CONFIG_STORE && relative !== userConfigName) {
      throw new Refused(
        'out-of-store',
        relative,
        `The ${USER_CONFIG_STORE} store holds only ${userConfigName}.`
      )
    }
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
   * The text of the file a `splice` names. A file that is not there is a
   * refusal: a splice edits bytes that exist, and conjuring the file would
   * be the whole-file write ADR-0010 exists to avoid.
   */
  const readForSplice = async (target: string, at: string): Promise<string> => {
    try {
      return await fs.readFile(target, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) {
        throw new Refused('read-failed', at, 'Nothing to splice at that path.')
      }
      throw new Refused('read-failed', at, describe(cause))
    }
  }

  /**
   * ADR-0010's refusal. Whoever wrote last wrote something kondo has not
   * seen, so the answer is to say so — never to re-plan against the new
   * bytes, and never to write over them.
   */
  const requireDigest = (text: string, expected: string, at: string): void => {
    if (digestSource(text) === expected) return
    throw new Refused(
      'stale-file',
      at,
      `${at} changed since kondo read it — nothing was written. Re-read and try again.`
    )
  }

  /**
   * Replace a file's contents through a temporary sibling, so a reader
   * racing the write sees the old bytes or the new ones and never a torn
   * file. Only the splice pays for this: it is the one step aimed at a file
   * something else is writing (ADR-0010).
   */
  const replaceAtomically = async (target: string, text: string): Promise<void> => {
    const temporary = `${target}.kondo-${randomUUID().slice(0, 8)}`
    await fs.writeFile(temporary, text, 'utf8')
    try {
      await fs.rename(temporary, target)
    } catch (cause) {
      await fs.rm(temporary, { force: true })
      throw cause
    }
  }

  /** Apply an edit list, turning "outside the file" into a refusal. */
  const spliced = (text: string, edits: SpliceEdit[], at: string): string => {
    const next = applyEdits(text, edits)
    if (next === null) {
      throw new Refused('bad-request', at, 'A splice edit addressed outside the file.')
    }
    return next
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

  const readJournal = async (): Promise<{
    records: JournalRecord[]
    blockedUndoIds: Set<string>
    scan: Scan<null>
  }> => {
    const c = collector()
    const blockedUndoIds = new Set<string>()
    let raw: string
    try {
      raw = await fs.readFile(journalFile, 'utf8')
    } catch (cause) {
      if (!isEnoent(cause)) c.fail('read-failed', 'journal.jsonl', cause)
      return { records: [], blockedUndoIds, scan: finish(null, c) }
    }
    const records: JournalRecord[] = []
    for (const [index, line] of raw.split('\n').entries()) {
      if (line.trim() === '') continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (!isJournalRecord(parsed)) {
          // A damaged undo or failure marker may describe work that already
          // ran. Its readable links can forbid another undo, never prove one
          // succeeded or supply steps to execute.
          if (isObject(parsed)) {
            if (typeof parsed.undoOf === 'string') blockedUndoIds.add(parsed.undoOf)
            if (typeof parsed.failedOf === 'string') blockedUndoIds.add(parsed.failedOf)
          }
          c.fail('parse-failed', `journal.jsonl:${index + 1}`, 'This history entry is incomplete or contains an invalid step.')
          continue
        }
        records.push(parsed)
      } catch (cause) {
        // ADR-0005: one bad line costs that line, never the whole history.
        c.fail('parse-failed', `journal.jsonl:${index + 1}`, cause)
      }
    }
    for (const record of records) {
      if (record.undoOf && blockedUndoIds.has(record.id)) blockedUndoIds.add(record.undoOf)
    }
    return { records, blockedUndoIds, scan: finish(null, c) }
  }

  const toInfo = (
    record: JournalRecord,
    undoneBy: string | null,
    failed = false
  ): JournalEntryInfo => ({
    id: `${ID_PREFIX}${record.id}`,
    at: record.at,
    op: record.op,
    kind: record.kind,
    entityId: record.entityId,
    summary: record.summary,
    stepCount: record.steps.length,
    undoneBy,
    isUndo: record.undoOf !== null,
    failed
  })

  /** Ids the following marker lines report as partly run; see `failedOf`. */
  const failedIds = (records: JournalRecord[]): Set<string> =>
    new Set(records.flatMap((record) => (record.failedOf ? [record.failedOf] : [])))

  /** `undoneBy` is derived from the undo entries, so the file stays append-only. */
  const undoLinks = (records: JournalRecord[], blockedUndoIds: Set<string>): Map<string, string> => {
    const links = new Map<string, string>()
    for (const record of records) {
      if (record.undoOf && !blockedUndoIds.has(record.id)) {
        links.set(record.undoOf, `${ID_PREFIX}${record.id}`)
      }
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
      } else if (step.type === 'splice') {
        const target = await resolveIn(step.store, step.from)
        // Re-read rather than reuse the plan's read: the journal entry is
        // already on the platter, and this is the check that counts.
        const text = await readForSplice(target, step.from)
        requireDigest(text, step.expectDigest as string, step.from)
        await replaceAtomically(target, spliced(text, step.edits as SpliceEdit[], step.from))
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
      if (step.type === 'splice') {
        const target = await resolveIn(step.store, step.at)
        // Checked here as well as at apply time, so the ordinary case —
        // Claude wrote the file between the scan and the click — refuses
        // without leaving a journal entry for work that never happened.
        const text = await readForSplice(target, step.at)
        requireDigest(text, step.expectDigest, step.at)
        const next = spliced(text, step.edits, step.at)
        const undoEdits = invertEdits(text, step.edits)
        if (undoEdits === null) {
          throw new Refused('bad-request', step.at, 'A splice edit addressed outside the file.')
        }
        steps.push({
          type: 'splice',
          store: step.store,
          from: step.at,
          edits: step.edits,
          expectDigest: step.expectDigest,
          resultDigest: digestSource(next),
          undoEdits
        })
        continue
      }
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
    try {
      await act()
    } catch (cause) {
      // The entry above is already on the platter and now overstates what
      // happened. One more line says so, so `list` stops offering it as a
      // finished operation and `undo` knows to expect gaps.
      try {
        await appendJournal({ ...record, id: newId(), steps: [], failedOf: record.id })
      } catch {
        // Best effort: the step's own failure is the one worth reporting.
      }
      throw cause
    }
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
      const { records, blockedUndoIds, scan } = await readJournal()
      const refuseUndo = (code: ScanErrorCode, at: string, message: string): Scan<JournalEntryInfo | null> => {
        const refused = refuse(code, at, message)
        return { ...refused, errors: [...scan.errors, ...refused.errors], unknown: scan.unknown }
      }
      const original = records.find((record) => record.id === key)
      if (!original) {
        return refuseUndo('unknown-id', journalId, 'No history entry with that id.')
      }
      if (blockedUndoIds.has(key)) {
        return refuseUndo(
          'read-failed', journalId,
          'A damaged history entry refers to this operation. Kondo cannot verify whether undo is safe, so nothing was changed.'
        )
      }
      if (original.undoOf !== null) {
        return refuseUndo('bad-request', journalId, 'An undo entry cannot itself be undone.')
      }
      if (undoLinks(records, blockedUndoIds).has(key)) {
        return refuseUndo('bad-request', journalId, 'That entry has already been undone.')
      }

      const id = newId()
      // Reversing a `write` or a `copy` displaces bytes kondo itself put
      // there, so the undo has journal steps of its own and its own trash
      // directory. A `move` and a `trash` put back what was already recorded,
      // and usually add nothing — but the path they put it back at can have
      // been taken in the meantime, by Claude writing a transcript at the same
      // uuid or by the user's own hand. That occupant is displaced rather than
      // renamed over (ADR-0001), so it earns a step here too. Reading the disk
      // at this point is what `mutate` already does in `planSteps`: the entry
      // is appended before `act` runs, so a step it does not carry is a
      // displacement nothing records.
      const steps: JournalStep[] = []
      for (const step of original.steps) {
        if (step.type === 'write') {
          steps.push({
            type: 'trash' as const,
            store: step.store,
            from: step.from,
            displaced: `${step.store}/${step.from}`
          })
        } else if (step.type === 'copy') {
          const store = step.toStore as string
          const from = step.to as string
          steps.push({ type: 'trash' as const, store, from, displaced: `${store}/${from}` })
        } else if (step.type === 'move' || step.type === 'trash') {
          if (await exists(await resolveIn(step.store, step.from))) {
            steps.push({
              type: 'trash' as const,
              store: step.store,
              from: step.from,
              displaced: `${step.store}/${step.from}`
            })
          }
        }
        // A `splice` displaces nothing, so it adds nothing here: what it
        // took out lives in its own `undoEdits` (ADR-0010).
      }
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
            const destination = await resolveIn(step.store, step.to as string)
            const source = await resolveIn(step.store, step.from)
            // The step may never have run: nothing arrived at the destination
            // and the source never left. Reversing that is a no-op, not a
            // failure. An absent source is the other story, and still throws.
            if ((await exists(destination)) || !(await exists(source))) {
              // Something took the path while the move stood. It goes to this
              // undo's own trash first; nothing is ever renamed over.
              if (await exists(source)) {
                await relocate(source, trashPath(id, `${step.store}/${step.from}`))
              }
              await relocate(destination, source)
            }
          } else if (step.type === 'copy') {
            // The source came back on the reversed `trash` step before this
            // one, so the copy is now the spare. It is displaced into the
            // undo's own trash, never unlinked — and it may not be there at
            // all if the copy is what failed.
            const destination = await resolveIn(step.toStore as string, step.to as string)
            if (await exists(destination)) {
              await relocate(destination, trashPath(id, `${step.toStore}/${step.to}`))
            }
          } else if (step.type === 'splice') {
            const target = await resolveIn(step.store, step.from)
            const text = await readForSplice(target, step.from)
            // The file still holding the pre-splice bytes means the step
            // never ran: the entry was journaled and then failed. Reversing
            // that is a no-op, exactly as it is for a move.
            if (digestSource(text) === step.expectDigest) continue
            requireDigest(text, step.resultDigest as string, step.from)
            await replaceAtomically(
              target,
              spliced(text, step.undoEdits as SpliceEdit[], step.from)
            )
          } else if (step.type === 'trash') {
            const kept = trashPath(original.id, step.displaced as string)
            const source = await resolveIn(step.store, step.from)
            // Nothing in the trash and the source still in place means this
            // step never ran. Nothing in the trash and no source is the
            // emptied trash, which still throws and is still reported below.
            if ((await exists(kept)) || !(await exists(source))) {
              // Claude writing a transcript at the same uuid is the ordinary
              // way this happens, and it is exactly what must not be lost.
              if (await exists(source)) {
                await relocate(source, trashPath(id, `${step.store}/${step.from}`))
              }
              await relocate(kept, source)
            }
          } else {
            const target = await resolveIn(step.store, step.from)
            const kept = step.displaced ? trashPath(original.id, step.displaced) : null
            // Entry 010's guard, one step further. A move and a trash can tell
            // a step that never ran from an emptied trash by looking at the
            // source; a write cannot, because its target sits there either
            // way. So this keeps the half it can decide — never displace bytes
            // that have nothing to come back — and lets the missing trash path
            // raise the ENOENT that is already the emptied-trash refusal.
            // Deliberate, over a per-step signal in the returned errors: a
            // silent skip would report an undo that succeeded and put nothing
            // back, which is the worse of the two half-truths, and the store
            // is untouched either way.
            if (kept !== null) await fs.stat(kept)
            // Nothing is destroyed: the current bytes go to the undo's trash
            // before whatever they displaced comes back.
            if (await exists(target)) {
              await relocate(target, trashPath(id, `${step.store}/${step.from}`))
            }
            if (kept !== null) {
              await fs.mkdir(path.dirname(target), { recursive: true })
              await fs.cp(kept, target, { recursive: true })
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
          return refuseUndo(
            'read-failed',
            journalId,
            "The files this entry would put back are no longer in kondo's trash — it was emptied, and emptying is the one thing undo cannot survive."
          )
        }
        // A splice that refuses carries its own reason and code — a stale
        // file is not a read failure, and undo says so (ADR-0010).
        if (cause instanceof Refused) return refuseUndo(cause.code, cause.at, cause.message)
        return refuseUndo('read-failed', journalId, describe(cause))
      }
      return { data: toInfo(record, null), errors: scan.errors, unknown: scan.unknown }
    },

    async list(): Promise<Scan<JournalEntryInfo[]>> {
      const { records, blockedUndoIds, scan } = await readJournal()
      const links = undoLinks(records, blockedUndoIds)
      const failed = failedIds(records)
      const entries = records
        // A marker is a correction to the line above it, not an operation of
        // its own, so it is read and never listed.
        .filter((record) => record.failedOf === undefined)
        .map((record) => toInfo(record, links.get(record.id) ?? null, failed.has(record.id)))
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
