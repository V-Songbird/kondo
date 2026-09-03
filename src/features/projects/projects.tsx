import { Fragment, useState, type ReactNode } from 'react'
import type {
  JournalEntryInfo,
  KondoApi,
  PlacedEntryInfo,
  ProjectPluginChoice,
  ProjectPluginState,
  ProjectRow,
  Scan,
  SessionDuplicateGroup,
  SessionSummary,
  SkillInfo,
  StoreReport,
  ToggleOperation
} from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { formatAgo, formatBytes, formatCount } from '../../lib/format'
import { PluginControl } from './plugin-control'

/**
 * The projects home. Kondo opens here: every project Claude knows about with
 * the user store above them, and — for the one you pick — everything tied to
 * it on one page.
 *
 * The split is ADR-0007's two tiers made visible. The list is readdir counts
 * only, so it draws at once on a machine with thousands of projects; the page
 * is read for the row that was opened and for no other.
 */

/** A scope a skill or a plugin can be moved into (ADR-0008: ids, never paths). */
export interface Destination {
  id: string
  label: string
}

/**
 * The scopes kondo can write a skill into. The user store names itself
 * `user` — it is a store rather than an entity, so it has no id to pass —
 * and every other destination is a project id from this very list. Projects
 * with no `.claude` are left out: main refuses such a move by name anyway,
 * and a picker full of dead ends teaches nothing.
 */
function destinationsFrom(rows: ProjectRow[]): Destination[] {
  return [
    { id: 'user', label: 'Global (~/.claude)' },
    ...rows
      .filter((row) => !row.global && row.hasStore)
      .map((row) => ({ id: row.id, label: row.label }))
  ]
}

export function Projects() {
  const list = useScan((api) => api.projectsList())
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 gap-6">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter projects…"
            className="min-w-0 flex-1 rounded-md border border-edge bg-inset px-3 py-1.5 outline-none placeholder:text-mut focus:border-accent"
          />
          <button
            type="button"
            className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-mut hover:text-ink"
            onClick={() => void window.kondo?.projectsList(true).then(() => list.reload())}
          >
            Rescan
          </button>
        </div>
        <AsyncView state={list}>
          {(scan) => {
            const needle = query.trim().toLowerCase()
            // The global row is never filtered out: it is where the user
            // store lives, not one more project to search among.
            const rows = scan.data.filter(
              (row) => row.global || row.label.toLowerCase().includes(needle)
            )
            return (
              <ul className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
                {rows.map((row) => (
                  <li key={row.id}>
                    <ProjectButton
                      row={row}
                      active={(picked ?? scan.data[0]?.id) === row.id}
                      onPick={() => setPicked(row.id)}
                    />
                  </li>
                ))}
              </ul>
            )
          }}
        </AsyncView>
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {list.scan && (
          <ProjectPage
            id={picked ?? list.scan.data[0]?.id ?? ''}
            destinations={destinationsFrom(list.scan.data)}
            onChanged={list.reload}
          />
        )}
      </div>
    </div>
  )
}

/** The counts the list can show without opening a file; zeroes are left out. */
function countChips(row: ProjectRow): string[] {
  const { counts } = row
  return [
    counts.skills > 0 ? formatCount(counts.skills, 'skill') : null,
    counts.agents > 0 ? formatCount(counts.agents, 'agent') : null,
    counts.commands > 0 ? formatCount(counts.commands, 'command') : null,
    counts.rules > 0 ? formatCount(counts.rules, 'rule') : null,
    counts.settings > 0 ? formatCount(counts.settings, 'settings file') : null,
    row.sessionCount > 0 ? formatCount(row.sessionCount, 'session') : null
  ].filter((chip): chip is string => chip !== null)
}

function ProjectButton({
  row,
  active,
  onPick
}: {
  row: ProjectRow
  active: boolean
  onPick: () => void
}) {
  const chips = countChips(row)
  return (
    <button
      type="button"
      onClick={onPick}
      title={row.path ?? row.label}
      className={`w-full cursor-pointer rounded-md px-3 py-2 text-left ${
        active ? 'bg-inset text-ink' : 'text-mut hover:bg-inset/60 hover:text-ink'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate ${row.global ? 'font-semibold text-accent' : 'font-mono'}`}>
          {row.label}
        </span>
        {row.lastActivityMs > 0 && (
          <span className="shrink-0 text-[11px] text-mut">{formatAgo(row.lastActivityMs)}</span>
        )}
      </div>
      <div className="truncate text-[11px] text-mut">
        {/* A project kondo can name and cannot look inside is still a project
            (ADR-0005), and says so rather than showing a row of zeroes. */}
        {!row.global && !row.hasStore
          ? 'no .claude directory'
          : chips.length === 0
            ? 'nothing yet'
            : chips.join(' · ')}
      </div>
    </button>
  )
}

/** A settings file that is not there yet, held until the user says to create it. */
interface Pending {
  message: string
  retry: () => void
}

function ProjectPage({
  id,
  destinations,
  onChanged
}: {
  id: string
  destinations: Destination[]
  onChanged: () => void
}) {
  const state = useScan((api) => api.projectDetail(id), [id])
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const { reload } = state

  /**
   * Every mutation on this page ends the same way: report whatever main
   * refused with, keep the journal entry so the banner can offer the undo,
   * and re-read. ADR-0006 — the store is the state, so nothing is patched.
   */
  const run = async (
    call: (api: KondoApi) => Promise<Scan<JournalEntryInfo | null>>,
    retry?: () => void
  ): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(true)
    setRefusal(null)
    setPending(null)
    try {
      const done = await call(api)
      const error = done.errors[0]
      // A missing settings file is a question, not a failure: nothing was
      // written, and the file is created only if the user says so.
      if (error?.code === 'needs-confirmation' && retry) {
        setPending({ message: error.message, retry })
      } else {
        setRefusal(error?.message ?? null)
        setChange(done.data)
      }
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      reload()
      onChanged()
    }
  }

  /**
   * Hand this plugin to another scope: one call, one journal entry, two
   * settings files edited (ADR-0001). The source layer is the one this
   * scope's control already writes; which file the destination scope
   * receives it in is main's to choose, so only the scope id travels.
   */
  const move = (
    plugin: ProjectPluginState,
    destinationId: string,
    createLayer = false
  ): void => {
    void run(
      (api) => api.pluginMove(plugin.pluginId, plugin.targetLayerId, destinationId, createLayer),
      () => move(plugin, destinationId, true)
    )
  }

  const choose = (
    plugin: ProjectPluginState,
    choice: ProjectPluginChoice,
    createLayer = false
  ): void => {
    void run(
      (api) =>
        choice === 'inherit'
          ? api.pluginClear(plugin.pluginId, plugin.targetLayerId)
          : api.pluginToggle(
              plugin.pluginId,
              plugin.targetLayerId,
              choice === 'on' ? 'enable' : 'disable',
              createLayer
            ),
      () => choose(plugin, choice, true)
    )
  }

  return (
    <div className="space-y-4">
      {refusal !== null && <div className="card border-bad/50 text-bad">{refusal}</div>}
      {pending !== null && (
        <div className="card flex flex-wrap items-center gap-3">
          <span className="text-mut">{pending.message}</span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-ink hover:text-accent"
            onClick={pending.retry}
          >
            Create it
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {/* Keyed on the entry, so a second change starts a fresh banner rather
          than inheriting the first one's "undone". */}
      <LastChange key={change?.id} entry={change} onUndone={reload} />

      <AsyncView state={state}>
        {(scan) => {
          const detail = scan.data
          if (detail === null) {
            return <div className="card text-mut">That project is no longer in the scan.</div>
          }
          const { row } = detail
          // The user store names itself `user` as a destination; every other
          // scope is its own project id. A scope is never its own destination.
          const here = row.global ? 'user' : row.id
          const elsewhere = destinations.filter((destination) => destination.id !== here)
          return (
            <div className="space-y-4">
              <div>
                <h1 className="text-lg font-semibold">{row.label}</h1>
                <div className="font-mono text-xs text-mut">
                  {row.path ?? 'kondo cannot tell where this project is.'}
                </div>
              </div>

              {detail.storage && (
                <Section title="Storage" count={2}>
                  <div className="grid grid-cols-2 gap-4">
                    <StoreCard title="Claude Code store" report={detail.storage.user} />
                    <StoreCard title="Claude desktop store" report={detail.storage.desktop} />
                  </div>
                  <p className="mt-3 text-xs text-mut">
                    {formatCount(detail.storage.sessions.projectCount, 'project')} ·{' '}
                    {formatCount(detail.storage.sessions.sessionCount, 'session')} ·{' '}
                    {formatCount(detail.storage.sessions.staleCount, 'untouched session')} ·{' '}
                    {formatBytes(detail.storage.sessions.transcriptBytes)} of transcripts
                  </p>
                </Section>
              )}

              <Section title="Skills" count={detail.skills.length}>
                <SkillTable
                  skills={detail.skills}
                  destinations={destinations}
                  busy={busy}
                  run={run}
                />
              </Section>

              <Section title="Plugins" count={detail.plugins.length}>
                <div className="space-y-3">
                  {detail.plugins.map((plugin) => (
                    <div key={plugin.pluginId} className="flex flex-wrap items-start gap-3">
                      <span className="w-56 shrink-0 truncate font-mono" title={plugin.marketplace}>
                        {plugin.name}
                      </span>
                      <PluginControl
                        state={plugin}
                        global={row.global}
                        busy={busy}
                        destinations={elsewhere}
                        onChoose={(choice) => choose(plugin, choice)}
                        onMove={(destinationId) => move(plugin, destinationId)}
                      />
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Hooks" count={detail.hooks.length}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Matcher</th>
                      <th>Command</th>
                      <th>Settings file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.hooks.map((hook) => (
                      <tr key={hook.id}>
                        <td className="font-mono">{hook.event}</td>
                        <td className="font-mono text-mut">{hook.matcher ?? '*'}</td>
                        <td className="max-w-md truncate font-mono text-xs" title={hook.command}>
                          {hook.command}
                        </td>
                        <td
                          className="max-w-xs truncate font-mono text-xs text-mut"
                          title={hook.source}
                        >
                          {hook.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Agents" count={detail.agents.length}>
                <PlacedList entries={detail.agents} />
              </Section>
              <Section title="Commands" count={detail.commands.length}>
                <PlacedList entries={detail.commands} />
              </Section>
              <Section title="Rules" count={detail.rules.length}>
                <PlacedList entries={detail.rules} />
              </Section>
              {row.global && (
                <Section title="Output styles" count={detail.outputStyles.length}>
                  <PlacedList entries={detail.outputStyles} />
                </Section>
              )}

              <Section title="MCP servers" count={detail.mcpServers.length}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Server</th>
                      <th>Where</th>
                      <th>Transport</th>
                      <th>Declared in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.mcpServers.map((server) => (
                      <tr key={server.id} className={server.enabled ? '' : 'opacity-60'}>
                        <td className="font-mono">
                          {server.name}
                          {!server.enabled && <span className="pill ml-2 text-warn">off</span>}
                          {server.orphan && <span className="pill ml-2 text-bad">orphan</span>}
                        </td>
                        <td>
                          <span className="pill">{server.scope}</span>
                        </td>
                        <td className="text-mut">{server.transport}</td>
                        <td
                          className="max-w-xs truncate font-mono text-xs text-mut"
                          title={server.source}
                        >
                          {server.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section title="Settings files" count={detail.settings.length}>
                <div className="space-y-2">
                  {detail.settings.map((layer) => (
                    <div key={layer.id}>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="pill">{layer.layer}</span>
                        <span className="font-mono text-xs">{layer.path}</span>
                        <span className="text-xs text-mut">
                          {layer.exists ? formatBytes(layer.bytes) : 'not created yet'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {layer.keys.map((key) => (
                          <span key={key} className="pill font-mono">
                            {key}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {!row.global && (
                <Section title="Sessions" count={detail.sessions.length}>
                  <SessionTable
                    projectId={row.id}
                    sessions={detail.sessions}
                    busy={busy}
                    onTrash={(ids) => void run((api) => api.sessionTrash(ids))}
                  />
                </Section>
              )}
            </div>
          )
        }}
      </AsyncView>
    </div>
  )
}

function Section({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-mut">{count}</span>
      </h2>
      {count === 0 ? <div className="text-mut">None.</div> : children}
    </div>
  )
}

/**
 * Agents, commands, rules and output styles. Read-only in every scope
 * (ADR-0006), which is why there is no control in this list: Claude loads
 * them by presence and ships no convention for benching one.
 */
function PlacedList({ entries }: { entries: PlacedEntryInfo[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <span className="w-56 shrink-0 truncate font-mono" title={entry.origin}>
            {entry.name}
          </span>
          <span className="truncate text-mut" title={entry.description ?? undefined}>
            {entry.description ?? '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The matrix decides both the direction and whether the toggle is offered at
 * all (ADR-0006): whichever operation the entity permits is the one on the
 * button, and a row permitting neither carries its refusal as the tooltip.
 */
function toggleFor(skill: SkillInfo): { operation: ToggleOperation; reason: string | null } {
  return skill.capabilities.disable.allowed
    ? { operation: 'disable', reason: null }
    : {
        operation: 'enable',
        reason: skill.capabilities.enable.allowed ? null : skill.capabilities.enable.reason
      }
}

function SkillTable({
  skills,
  destinations,
  busy,
  run
}: {
  skills: SkillInfo[]
  destinations: Destination[]
  busy: boolean
  run: (call: (api: KondoApi) => Promise<Scan<JournalEntryInfo | null>>) => Promise<void>
}) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Description</th>
          <th>Move to</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {skills.map((skill) => {
          const { operation, reason } = toggleFor(skill)
          return (
            <tr key={skill.id} className={skill.enabled ? '' : 'opacity-60'}>
              <td className="font-mono" title={skill.origin}>
                {skill.name}
                {!skill.enabled && <span className="pill ml-2 text-warn">disabled</span>}
                {/* Claude's own skillUsage record, not a count kondo keeps.
                    A hint about a skill worth a second look — never a claim
                    that it should go. */}
                {skill.neverUsed && (
                  <span
                    className="pill ml-2 text-mut"
                    title="Claude has never recorded a use of this skill."
                  >
                    never used
                  </span>
                )}
              </td>
              <td className="max-w-md text-mut">{skill.description ?? '—'}</td>
              <td>
                <select
                  value=""
                  disabled={!skill.capabilities.move.allowed || busy}
                  title={skill.capabilities.move.reason ?? undefined}
                  className="max-w-xs cursor-pointer rounded-md border border-edge bg-transparent px-2 py-0.5 text-xs text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  onChange={(event) => {
                    const destinationId = event.target.value
                    if (destinationId !== '') {
                      void run((api) => api.skillMove(skill.id, destinationId))
                    }
                  }}
                >
                  <option value="">Move to…</option>
                  {destinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="text-right">
                <button
                  type="button"
                  disabled={reason !== null || busy}
                  title={reason ?? undefined}
                  className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void run((api) => api.skillToggle(skill.id, operation))}
                >
                  {operation === 'disable' ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * One project's sessions, and the two ways two of them turn out to be the
 * same work (entry 034). The mirror pill is free — main joined the desktop
 * store's listing to this one while building the rows. The near-duplicate
 * pass is not free: it opens the head of every transcript in this project,
 * so it is a button and never a default (ADR-0007).
 *
 * What is picked here is trashed as one journal entry, so a single undo puts
 * the whole selection back (ADR-0001) — which is why the confirmation counts
 * sessions rather than offering them one at a time.
 */
function SessionTable({
  projectId,
  sessions,
  busy,
  onTrash
}: {
  projectId: string
  sessions: SessionSummary[]
  busy: boolean
  onTrash: (ids: string[]) => void
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [groups, setGroups] = useState<SessionDuplicateGroup[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const find = async (): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setLooking(true)
    setProblem(null)
    try {
      const scan = await api.sessionNearDuplicates(projectId)
      // A transcript that would not open costs itself a group and nothing
      // else (ADR-0005), so whatever did group is still shown beside it.
      setProblem(scan.errors[0]?.message ?? null)
      setGroups(scan.data)
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLooking(false)
    }
  }

  /** Which group a session landed in, as a number its row can wear. */
  const groupOf = new Map<string, { at: number; prompt: string }>()
  groups?.forEach((group, at) => {
    for (const member of group.members) {
      groupOf.set(member.id, { at: at + 1, prompt: group.prompt })
    }
  })

  const pick = (id: string): void => {
    setConfirming(false)
    setPicked((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )
  }

  const trash = (): void => {
    setConfirming(false)
    onTrash(picked)
    // The store is the state (ADR-0006): what was picked and what was found
    // both describe the tree before the move, so neither survives it.
    setPicked([])
    setGroups(null)
  }

  const chosen = picked.filter((id) => sessions.some((session) => session.id === id))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={looking || busy}
          className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-xs text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void find()}
        >
          {looking ? 'Reading openings…' : 'Find near-duplicate openings'}
        </button>
        {groups !== null && (
          <span className="text-xs text-mut">
            {groups.length === 0
              ? 'No two sessions here open the same way.'
              : `${formatCount(groups.length, 'set')} of sessions open the same way.`}
          </span>
        )}
        {problem !== null && <span className="text-xs text-bad">{problem}</span>}
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th />
            <th>Session</th>
            <th className="text-right">Size</th>
            <th>Last activity</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const group = groupOf.get(session.id)
            return (
              <Fragment key={session.id}>
                <tr
                  className="cursor-pointer"
                  onClick={() => setOpened(opened === session.id ? null : session.id)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="cursor-pointer disabled:cursor-not-allowed"
                      disabled={busy}
                      checked={picked.includes(session.id)}
                      onChange={() => pick(session.id)}
                    />
                  </td>
                  <td className="font-mono">{session.uuid}</td>
                  <td className="text-right">{formatBytes(session.bytes)}</td>
                  <td className="text-mut">{formatAgo(session.mtimeMs)}</td>
                  <td>
                    {session.stale && <span className="pill mr-1 text-warn">untouched</span>}
                    {session.hasSidecar && <span className="pill mr-1">session folder</span>}
                    {session.mirroredIn !== null && (
                      <span
                        className="pill mr-1"
                        title={`The ${session.mirroredIn} store holds a session with this id — the same work recorded twice.`}
                      >
                        also in {session.mirroredIn}
                      </span>
                    )}
                    {group && (
                      <span className="pill" title={`Opens with: ${group.prompt}`}>
                        same opening #{group.at}
                      </span>
                    )}
                  </td>
                </tr>
                {opened === session.id && (
                  <tr>
                    <td colSpan={5}>
                      <SessionDetailView sessionId={session.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/50 p-2">
          <span>
            Move {formatCount(chosen.length, 'session')} — transcripts and their side files —
            into kondo&rsquo;s trash?
          </span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-warn/60 px-3 py-1 text-warn hover:bg-inset"
            onClick={trash}
          >
            Trash
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-edge px-3 py-1 text-mut hover:text-ink"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={chosen.length === 0 || busy}
          className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-xs text-mut hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setConfirming(true)}
        >
          {chosen.length === 0
            ? 'Select sessions to trash'
            : `Trash ${formatCount(chosen.length, 'session')}`}
        </button>
      )}
    </div>
  )
}

/** Tier-2, and only for the transcript actually opened (ADR-0007). */
function SessionDetailView({ sessionId }: { sessionId: string }) {
  const state = useScan((api) => api.sessionDetail(sessionId), [sessionId])
  return (
    <AsyncView state={state}>
      {(scan) =>
        scan.data === null ? (
          <span className="text-mut">No detail available.</span>
        ) : (
          <div className="space-y-1 py-1 text-xs">
            <div className="text-mut">
              {scan.data.messageCount.toLocaleString()} messages ·{' '}
              {scan.data.lineCount.toLocaleString()} events
              {scan.data.badLines > 0 && (
                <span className="text-warn"> · {scan.data.badLines} bad lines</span>
              )}
              {' · '}
              {scan.data.firstTimestamp ?? '?'} → {scan.data.lastTimestamp ?? '?'}
            </div>
            {scan.data.firstUserPrompt && (
              <div className="font-mono text-ink/90">“{scan.data.firstUserPrompt}”</div>
            )}
          </div>
        )
      }
    </AsyncView>
  )
}

/** What the old size dashboard was, now a section of the global row. */
function StoreCard({ title, report }: { title: string; report: StoreReport }) {
  return (
    <div className="rounded-md border border-edge p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-mut">{formatBytes(report.totalBytes)}</span>
      </div>
      <div className="mb-2 font-mono text-xs text-mut">{report.root}</div>
      {!report.exists ? (
        <div className="text-mut">Not found on this machine.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Entry</th>
              <th className="text-right">Size</th>
              <th>Touched</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.slice(0, 10).map((entry) => (
              <tr key={entry.name}>
                <td className="font-mono">
                  {entry.name}
                  {entry.type === 'dir' ? '/' : ''}
                </td>
                <td className="text-right">{formatBytes(entry.bytes)}</td>
                <td className="text-mut">{formatAgo(entry.mtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
