import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  EntityKind,
  JournalEntryInfo,
  JournalOp,
  Scan,
  ScanError,
  ScanErrorCode,
  TrashReport
} from '../../../shared/contract'
import type { StoreLocator } from './locator'
import {
  collector,
  BoundaryError,
  copyTree,
  describe,
  digestTree,
  TREE_DIGEST_PREFIX,
  finish,
  isEnoent,
  inspectTree,
  pathWithin,
  realpathWithMissing,
  resolveAllowedPath,
  type ReadBoundary
} from './scan'
import { tildify } from './display'
import {
  inspectPhysicalTree,
  PHYSICAL_DIGEST_PREFIX,
  physicalDigest,
  preflightRelocation,
  relocateTree
} from './relocation'

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
  /** Historical/planned whole-file write; execution is suspended by 098. */
  | { type: 'write'; store: string; at: string; content: string }
  /**
   * Historical/planned splice; execution is suspended by 098.
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
  /** Main-only review check, after step planning and immediately before journaling. */
  preflight?: () => Promise<ScanError | null>
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

interface JournalEndpoint {
  store: string
  relative: string
  /** When present, relative names bytes in this journal entry's trash. */
  trashId?: string
}

interface JournalAction {
  type: 'move' | 'copy'
  from: JournalEndpoint
  to: JournalEndpoint
  /** Index in the original operation's steps. */
  step: number
}

interface JournalProgress {
  next: number
  /** Source fingerprint synced before the action; prefixes identify copy and move formats. */
  pending: string | null
  state: 'running' | 'failed' | 'complete'
}

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
  /** Version 2 requires explicit progress and completion; absence is legacy. */
  version?: 2
  actions?: JournalAction[]
  progress?: JournalProgress
  /** Append-only checkpoint, hidden from the operation list. */
  progressOf?: string
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

const isEndpoint = (value: unknown): value is JournalEndpoint =>
  isObject(value) && typeof value.store === 'string' && typeof value.relative === 'string' &&
  (value.trashId === undefined || (typeof value.trashId === 'string' && /^[a-zA-Z0-9_-]+$/.test(value.trashId)))

type FingerprintKind = 'legacy' | 'copy' | 'move'

/** Keep known historical syntax readable; reconciliation requires its action's exact format. */
const fingerprintKind = (value: unknown): FingerprintKind | null => {
  if (typeof value !== 'string') return null
  if (/^[a-f0-9]{64}$/.test(value)) return 'legacy'
  if (value.startsWith(TREE_DIGEST_PREFIX) &&
    /^[a-f0-9]{64}$/.test(value.slice(TREE_DIGEST_PREFIX.length))) return 'copy'
  if (value.startsWith(PHYSICAL_DIGEST_PREFIX) &&
    /^[a-f0-9]{64}$/.test(value.slice(PHYSICAL_DIGEST_PREFIX.length))) return 'move'
  return null
}

const isFingerprint = (value: unknown): value is string => fingerprintKind(value) !== null

const pendingFingerprintUnavailable = (record: JournalRecord | undefined): string | null => {
  if (record?.version !== 2 || record.progress?.pending == null) return null
  const pending = record.progress.pending
  const action = record.actions?.[record.progress.next]
  if (action === undefined) return null
  const expected: FingerprintKind = action.type === 'copy' ? 'copy' : 'move'
  const actual = fingerprintKind(pending)
  if (actual === expected) return null
  if (actual === 'legacy') {
    return `Recovery is uncertain: this pending ${action.type} used an older fingerprint that cannot prove tree equality. All remaining bytes were kept; review the files before retrying.`
  }
  return `Recovery is uncertain: this pending fingerprint format does not match its recorded ${action.type} action. All remaining bytes were kept; review the files before retrying.`
}

/** Bare evidence may close old completed history; typed evidence must match its action. */
const pendingFingerprintMatchesAction = (record: JournalRecord, progress: JournalProgress): boolean => {
  if (progress.pending === null) return true
  const actual = fingerprintKind(progress.pending)
  if (actual === 'legacy') return true
  const action = record.actions?.[progress.next]
  return action !== undefined && actual === (action.type === 'copy' ? 'copy' : 'move')
}

const isProgress = (value: unknown): value is JournalProgress =>
  isObject(value) && typeof value.next === 'number' && Number.isSafeInteger(value.next) && value.next >= 0 &&
  (value.pending === null || isFingerprint(value.pending)) &&
  (value.state === 'running' || value.state === 'failed' || value.state === 'complete')

const isExecution = (value: Record<string, unknown>): boolean => {
  if (value.version === undefined) {
    return value.actions === undefined && value.progress === undefined && value.progressOf === undefined
  }
  if (value.version !== 2 || value.failedOf !== undefined || !isProgress(value.progress)) return false
  if (value.progressOf !== undefined) {
    return typeof value.progressOf === 'string' && value.actions === undefined &&
      Array.isArray(value.steps) && value.steps.length === 0
  }
  return Array.isArray(value.actions) && value.actions.every((action: unknown) =>
    isObject(action) && (action.type === 'move' || action.type === 'copy') &&
    isEndpoint(action.from) && isEndpoint(action.to) &&
    typeof action.step === 'number' && Number.isSafeInteger(action.step) && action.step >= 0
  ) && value.progress.next === 0 && value.progress.pending === null && value.progress.state === 'running'
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
  Array.isArray(value.steps) && value.steps.every(isJournalStep) && isExecution(value)

const ID_PREFIX = 'journal:'

/**
 * ADR-0010 / 098: Node cannot atomically replace a file while retaining an
 * arbitrary external writer's intervening version. No platform backend has
 * established that guarantee yet. This restriction also covers whole-file
 * creation: the supposedly absent path may be occupied by publication time.
 */
const SETTINGS_WRITE_UNAVAILABLE =
  'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

const includesSettingsWrite = (steps: readonly { type: string }[]): boolean =>
  steps.some((step) => step.type === 'splice' || step.type === 'write')

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
  const discoveredRoots = new Set<string>()
  if (locator.desktopRoot) roots.set('desktop', locator.desktopRoot)

  // The one file the `user-config` store may name (ADR-0010). Its root is the
  // home directory by default and the user store itself when a Claude profile
  // is selected (docs/domain.md); either way this store writes nothing but that
  // one file, so it is deliberately absent from `roots` above and takes no part
  // in the nested check below, where `<kondo-data>` under the same home is
  // ordinary.
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
    discoveredRoots.add(dynamic)
    return dynamic
  }

  // Operations retain the precise lexical authority of each endpoint, including
  // Kondo's separate journal/trash footprint. Resolving into another allowed
  // store never changes an endpoint's authority.
  const boundaryOf = (target: string): ReadBoundary => {
    if (path.relative(target, locator.userConfigFile) === '') return { file: locator.userConfigFile }
    const root = [...roots.values(), ...discoveredRoots, kondoData]
      .filter((candidate) => path.relative(candidate, target) === '' || pathWithin(target, candidate))
      .sort((a, b) => b.length - a.length)[0]
    if (root === undefined) throw new Refused('out-of-store', target, 'Unknown filesystem authority.')
    return root
  }

  const checked = async (target: string, missing = false): Promise<string> => {
    try {
      return await resolveAllowedPath(target, boundaryOf(target), missing)
    } catch (cause) {
      if (cause instanceof BoundaryError) throw new Refused(cause.code, target, cause.message)
      throw cause
    }
  }

  const checkTree = async (target: string): Promise<void> => {
    try {
      await inspectTree(target, boundaryOf(target))
    } catch (cause) {
      if (cause instanceof BoundaryError) throw new Refused(cause.code, target, cause.message)
      throw cause
    }
  }

  const copy = async (from: string, to: string): Promise<void> => {
    try {
      await copyTree(from, to, boundaryOf(from), boundaryOf(to))
    } catch (cause) {
      if (cause instanceof BoundaryError) throw new Refused(cause.code, to, cause.message)
      throw cause
    }
  }

  const resolveIn = async (store: string, relative: string, dereference = false): Promise<string> => {
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
    let resolvedRoot: string
    let resolved: string
    try {
      resolvedRoot = await realpathWithMissing(root)
      resolved = await realpathWithMissing(target)
    } catch (cause) {
      // In undo, raw ENOENT means missing trash. Resolution failures are a
      // different refusal, including a link whose referent disappeared.
      throw new Refused('read-failed', relative, `Cannot resolve the mutation path: ${describe(cause)}`)
    }
    if (
      !pathWithin(resolved, resolvedRoot) ||
      (store === USER_CONFIG_STORE &&
        path.relative(path.join(resolvedRoot, userConfigName), resolved) !== '')
    ) {
      throw new Refused('out-of-store', relative, 'The resolved path may not leave its allowed store boundary.')
    }
    // Moves/trash still operate on the directory entry; a splice edits the
    // referent so renaming the temporary file never replaces the link itself.
    return dereference ? resolved : target
  }

  // A project store is named `project:<dirName>` and no Windows path segment
  // may hold a colon, so the trash spells it with a dash. The journal keeps
  // the real store name; both the write and its undo come through here, so
  // the two always agree on where the displaced bytes went.
  const trashPath = (journalId: string, displaced: string): string => {
    if (!/^[a-zA-Z0-9_-]+$/.test(journalId)) {
      throw new Refused('out-of-store', journalId, 'A trash entry must have a single journal identity.')
    }
    const root = path.join(trashRoot, journalId)
    const target = path.join(root, ...displaced.replaceAll(':', '-').split('/'))
    if (!pathWithin(target, root)) {
      throw new Refused('out-of-store', displaced, 'Recovery bytes must stay in their trash entry.')
    }
    return target
  }

  const exists = async (target: string): Promise<boolean> => {
    try {
      await fs.stat(await checked(target))
      return true
    } catch (cause) {
      if (isEnoent(cause)) return false
      throw cause
    }
  }

  const entryExists = async (target: string): Promise<boolean> => {
    const parent = await checked(path.dirname(target), true)
    try {
      await fs.lstat(path.join(parent, path.basename(target)))
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
      // resolveIn returned the canonical referent. Refuse a changed path before
      // reading as well as before replacement; a splice must preserve its link.
      if (path.relative(target, await fs.realpath(target)) !== '') {
        throw new Refused('out-of-store', at, 'The splice target changed its resolved path.')
      }
      return await fs.readFile(target, 'utf8')
    } catch (cause) {
      if (cause instanceof Refused) throw cause
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
      const [source, destination] = await Promise.all([
        digestTree(from, boundaryOf(from)), digestTree(to, boundaryOf(to))
      ])
      if (source === destination) return null
      return `The copy at ${path.basename(to)} does not match its source; nothing was removed.`
    } catch (cause) {
      return `The copy could not be verified (${describe(cause)}); nothing was removed.`
    }
  }

  /** Preserve directory entries in trash, then validate their future restore. */
  const relocation = async (from: string, to: string, execute: boolean): Promise<void> => {
    try {
      const restore = !pathWithin(to, trashRoot)
      const action = execute ? relocateTree : preflightRelocation
      await action(from, to, boundaryOf(from), boundaryOf(to), restore)
    } catch (cause) {
      if (cause instanceof BoundaryError) throw new Refused(cause.code, to, cause.message)
      throw cause
    }
  }
  const relocate = async (from: string, to: string): Promise<void> => relocation(from, to, true)

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
    await checked(journalFile, true)
    await fs.mkdir(await checked(kondoData, true), { recursive: true })
    const handle = await fs.open(await checked(journalFile, true), 'a+')
    try {
      // Preserve a torn final line, but keep the next record independently readable.
      const size = (await handle.stat()).size
      if (size > 0) {
        const tail = Buffer.alloc(1)
        await handle.read(tail, 0, 1, size - 1)
        if (tail[0] !== 10) await handle.writeFile('\n')
      }
      await handle.writeFile(`${JSON.stringify(record)}\n`)
      // The invariant is ordering, not best effort: the entry is on the
      // platter before a single store byte moves.
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const sameEndpoint = (a: JournalEndpoint, b: JournalEndpoint): boolean =>
    a.store === b.store && a.relative === b.relative && a.trashId === b.trashId

  const validActions = (record: JournalRecord, records: JournalRecord[]): boolean => {
    const actions = record.actions!
    if (includesSettingsWrite(record.steps)) return false
    if (record.undoOf === null) {
      const expected = forwardActions(record.id, record.steps)
      return actions.length === expected.length && actions.every((action, index) => {
        const other = expected[index]!
        return action.type === other.type && action.step === index &&
          sameEndpoint(action.from, other.from) && sameEndpoint(action.to, other.to)
      })
    }
    const original = records.find((candidate) => candidate.id === record.undoOf)
    if (!original || original.undoOf !== null || includesSettingsWrite(original.steps) || actions.length === 0) return false
    let previous = original.steps.length
    let occupant = false
    for (const action of actions) {
      const step = original.steps[action.step]
      if (!step || action.type !== 'move' || action.step > previous) return false
      const source = { store: step.store, relative: step.from }
      const destination = step.type === 'trash'
        ? { store: step.store, relative: step.displaced!, trashId: original.id }
        : { store: step.toStore ?? step.store, relative: step.to! }
      const displaced = {
        store: step.type === 'copy' ? destination.store : source.store,
        relative: step.type === 'copy' ? `${destination.store}/${destination.relative}` : `${source.store}/${source.relative}`,
        trashId: record.id
      }
      const movingOccupant = step.type !== 'copy' && sameEndpoint(action.from, source) && sameEndpoint(action.to, displaced)
      const restoring = sameEndpoint(action.from, destination) &&
        sameEndpoint(action.to, step.type === 'copy' ? displaced : source)
      if (!movingOccupant && !restoring) return false
      if (action.step === previous && (!occupant || movingOccupant)) return false
      if (action.step < previous && occupant) return false
      occupant = movingOccupant
      previous = action.step
    }
    if (occupant) return false
    if (original.version === 2) {
      const expected = new Set(original.actions!.slice(0, original.progress!.next).map((action) => action.step))
      const covered = new Set(actions.map((action) => action.step))
      if (expected.size !== covered.size || [...expected].some((step) => !covered.has(step))) return false
    }
    return true
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
      raw = await fs.readFile(await checked(journalFile), 'utf8')
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
            if (typeof parsed.progressOf === 'string') blockedUndoIds.add(parsed.progressOf)
          }
          c.fail('parse-failed', `journal.jsonl:${index + 1}`, 'This history entry is incomplete or contains an invalid step.')
          continue
        }
        if (parsed.progressOf !== undefined) {
          const target = records.find((record) => record.id === parsed.progressOf)
          const previous = target?.progress
          const next = parsed.progress!
          const count = target?.actions?.length ?? -1
          const sameCursor = previous !== undefined && next.next === previous.next
          const advanced = previous !== undefined && previous.pending !== null &&
            next.next === previous.next + 1 && next.pending === null
          const compatibleClear = previous?.pending == null || next.pending !== null ||
            (target !== undefined && pendingFingerprintMatchesAction(target, previous))
          const valid = target?.version === 2 && previous !== undefined && previous.state !== 'complete' &&
            parsed.undoOf === target.undoOf && parsed.op === target.op && parsed.kind === target.kind &&
            parsed.entityId === target.entityId && parsed.summary === target.summary && next.next <= count &&
            compatibleClear &&
            (next.pending === null || next.next < count) &&
            (sameCursor || advanced) &&
            (next.state !== 'complete' || (next.next === count && next.pending === null)) &&
            !(sameCursor && previous.pending !== null && next.pending !== null && previous.pending !== next.pending) &&
            !(sameCursor && previous.pending !== null && next.pending === null && next.state !== 'failed')
          if (!valid) {
            blockedUndoIds.add(parsed.progressOf)
            c.fail('parse-failed', `journal.jsonl:${index + 1}`, 'Invalid history progress; recovery is blocked.')
          } else {
            target.progress = next
          }
          continue
        }
        if (records.some((record) => record.id === parsed.id)) {
          blockedUndoIds.add(parsed.id)
          if (parsed.undoOf) blockedUndoIds.add(parsed.undoOf)
          c.fail('parse-failed', `journal.jsonl:${index + 1}`, 'Duplicate history identity; recovery is blocked.')
          continue
        }
        if (parsed.version === 2 && !validActions(parsed, records)) {
          blockedUndoIds.add(parsed.id)
          if (parsed.undoOf) blockedUndoIds.add(parsed.undoOf)
          c.fail('parse-failed', `journal.jsonl:${index + 1}`, 'History actions do not match their operation.')
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

  const outcomeOf = (record: JournalRecord, failed = false): JournalEntryInfo['outcome'] => {
    if (record.version !== 2) return failed ? 'uncertain' : 'complete'
    const progress = record.progress!
    if (progress.pending !== null) return 'uncertain'
    if (progress.state === 'complete') return 'complete'
    return progress.next > 0 ? 'partial' : 'none'
  }

  const toInfo = (
    record: JournalRecord,
    undoneBy: string | null,
    failed = false,
    recovery: JournalEntryInfo['recovery'] = 'available',
    undoBlockedReason: string | null = null
  ): JournalEntryInfo => ({
    id: `${ID_PREFIX}${record.id}`, at: record.at, op: record.op, kind: record.kind,
    entityId: record.entityId, summary: record.summary, stepCount: record.steps.length,
    undoneBy, isUndo: record.undoOf !== null,
    failed: failed || (record.version === 2 && record.progress!.state !== 'complete'),
    outcome: outcomeOf(record, failed), recovery,
    undoBlockedReason: undoBlockedReason ?? (record.undoOf !== null ? 'An undo cannot itself be undone.'
      : record.version === 2 && record.progress!.next === 0 && record.progress!.pending === null
        ? 'This operation has no completed changes to undo.' : null)
  })

  const failedIds = (records: JournalRecord[]): Set<string> =>
    new Set(records.flatMap((record) => (record.failedOf ? [record.failedOf] : [])))

  /** An intent or failed legacy Undo never proves completion. */
  const undoLinks = (records: JournalRecord[], blockedUndoIds: Set<string>): Map<string, string> => {
    const links = new Map<string, string>()
    const failed = failedIds(records)
    for (const record of records) {
      if (record.undoOf && record.failedOf === undefined && !blockedUndoIds.has(record.id) &&
        !blockedUndoIds.has(record.undoOf) && !failed.has(record.id) &&
        (record.version !== 2 || record.progress?.state === 'complete')) {
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
      const entries = await fs.readdir(await checked(trashRoot), { withFileTypes: true })
      entryCount = entries.filter((entry) => entry.isDirectory()).length
    } catch (cause) {
      if (!isEnoent(cause)) c.fail('read-failed', display, cause)
    }
    // Archived links are stored metadata, not permission to follow their
    // referents back into a live store. Count only bytes physically retained.
    const held = await inspectPhysicalTree(trashRoot, kondoData, (at, cause) => {
      if (!isEnoent(cause)) {
        c.fail(cause instanceof BoundaryError ? cause.code : 'read-failed', tildify(at, locator.home), cause)
      }
    })
    const bytes = held.reduce((total, entry) => total + entry.bytes, 0)
    return finish({ root: display, bytes, entryCount }, c)
  }

  // -------------------------------------------------------------------------
  // Execution

  const planSteps = async (journalId: string, planned: PlannedStep[]): Promise<JournalStep[]> => {
    const steps: JournalStep[] = []
    for (const step of planned) {
      if (step.type === 'splice') {
        const target = await resolveIn(step.store, step.at, true)
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

      // Refuse a bad nested source or trash destination before journaling.
      if (await exists(target)) await checkTree(target)
      await checked(trashPath(journalId, displaced), true)

      if (step.type === 'move') {
        const destination = await resolveIn(step.store, step.to)
        if (!(await exists(target))) {
          throw new Refused('read-failed', relative, 'Nothing to move at that path.')
        }
        if (await exists(destination)) {
          throw new Refused('bad-request', step.to, 'The destination already exists.')
        }
        await relocation(target, destination, false)
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
        await relocation(target, trashPath(journalId, displaced), false)
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

  const endpoint = async (at: JournalEndpoint): Promise<string> => {
    if (at.trashId === undefined) return resolveIn(at.store, at.relative)
    const target = trashPath(at.trashId, at.relative)
    if (!pathWithin(target, path.join(trashRoot, at.trashId))) {
      throw new Refused('out-of-store', at.relative, 'Recovery bytes must stay in their trash entry.')
    }
    return target
  }

  const fingerprint = async (target: string, logical: boolean): Promise<string | null> => {
    if (!(await entryExists(target))) return null
    return logical ? TREE_DIGEST_PREFIX + await digestTree(target, boundaryOf(target))
      : PHYSICAL_DIGEST_PREFIX + await physicalDigest(target, boundaryOf(target))
  }

  class JournalWriteError extends Error {}

  const checkpoint = async (record: JournalRecord, progress: JournalProgress): Promise<void> => {
    const { actions: _actions, ...metadata } = record
    try {
      await appendJournal({ ...metadata, id: newId(), steps: [], progressOf: record.id, progress })
    } catch (cause) {
      // A failed sync/close may still leave a complete line. Never append a
      // competing cursor or infer that the preceding filesystem action failed.
      throw new JournalWriteError(`Could not confirm history progress: ${describe(cause)}. Recovery will recheck the pending action.`)
    }
    record.progress = progress
  }

  /** Classify the one unconfirmed action; completed actions are never inspected again. */
  const reconcile = async (record: JournalRecord): Promise<void> => {
    const progress = record.progress!
    if (progress.pending === null) return
    const unavailable = pendingFingerprintUnavailable(record)
    if (unavailable !== null) throw new Refused('read-failed', record.entityId, unavailable)
    const action = record.actions![progress.next]!
    const source = await endpoint(action.from)
    const destination = await endpoint(action.to)
    const before = await fingerprint(source, action.type === 'copy')
    const after = await fingerprint(destination, action.type === 'copy')
    if (before === progress.pending && after === null) {
      await checkpoint(record, { next: progress.next, pending: null, state: 'failed' })
    } else if (after === progress.pending && (before === null ||
      (action.type === 'copy' && before === progress.pending))) {
      await checkpoint(record, { next: progress.next + 1, pending: null, state: 'failed' })
    } else {
      throw new Refused('read-failed', record.entityId,
        'Recovery is uncertain: the pending action no longer matches its saved evidence. All remaining bytes were kept; review the files before retrying.')
    }
  }

  const execute = async (record: JournalRecord, fresh: boolean): Promise<Scan<JournalEntryInfo | null>> => {
    if (fresh) {
      try { await appendJournal(record) } catch (cause) {
        return refuse('read-failed', record.entityId, describe(cause))
      }
    }
    try {
      await reconcile(record)
      while (record.progress!.next < record.actions!.length) {
        const next = record.progress!.next
        const action = record.actions![next]!
        const source = await endpoint(action.from)
        const destination = await endpoint(action.to)
        // Earlier actions can have supplied this source or vacated this destination.
        if (await entryExists(destination)) throw new Refused('read-failed', action.to.relative,
          'The recovery destination is occupied. No files were overwritten; retry after resolving the collision.')
        const digest = await fingerprint(source, action.type === 'copy')
        if (digest === null) throw new Refused('read-failed', action.from.relative,
          'The files needed by this action are missing; its trash may have been emptied.')
        if (action.type === 'move') await relocation(source, destination, false)
        else await checkTree(source)
        await checkpoint(record, { next, pending: digest, state: 'running' })
        if (action.type === 'move') {
          await relocate(source, destination)
        } else {
          await copy(source, destination)
          const unverified = await verifyCopy(source, destination)
          if (unverified !== null) {
            await relocate(destination, trashPath(record.id, `${action.to.store}/${action.to.relative}`))
            throw new Refused('read-failed', action.to.relative, unverified)
          }
        }
        await checkpoint(record, { next: next + 1, pending: null, state: 'running' })
      }
      await checkpoint(record, { ...record.progress!, state: 'complete' })
      return { data: toInfo(record, null), errors: [], unknown: [] }
    } catch (cause) {
      let uncertain = cause instanceof JournalWriteError
      if (!uncertain) {
        try {
          await reconcile(record)
          await checkpoint(record, { ...record.progress!, state: 'failed' })
        } catch { uncertain = true }
      }
      const result = cause instanceof Refused
        ? refuse(cause.code, cause.at, cause.message)
        : refuse('read-failed', record.entityId, describe(cause))
      const info = toInfo(record, null)
      if (uncertain) { info.outcome = 'uncertain'; info.failed = true }
      return { ...result, data: info }
    }
  }

  const forwardActions = (id: string, steps: JournalStep[]): JournalAction[] => steps.map((step, index) => ({
    type: step.type === 'copy' ? 'copy' : 'move', step: index,
    from: { store: step.store, relative: step.from },
    to: step.type === 'trash'
      ? { store: step.store, relative: step.displaced!, trashId: id }
      : { store: step.toStore ?? step.store, relative: step.to! }
  }))

  const operations: Mutations = {
    async mutate(plan: MutationPlan): Promise<Scan<JournalEntryInfo | null>> {
      if (nested) return misconfigured()
      // Check the whole plan before preflight, journaling, or an earlier move.
      // A refused mixed operation must never leave a partially applied plan.
      if (includesSettingsWrite(plan.steps)) {
        return refuse('not-permitted', plan.entityId, SETTINGS_WRITE_UNAVAILABLE)
      }
      const id = newId()
      let steps: JournalStep[]
      try {
        steps = await planSteps(id, plan.steps)
        const refusal = await plan.preflight?.()
        if (refusal) return refuse(refusal.code, refusal.path, refusal.message)
        // Planning and the internal preflight can yield. Recheck both lists
        // before the journal append so a mutable caller cannot add a settings
        // step during those awaits and slip it into an otherwise allowed plan.
        if (includesSettingsWrite(plan.steps) || includesSettingsWrite(steps)) {
          return refuse('not-permitted', plan.entityId, SETTINGS_WRITE_UNAVAILABLE)
        }
      } catch (cause) {
        // A source can disappear during planSteps, before the last preflight.
        // Prefer the operation-specific stale review refusal in that case.
        const refusal = await plan.preflight?.()
        if (refusal) return refuse(refusal.code, refusal.path, refusal.message)

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
        undoOf: null, version: 2, actions: forwardActions(id, steps),
        progress: { next: 0, pending: null, state: 'running' }
      }
      return execute(record, true)
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

      // Historical settings edits remain readable, with all recovery bytes
      // retained. Refuse before preflight or append so retries cannot create
      // a completed Undo link, even for a partially applied mixed entry.
      if (includesSettingsWrite(original.steps)) {
        return refuseUndo('not-permitted', journalId, SETTINGS_WRITE_UNAVAILABLE)
      }

      const failed = failedIds(records)
      const previous = records.find((record) => record.undoOf === key && record.failedOf === undefined)
      if (previous && previous.version !== 2) {
        return refuseUndo('read-failed', journalId,
          'A previous Undo failed without recording which actions completed. Recovery is uncertain; the saved bytes were kept for review.')
      }
      // A forward action may have completed before its checkpoint failed.
      // Resolve only that action; never continue the forward operation on Undo.
      if (original.version === 2) {
        try { await reconcile(original) } catch (cause) {
          return refuseUndo('read-failed', journalId, describe(cause))
        }
      }
      const finishUndo = async (record: JournalRecord, fresh: boolean): Promise<Scan<JournalEntryInfo | null>> => {
        const result = await execute(record, fresh)
        if (result.data?.outcome === 'complete') {
          for (const step of [...original.steps].reverse()) await dropCreated(step.created, createdIn(step))
        }
        return { ...result, errors: [...scan.errors, ...result.errors], unknown: scan.unknown }
      }
      if (previous) return finishUndo(previous, false)

      const completed = original.version === 2
        ? new Set(original.actions!.slice(0, original.progress!.next).map((action) => action.step))
        : null
      if (completed?.size === 0) {
        return refuseUndo('bad-request', journalId, 'This operation has no completed changes to undo.')
      }
      const id = newId()
      const actions: JournalAction[] = []
      const steps: JournalStep[] = []
      const saved = (store: string, relative: string, trashId = id): JournalEndpoint =>
        ({ store, relative, trashId })
      const add = (from: JournalEndpoint, to: JournalEndpoint, step: number): void => {
        actions.push({ type: 'move', from, to, step })
      }
      try {
        for (const [index, step] of [...original.steps.entries()].reverse()) {
          if (completed !== null && !completed.has(index)) continue
          const source: JournalEndpoint = { store: step.store, relative: step.from }
          const sourcePath = await endpoint(source)
          const sourceExists = await exists(sourcePath)
          if (sourceExists) await checkTree(sourcePath)
          if (step.type === 'copy') {
            const from = { store: step.toStore!, relative: step.to! }
            const fromPath = await endpoint(from)
            if (!(await exists(fromPath)) && failed.has(key)) continue
            const to = saved(from.store, `${from.store}/${from.relative}`)
            await relocation(fromPath, await endpoint(to), false)
            add(from, to, index)
            steps.push({ type: 'trash', store: from.store, from: from.relative, displaced: to.relative })
          } else {
            const from = step.type === 'move'
              ? { store: step.store, relative: step.to! }
              : saved(step.store, step.displaced!, original.id)
            const fromPath = await endpoint(from)
            if (!(await entryExists(fromPath))) {
              if (completed === null && failed.has(key) && sourceExists) continue
              throw new Refused('read-failed', step.from,
                'The files this entry would put back are missing; the trash may have been emptied. Nothing was restored.')
            }
            if (completed === null && failed.has(key) && sourceExists && step.type === 'trash') {
              throw new Refused('read-failed', step.from,
                'The failed move retains both a source and saved bytes. Their completeness is uncertain; nothing was changed.')
            }
            // Validate every restore before journaling or moving an occupant.
            await relocation(fromPath, sourcePath, false)
            if (sourceExists) {
              const displaced = saved(step.store, `${step.store}/${step.from}`)
              await relocation(sourcePath, await endpoint(displaced), false)
              add(source, displaced, index)
              steps.push({ type: 'trash', store: step.store, from: step.from, displaced: displaced.relative })
            }
            add(from, source, index)
          }
        }
      } catch (cause) {
        if (cause instanceof Refused) return refuseUndo(cause.code, cause.at, cause.message)
        if (isEnoent(cause)) return refuseUndo('read-failed', journalId,
          'The files needed to undo this change are missing; the trash may have been emptied.')
        return refuseUndo('read-failed', journalId, describe(cause))
      }
      if (actions.length === 0) return refuseUndo('bad-request', journalId, 'No files need restoring.')
      const record: JournalRecord = {
        id, at: new Date(now()).toISOString(), op: original.op, kind: original.kind,
        entityId: original.entityId, summary: `Undo: ${original.summary}`, steps, undoOf: key,
        version: 2, actions, progress: { next: 0, pending: null, state: 'running' }
      }
      return finishUndo(record, true)
    },

    async list(): Promise<Scan<JournalEntryInfo[]>> {
      const { records, blockedUndoIds, scan } = await readJournal()
      const links = undoLinks(records, blockedUndoIds)
      const failed = failedIds(records)
      const entries = records
        // A marker is a correction to the line above it, not an operation of
        // its own, so it is read and never listed.
        .filter((record) => record.failedOf === undefined)
        .map((record) => {
          const undoneBy = links.get(record.id) ?? null
          const attempt = records.find((candidate) => candidate.undoOf === record.id && candidate.failedOf === undefined)
          const damaged = blockedUndoIds.has(record.id)
          const legacyFailedUndo = attempt !== undefined && attempt.version !== 2 && failed.has(attempt.id)
          const empty = record.version === 2 && record.progress!.next === 0 && record.progress!.pending === null
          const unavailable = pendingFingerprintUnavailable(record) ?? pendingFingerprintUnavailable(attempt)
          const reason = record.undoOf !== null ? 'An undo cannot itself be undone.'
            : undoneBy !== null ? 'This entry has already been undone.'
            : damaged ? 'A damaged history entry prevents safe recovery.'
            : includesSettingsWrite(record.steps) ? SETTINGS_WRITE_UNAVAILABLE
            : unavailable !== null ? unavailable
            : legacyFailedUndo ? 'A previous Undo failed without action evidence. Saved bytes need review.'
            : empty ? 'This operation has no completed changes to undo.'
            : null
          const recovery: JournalEntryInfo['recovery'] = undoneBy !== null ? 'done'
            : reason !== null ? 'blocked'
            : attempt?.progress?.pending !== null && attempt?.progress?.pending !== undefined ? 'uncertain'
            : (attempt?.progress?.next ?? 0) > 0 ? 'partial'
            : 'available'
          const info = toInfo(record, undoneBy, failed.has(record.id), recovery, reason)
          if (damaged) { info.outcome = 'uncertain'; info.failed = true }
          return info
        })
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
        if (await exists(trashRoot)) {
          await inspectPhysicalTree(trashRoot, kondoData)
          await fs.rm(trashRoot, { recursive: true, force: true })
        }
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
  // Two different valid tokens must not both preflight the same duplicate
  // group before either removal runs. All writes in this workspace share the
  // queue, including Undo and empty-trash; external processes remain outside it.
  let pending: Promise<unknown> = Promise.resolve()
  const serial = <T>(act: () => Promise<T>): Promise<T> => {
    const result = pending.then(act, act)
    pending = result.then(() => undefined, () => undefined)
    return result
  }
  return {
    ...operations,
    mutate: (plan) => serial(() => operations.mutate(plan)),
    undo: (id) => serial(() => operations.undo(id)),
    emptyTrash: () => serial(() => operations.emptyTrash())
  }

}
