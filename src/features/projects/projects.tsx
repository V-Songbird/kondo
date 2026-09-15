import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { listView, PAGE } from './project-rows'
import type {
  HookScriptStatus,
  InheritedSkillState,
  JournalEntryInfo,
  KondoApi,
  McpServerInfo,
  McpServerStatus,
  PlacedEntryInfo,
  ProjectPluginChoice,
  ProjectPluginState,
  ProjectDetail,
  ProjectRow,
  Scan,
  SessionDuplicateGroup,
  SessionSummary,
  SessionTrashPreview,
  SkillInfo,
  StoreReport,
  StoresOverview,
  ToggleOperation
} from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { LastChange } from '../../ui/last-change'
import { MovePicker } from '../../ui/move-picker'
import { Refusal } from '../../ui/refusal'
import { useConfirmationFocus } from '../../ui/use-confirmation-focus'
import { flatKeyParts, formatAgo, formatBytes, formatCount, joinErrors } from '../../lib/format'
import { ReviewRefusal } from '../tidy/review-refusal'
import { mcpStatusFlag } from '../library/catalog'
import { PluginControl } from './plugin-control'

/**
 * Every project Claude knows about, with shared configuration above them.
 * The chosen project's overview routes to one focused category at a time.
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
    { id: 'user', label: 'All projects' },
    ...rows
      .filter((row) => !row.global && row.hasStore)
      .map((row) => ({ id: row.id, label: row.label }))
  ]
}

/**
 * Where the user is in this list: the filter, the open project, whether the
 * folded rows are showing, and how far down the page they have read.
 *
 * It lives in `App` rather than here. A trip to History to undo something
 * used to unmount this view and drop the user at the top of an unfiltered
 * list — which on a real store is 11,517 rows and up to twelve presses of
 * "Show 200 more" to get back to where they were.
 */
export interface ProjectsPlace {
  query: string
  picked: string | null
  showFolded: boolean
  limit: number
  section?: ProjectSection
  detailOpen?: boolean
}

export type ProjectSection = 'overview' | 'skills' | 'plugins' | 'connections' | 'tools' | 'sessions' | 'technical'

const PROJECT_SECTIONS: Array<{ id: ProjectSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'connections', label: 'Connections' },
  { id: 'tools', label: 'Other tools' },
  { id: 'sessions', label: 'Conversations' },
  { id: 'technical', label: 'Technical details' }
]

export const FIRST_PLACE: ProjectsPlace = {
  query: '',
  picked: null,
  showFolded: false,
  limit: PAGE,
  section: 'overview',
  detailOpen: false
}

export function Projects({
  place,
  onPlace
}: {
  place: ProjectsPlace
  onPlace: (next: ProjectsPlace) => void
}) {
  const list = useScan((api) => api.projectsList())
  const { query, picked, showFolded, limit } = place
  const filterRef = useRef<HTMLInputElement>(null)
  const returningToBrowser = useRef(false)
  useEffect(() => {
    if (returningToBrowser.current && !place.detailOpen) {
      returningToBrowser.current = false
      filterRef.current?.focus()
    }
  }, [place.detailOpen])
  // Bumped by Rescan so the detail pane re-reads too: the list and the
  // Storage section are projections of one inventory (ADR-0007) and must not
  // disagree about the project set after a rescan.
  const [rescans, setRescans] = useState(0)
  const [rescanning, setRescanning] = useState(false)
  const [rescanProblem, setRescanProblem] = useState<string | null>(null)

  const rescan = async (): Promise<void> => {
    setRescanning(true)
    setRescanProblem(null)
    try {
      if (!window.kondo) throw new Error('The connection to kondo is unavailable. Reopen the app and try again.')
      const scan = await window.kondo.projectsList(true)
      setRescanProblem(joinErrors(scan.errors))
      list.reload()
      setRescans((count) => count + 1)
    } catch (cause) {
      setRescanProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRescanning(false)
    }
  }

  return (
    <div className="workspace-split" data-detail-open={place.detailOpen ? 'true' : 'false'}>
      <div className="workspace-browser gap-3">
        <div>
          <h2>Projects</h2>
          <p className="mt-2 text-ink-2">Choose where to manage Claude Code. All projects holds your shared configuration.</p>
        </div>
        <div className="flex items-end gap-3">
          <input
            ref={filterRef}
            aria-label="Filter projects"
            value={query}
            onChange={(event) =>
              onPlace({ ...place, query: event.target.value, limit: PAGE })
            }
            placeholder="Filter projects…"
            className="field min-w-0 flex-1"
          />
          <button
            type="button"
            disabled={rescanning}
            className="btn btn-quiet btn-sm"
            onClick={() => void rescan()}
          >
            {rescanning ? 'Rescanning…' : 'Rescan'}
          </button>
        </div>
        {rescanProblem !== null && <div role="alert" className="band band-pencil">{rescanProblem}</div>}
        <AsyncView state={list}>
          {(scan) => {
            // The global row is never filtered out: it is where the user
            // store lives, not one more project to search among.
            const view = listView(scan.data, { query, showFolded, limit })
            return (
              <ul className="min-h-0 flex-1 overflow-auto">
                {view.shown.map((row) => (
                  <li key={row.id}>
                    <ProjectButton
                      row={row}
                      active={(picked ?? scan.data[0]?.id) === row.id}
                      onPick={() => onPlace({ ...place, picked: row.id, section: 'overview', detailOpen: true })}
                    />
                  </li>
                ))}
                {/* Only the global row surviving means the filter matched no
                    project — a list of one that looks like a bug unless it says so. */}
                {!view.matched && (
                  <li className="px-2 py-2 text-ink-2">
                    {query.trim() === ''
                      ? 'Claude has not recorded any project on this machine yet.'
                      : `No project matches “${query.trim()}”.`}
                  </li>
                )}
                {view.more > 0 && (
                  <li>
                    <button
                      type="button"
                      className="w-full cursor-pointer px-2 py-2 text-left text-xs text-ink-2 hover:text-ink"
                      onClick={() => onPlace({ ...place, limit: limit + PAGE })}
                    >
                      Show {formatCount(Math.min(view.more, PAGE), 'more project')} of{' '}
                      {view.more.toLocaleString()} left
                    </button>
                  </li>
                )}
                {(view.hidden > 0 || showFolded) && (
                  <li className="px-2 py-2 text-xs text-ink-2">
                    {/* Nothing to open in a throwaway run or a project whose
                        folder is gone; Clean up is where those are dealt with. */}
                    {showFolded
                      ? 'Showing throwaway runs and projects whose folder is gone. '
                      : `${formatCount(view.hidden, 'project')} Claude records ${
                          view.hidden === 1 ? 'is a throwaway run or is' : 'are throwaway runs or are'
                        } no longer on disk — Clean up lists them. `}
                    <button
                      type="button"
                      className="cursor-pointer underline underline-offset-2 hover:text-ink"
                      onClick={() =>
                        onPlace({ ...place, showFolded: !showFolded, limit: PAGE })
                      }
                    >
                      {showFolded ? 'Hide them' : 'Show them'}
                    </button>
                  </li>
                )}
              </ul>
            )
          }}
        </AsyncView>
      </div>
      <div className="workspace-detail">
        <button
          type="button"
          className="btn btn-quiet workspace-back"
          onClick={() => {
            returningToBrowser.current = true
            onPlace({ ...place, picked: null, detailOpen: false, section: 'overview' })
          }}
        >
          Back to projects
        </button>
        {list.scan && (
          <ProjectPage
            key={`${picked ?? list.scan.data[0]?.id ?? ''}:${place.detailOpen ? 'open' : 'closed'}`}
            id={picked ?? list.scan.data[0]?.id ?? ''}
            section={place.section ?? 'overview'}
            focusDetail={place.detailOpen ?? false}
            onSection={(section) => onPlace({ ...place, section, detailOpen: true })}
            generation={rescans}
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
      aria-current={active ? 'true' : undefined}
      className="row-item"
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* The name, not the whole path: on a real store every path shares a
            long prefix and the name is the part a truncation used to cut.

            A null parent is main saying it could not locate the project, and
            in that case the name IS the flattened directory key — so it is
            drawn with its damage showing, the surviving runs in the primary
            ink and the hyphens faint (DESIGN.md). Never anywhere else: a
            hyphen in a real path is a legitimate character. */}
        <span className={`truncate ${row.global ? 'font-semibold' : 'font-medium'}`}>
          {row.parent === null && !row.global ? (
            <span className="flat">
              {flatKeyParts(row.name).map((part, index) => (
                <span key={index} className={part.gap ? 'gap' : 'word'}>
                  {part.text}
                </span>
              ))}
            </span>
          ) : (
            row.global ? 'All projects' : row.name
          )}
        </span>
        {row.lastActivityMs > 0 && (
          <span className="shrink-0 text-[11px] text-ink-2">{formatAgo(row.lastActivityMs)}</span>
        )}
      </div>
      {row.parent !== null && !row.global && (
        <div className="truncate font-mono text-[10.5px] text-ink-2">{row.parent}</div>
      )}
      <div className="truncate text-[11px] text-ink-2">
        {/* A project kondo can name and cannot look inside is still a project
            (ADR-0005), and says so rather than showing a row of zeroes. */}
        {!row.global && !row.hasStore
          ? 'No project configuration found'
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
  section,
  focusDetail,
  onSection,
  generation,
  destinations,
  onChanged
}: {
  id: string
  section: ProjectSection
  focusDetail: boolean
  onSection: (section: ProjectSection) => void
  /** Changes when the list was rescanned, so this pane re-reads with it. */
  generation: number
  destinations: Destination[]
  onChanged: () => void
}) {
  const state = useScan((api) => api.projectDetail(id), [id, generation])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusedSection = useRef<string | null>(null)
  // A selected detail may arrive after the browser has disappeared at the
  // narrow width. Focus once it exists, but never steal focus on a reload.
  useEffect(() => {
    if (!focusDetail) focusedSection.current = null
    if (focusDetail && state.scan?.data && focusedSection.current !== section) {
      headingRef.current?.focus()
      focusedSection.current = section
    }
  }, [focusDetail, section, state.scan])
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const refusalRef = useRef<HTMLDivElement>(null)
  const [staleSelection, setStaleSelection] = useState<string | null>(null)
  const removalSelection = useRef('Selected conversations')
  const [pending, setPending] = useState<Pending | null>(null)
  const [change, setChange] = useState<JournalEntryInfo | null>(null)
  const pendingCancelled = useRef(false)
  const confirmation = useConfirmationFocus(pending !== null, () => {
    pendingCancelled.current = true
    setPending(null)
  })
  useEffect(() => {
    if (refusal !== null && staleSelection === null) refusalRef.current?.focus()
  }, [refusal, staleSelection])
  useEffect(() => {
    if (pending === null && pendingCancelled.current) {
      pendingCancelled.current = false
      // A settings question can follow a move question whose confirm button
      // has already unmounted. The project heading is the safe fallback.
      if (document.activeElement === document.body) headingRef.current?.focus()
    }
  }, [pending])
  const questionId = useId()
  const { reload } = state
  const selectSection = (next: ProjectSection): void => {
    setPending(null)
    onSection(next)
  }

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
    if (pending === null) confirmation.rememberFocus()
    setBusy(true)
    setRefusal(null)
    setStaleSelection(null)
    setPending(null)
    try {
      const done = await call(api)
      const error = done.errors[0]
      // A missing settings file is a question, not a failure: nothing was
      // written, and the file is created only if the user says so.
      if (error?.code === 'needs-confirmation' && retry) {
        setPending({ message: error.message, retry })
      } else {
        // Every message, not just the first: a move refuses per step
        // (ADR-0005), and showing one of four hid the other three.
        if (done.errors.some((entry) => entry.code === 'stale-plan')) setStaleSelection(removalSelection.current)
        setRefusal(joinErrors(done.errors))
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
    <div>
      {refusal !== null && (staleSelection !== null
        ? <ReviewRefusal reason={refusal} selection={staleSelection} onReview={() => {
            setRefusal(null)
            setStaleSelection(null)
            headingRef.current?.focus()
          }} />
        : <div ref={refusalRef} tabIndex={-1} role="alert" className="band band-pencil text-pencil">{refusal}</div>)}
      {pending !== null && (
        <div className="band" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
          <span id={questionId} className="text-ink-2">{pending.message}</span>
          <button type="button" disabled={busy} className="btn btn-go btn-sm" onClick={pending.retry}>
            Create it
          </button>
          <button
            ref={confirmation.cancelRef}
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={confirmation.cancel}
          >
            Cancel
          </button>
        </div>
      )}
      {/* Keyed on the entry, so a second change starts a fresh banner rather
          than inheriting the first one's "undone". */}
      <LastChange key={change?.id} entry={change} onUndone={() => { reload(); onChanged() }} />

      <AsyncView state={state}>
        {(scan) => {
          const detail = scan.data
          if (detail === null) {
            return <div className="sheet text-ink-2">That project is no longer in the scan.</div>
          }
          const { row } = detail
          // The user store names itself `user` as a destination; every other
          // scope is its own project id. A scope is never its own destination.
          const here = row.global ? 'user' : row.id
          const elsewhere = destinations.filter((destination) => destination.id !== here)
          return (
            <div>
              <div className="sheet hero">
                <h1 ref={headingRef} tabIndex={-1}>
                  {row.global ? 'All projects' : row.name}
                  {section !== 'overview' && <span className="text-ink-2"> / {PROJECT_SECTIONS.find((item) => item.id === section)?.label}</span>}
                </h1>
                <p className="mt-2 text-ink-2">
                  {row.global
                    ? 'Shared Claude Code configuration. Individual projects can override these settings.'
                    : 'Manage Claude Code for this project. Shared skills and plugin settings can also apply here.'}
                </p>
                <details className="technical-details mt-2">
                  <summary>Project location</summary>
                  <div className="mt-2 break-words font-mono text-xs text-ink-2">
                    {row.path ?? 'kondo cannot tell where this project is.'}
                  </div>
                </details>
              </div>

              <nav aria-label="Project sections" className="section-nav mb-7 flex flex-wrap gap-2">
                {PROJECT_SECTIONS.filter((item) => !row.global || item.id !== 'sessions').map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-current={section === item.id ? 'page' : undefined}
                    onClick={() => selectSection(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>

              {section === 'overview' && <ProjectOverview detail={detail} onSection={selectSection} />}

              {section === 'technical' && detail.storage && (
                <Section title="Storage" tone="lime">
                  <div className="flex flex-col gap-7">
                    <StoreCard title="Claude Code store" report={detail.storage.user} />
                    <StoreCard title="Claude desktop store" report={detail.storage.desktop} />
                  </div>
                  <SessionCounts sessions={detail.storage.sessions} />
                </Section>
              )}

              {section === 'skills' && (
                <>
                  <p className="mb-5 text-ink-2">Skills teach Claude how to do a task. Turn one on or off, or move it to another project. Changes can be undone from History.</p>
                  <Section
                    title="Skills"
                    count={detail.skills.length}
                    empty={row.global ? 'No shared skills found. Skills added here can be available in every project.' : 'No skills belong only to this project. Shared skills appear below.'}
                  >
                    <SkillTable
                      skills={detail.skills}
                      destinations={elsewhere}
                      busy={busy}
                      run={run}
                    />
                  </Section>

                  {!row.global && (
                    <Section
                      title="Shared from All projects"
                      tone="blush"
                      count={detail.inheritedSkills.length}
                      empty="No shared skills are available for this project."
                    >
                      <InheritedSkillTable
                        entries={detail.inheritedSkills}
                        busy={busy}
                        run={run}
                      />
                    </Section>
                  )}
                </>
              )}

              {section === 'plugins' && (
                <>
                  <p className="mb-5 text-ink-2">Plugins bundle tools for Claude. Choose whether each plugin is enabled here. Moving a plugin turns it off here and on at the destination; it stays installed.</p>
                  <Section
                    title="Plugins"
                    tone="orchid"
                    count={detail.plugins.length}
                    empty="No plugins are installed for Claude on this machine."
                  >
                    <div>
                      {detail.plugins.map((plugin) => (
                        <div
                          key={plugin.pluginId}
                          className="flex flex-wrap items-start gap-4 border-b border-line py-3 last:border-0"
                        >
                          <span className="w-56 shrink-0 truncate font-medium" title={plugin.marketplace}>
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
                </>
              )}

              {section === 'technical' && (
                <Section
                  title="Hooks"
                  tone="mustard"
                  count={detail.hooks.length}
                  empty="Nothing here runs a command on a Claude event. A hook only exists once a settings file names it."
                >
                  {/* Five columns outgrow the sheet on a narrow window, so the
                      table scrolls inside it rather than the page. */}
                  <div className="overflow-x-auto">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Type</th>
                          <th>Matcher</th>
                          <th>Script</th>
                          <th>Settings file</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.hooks.map((hook) => (
                          <tr key={hook.id}>
                            <td className="font-mono text-xs">
                              {hook.event ?? <span className="stamp-unknown">not recognized</span>}
                            </td>
                            <td className="font-mono text-xs text-ink-2">{hook.type ?? '—'}</td>
                            <td className="text-xs text-ink-2">{hook.hasMatcher ? 'set' : '—'}</td>
                            <td>
                              <HookScriptCell script={hook.script} />
                            </td>
                            <td
                              className="max-w-xs truncate font-mono text-xs text-ink-2"
                              title={hook.source}
                            >
                              {hook.source}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-ink-2">
                    Commands, matcher patterns and names Kondo does not recognize can hold private
                    values, so they are not shown. Open the settings file to read them.
                  </p>
                </Section>
              )}

              {section === 'tools' && (
                <>
                  <p className="mb-5 text-ink-2">Other ways to customize Claude: specialist agents, reusable commands, instructions and response styles.</p>
                  <Section
                    title="Agents"
                    tone="teal"
                    count={detail.agents.length}
                    empty="No specialist agents have been added here."
                  >
                    <PlacedList entries={detail.agents} destinations={elsewhere} busy={busy} run={run} />
                  </Section>
                  <Section
                    title="Commands"
                    tone="lime"
                    count={detail.commands.length}
                    empty="No reusable commands have been added here."
                  >
                    <PlacedList entries={detail.commands} destinations={elsewhere} busy={busy} run={run} />
                  </Section>
                  <Section
                    title="Rules"
                    tone="coral"
                    count={detail.rules.length}
                    empty="No additional instructions have been added here."
                  >
                    <PlacedList entries={detail.rules} destinations={elsewhere} busy={busy} run={run} />
                  </Section>
                  {row.global && (
                    <Section
                      title="Output styles"
                    tone="orchid"
                      count={detail.outputStyles.length}
                      empty="No response styles have been added here."
                    >
                      {/* ADR-0006: Claude reads output styles from the user store
                          only, so there is no scope to offer. Said in the column
                          rather than by an empty picker. */}
                      <PlacedList
                        entries={detail.outputStyles}
                        destinations={[]}
                        nowhere="Response styles apply to all projects, so they cannot be moved to one project."
                        busy={busy}
                        run={run}
                      />
                    </Section>
                  )}
                </>
              )}

              {section === 'connections' && (
                <>
                  <p className="mb-5 text-ink-2">Connections let Claude use external tools through MCP. This list shows the saved configuration and what Claude Code does with it here, not whether a server is running or connected.</p>
                  <p className="mb-5 text-ink-2">Turning one on or off for a project edits Claude’s settings, which Kondo cannot do safely yet. Claude Code’s own <code>/mcp</code> panel switches a connection for the project you are in.</p>
                  <Section
                    title="Connections (MCP)"
                    tone="teal"
                    count={detail.mcpServers.length}
                    empty="No connections are configured here."
                  >
                    <McpTable
                      rows={detail.mcpServers.map((server) => ({
                        server,
                        status: server.status,
                        statusReason: server.statusReason
                      }))}
                    />
                  </Section>
                  {!row.global && (
                    <Section
                      title="Shared from All projects"
                      tone="blush"
                      count={detail.inheritedMcpServers.length}
                      empty="No shared connections are available for this project."
                    >
                      {/* A user-scope declaration reaches every project, and
                          Claude switches it off one project at a time. */}
                      <McpTable
                        rows={detail.inheritedMcpServers.map((entry) => ({
                          server: entry.server,
                          status: entry.status,
                          statusReason: entry.statusReason
                        }))}
                      />
                    </Section>
                  )}
                </>
              )}

              {section === 'technical' && (
                <Section
                  title="Settings files"
                  tone="orchid"
                  count={detail.settings.length}
                  empty="No settings file exists here yet. Kondo creates one only when you ask it to."
                >
                  <div>
                    {detail.settings.map((layer) => (
                      <div key={layer.id} className="border-b border-line py-2.5 last:border-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="stamp">{layer.layer}</span>
                          <span className="font-mono text-xs">{layer.path}</span>
                          <span className="text-xs text-ink-2">
                            {layer.exists ? formatBytes(layer.bytes) : 'not created yet'}
                          </span>
                        </div>
                        {layer.keys.length > 0 && (
                          <div className="mt-1 font-mono text-[11px] text-ink-2">
                            {layer.keys.join(' · ')}
                          </div>
                        )}
                        {layer.unlistedKeys && (
                          <div className="mt-1 text-xs text-ink-2">
                            Other top-level settings are not shown. Kondo lists only documented setting names.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {section === 'sessions' && !row.global && (
                <Section
                  title="Conversations"
                tone="blush"
                  count={detail.sessions.length}
                  empty="Claude has recorded no conversation in this project."
                >
                  <SessionTable
                    projectId={row.id}
                    sessions={detail.sessions}
                    staleAfterDays={detail.staleAfterDays}
                    busy={busy}
                    onTrash={(ids, token) => {
                      removalSelection.current = formatCount(ids.length, 'conversation')
                      void run((api) => api.sessionTrash(ids, token))
                    }}
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

function ProjectOverview({ detail, onSection }: {
  detail: ProjectDetail
  onSection: (section: ProjectSection) => void
}) {
  const { row } = detail
  const choices: Array<{ section: ProjectSection; title: string; amount: string; description: string }> = [
    {
      section: 'skills', title: 'Skills',
      amount: `${detail.skills.length} here${row.global ? '' : ` · ${detail.inheritedSkills.length} shared`}`,
      description: 'Instructions that teach Claude how to do a task. Review, enable or move them.'
    },
    {
      section: 'plugins', title: 'Plugins', amount: formatCount(detail.plugins.length, 'installed plugin'),
      description: 'Bundles of tools. Choose which ones are enabled in this place.'
    },
    {
      section: 'connections', title: 'Connections', amount: formatCount(detail.mcpServers.length, 'saved connection'),
      description: 'External tools configured for Claude through MCP. This does not check whether they are connected.'
    },
    {
      section: 'tools', title: 'Other tools',
      amount: formatCount(detail.agents.length + detail.commands.length + detail.rules.length + detail.outputStyles.length, 'item'),
      description: 'Specialist agents, commands, instructions and response styles.'
    }
  ]
  if (!row.global) choices.push({
    section: 'sessions', title: 'Conversations', amount: formatCount(detail.sessions.length, 'saved conversation'),
    description: 'Review past conversations and move selected copies to trash.'
  })
  return (
    <Section title="What would you like to manage?">
      <div>
        {choices.map((choice) => (
          <div key={choice.section} className="border-b border-line py-3 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => onSection(choice.section)}>
                {choice.title}
              </button>
              <span className="text-xs text-ink-2">{choice.amount}</span>
            </div>
            <p className="mt-1 text-ink-2">{choice.description}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-ink-2">Choose a category to see its controls. Moving an item asks for a destination and confirmation; History lets you undo changes.</p>
      <div className="mt-3">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onSection('technical')}>Technical details</button>
        <p className="mt-1 text-xs text-ink-2">Inspect settings files, event commands and storage information.</p>
      </div>
    </Section>
  )
}

/**
 * The store's session figures, with both project numbers said out loud.
 * `projectCount` is the whole set — registry keys and transcript directories
 * alike (domain.md) — so it counts folders Claude merely has on record.
 * Showing it alone made that wider definition read as sessions having gone
 * missing, which is why the subset that actually holds transcripts is spelled
 * out beneath it rather than replacing it.
 */
function SessionCounts({ sessions }: { sessions: StoresOverview['sessions'] }) {
  const onRecordOnly = sessions.projectCount - sessions.transcriptProjectCount
  return (
    <>
      <p className="mt-4 text-xs text-ink-2">
        {formatCount(sessions.projectCount, 'project')} Claude has on record ·{' '}
        {formatCount(sessions.sessionCount, 'session')} ·{' '}
        {formatCount(sessions.staleCount, 'untouched session')} ·{' '}
        {formatBytes(sessions.transcriptBytes)} of transcripts
      </p>
      <p className="mt-1 text-xs text-ink-2">
        Of those: {formatCount(sessions.transcriptProjectCount, 'project')} with sessions
        saved
        {onRecordOnly > 0 &&
          `, ${formatCount(onRecordOnly, 'project')} Claude has on record but never worked in`}
        .
      </p>
    </>
  )
}

/**
 * One section of a project page: a ruled block with its heading on the heavy
 * rule and the count in the margin. A section with nothing in it says what
 * that means for *this* kind rather than printing "None." — a bare word above
 * a bare header is the thing a first-time user cannot read.
 */
/** Legacy kind names retained in markup; DESIGN.md keeps all sections uncoloured. */
type Tone = 'blush' | 'orchid' | 'lime' | 'teal' | 'coral' | 'mustard'

function Section({
  title,
  tone = 'blush',
  count,
  empty,
  children
}: {
  title: string
  tone?: Tone
  /** How many rows the card holds; left off a card that is not a list. */
  count?: number
  empty?: string
  children: ReactNode
}) {
  return (
    <section className="sheet" data-tone={tone}>
      <div className="sheet-head">
        <h2>{title}</h2>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {count === 0 ? (
        <div className="text-ink-2">{empty ?? 'Nothing here yet.'}</div>
      ) : (
        <div className="min-w-0 overflow-x-auto">{children}</div>
      )}
    </section>
  )
}

/** How each script status reads, and the pencil that carries the finding. */
const SCRIPT_TONE: Record<HookScriptStatus, { label: string; tone: string }> = {
  present: { label: 'on disk', tone: 'stamp-ok' },
  // The one row worth looking at: a settings layer arms this and Claude
  // fails it every time it fires.
  missing: { label: 'not found', tone: 'stamp-bad' },
  unverifiable: { label: 'cannot check', tone: 'stamp-unknown' }
}

/**
 * Whether the script a hook runs is there. "cannot check" is not a shrug: the
 * path holds a variable kondo does not expand, or it lies outside the stores
 * kondo may read (ADR-0002). The path itself stays in main (ADR-0022).
 */
function HookScriptCell({ script }: { script: HookScriptStatus | null }) {
  if (script === null) return <span className="text-ink-2">—</span>
  const { label, tone } = SCRIPT_TONE[script]
  return <span className={tone}>{label}</span>
}

/**
 * Agents, commands, rules and output styles. Moving one is putting its file
 * in the other scope's directory, which is exactly how Claude loads it there,
 * so the picker is the same one a skill has and lands on the same generic
 * seat (`entityMutate`, ADR-0004). Neither toggle has a mechanism (ADR-0006):
 * Claude loads these by presence and ships no convention for benching one.
 * The matrix says so in one sentence, the same for every row, so it is said
 * once beneath the table rather than on every line.
 */
function PlacedList({
  entries,
  destinations,
  nowhere,
  busy,
  run
}: {
  entries: PlacedEntryInfo[]
  destinations: Destination[]
  /** Why there is no picker at all, for the kind with a single scope. */
  nowhere?: string
  busy: boolean
  run: (call: (api: KondoApi) => Promise<Scan<JournalEntryInfo | null>>) => Promise<void>
}) {
  const benched = entries[0]?.capabilities.disable.reason ?? null
  return (
    <div className="space-y-2">
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Move to</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="font-medium whitespace-nowrap" title={entry.origin}>
                {entry.name}
              </td>
              <td className="max-w-md text-ink-2" title={entry.description ?? undefined}>
                {entry.description ?? '—'}
              </td>
              <td>
                {nowhere !== undefined ? (
                  <Refusal reason={nowhere} />
                ) : (
                  <MovePicker
                    name={entry.name}
                    destinations={destinations}
                    disabled={!entry.capabilities.move.allowed || busy}
                    onMove={(targetId) =>
                      void run((api) => api.entityMutate(entry.id, { op: 'move', targetId }))
                    }
                  />
                )}
                <Refusal reason={entry.capabilities.move.reason} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Refusal reason={benched} />
    </div>
  )
}

/**
 * The matrix decides both the direction and whether the toggle is offered at
 * all (ADR-0006): whichever operation the entity permits is the one on the
 * button, and a row permitting neither carries its refusal on screen beneath
 * it — main already wrote the sentence, and a tooltip is where a refusal goes
 * to be unread.
 */
function toggleFor(skill: SkillInfo): { operation: ToggleOperation; reason: string | null } {
  return skill.capabilities.disable.allowed
    ? { operation: 'disable', reason: null }
    : {
        operation: 'enable',
        reason: skill.capabilities.enable.allowed ? null : skill.capabilities.enable.reason
      }
}

/**
 * The global skills a project inherits, with the one switch Claude gives a
 * project over them (entry 062): `skillOverrides[<name>] = "off"` in its own
 * settings layer. "Off here" and "Follows global" are the plugin control's
 * words for the same two positions, kept so the page speaks one language.
 */
function InheritedSkillTable({
  entries,
  busy,
  run
}: {
  entries: InheritedSkillState[]
  busy: boolean
  run: (
    call: (api: KondoApi) => Promise<Scan<JournalEntryInfo | null>>,
    retry?: () => void
  ) => Promise<void>
}) {
  const toggle = (entry: InheritedSkillState, operation: ToggleOperation, confirm = false): void => {
    void run(
      (api) =>
        api.entityMutate(entry.skill.id, { op: operation, targetId: entry.projectId, confirm }),
      () => toggle(entry, operation, true)
    )
  }
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Description</th>
          <th>In this project</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          // One direction at a time, decided by the project's own layers.
          const operation: ToggleOperation = entry.choice === 'inherit' ? 'disable' : 'enable'
          const reason = entry.capabilities[operation].allowed
            ? null
            : entry.capabilities[operation].reason
          return (
            <tr key={entry.skill.id} data-force={entry.enabledHere ? undefined : 'off'}>
              <td className="font-medium whitespace-nowrap" title={entry.skill.origin}>
                {entry.skill.name}
              </td>
              <td className="max-w-md text-ink-2">{entry.skill.description ?? '—'}</td>
              <td>
                {/* Why it is off matters: this project's own switch, or Global's. */}
                {entry.choice === 'off' ? (
                  <span className="stamp-off">off here</span>
                ) : entry.skill.enabled ? (
                  <span className="stamp-ok">on</span>
                ) : (
                  <span className="stamp-off">off in All projects</span>
                )}
              </td>
              <td className="text-right">
                <button
                  type="button"
                  disabled={reason !== null || busy}
                  aria-label={`${operation === 'disable' ? 'Off here' : 'Follow shared setting'}: ${entry.skill.name}`}
                  className="btn btn-quiet btn-sm"
                  onClick={() => toggle(entry, operation)}
                >
                  {operation === 'disable' ? 'Off here' : 'Follow shared setting'}
                </button>
                <Refusal reason={reason} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * One MCP declaration per row: where it is declared, what Claude Code does
 * with it here, and why (entry 103). No switch — the change is a settings
 * edit, refused whole (ADR-0010) — so the section says that once above the
 * table instead of offering a control that cannot run.
 */
function McpTable({
  rows
}: {
  rows: Array<{ server: McpServerInfo; status: McpServerStatus; statusReason: string | null }>
}) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Server</th>
          <th>Where</th>
          <th>In Claude Code</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ server, status, statusReason }) => {
          const flag = mcpStatusFlag(status)
          const inUse = status === 'configured' || status === 'approved'
          return (
            <tr key={server.id} data-force={inUse ? undefined : 'off'}>
              <td className="font-medium whitespace-nowrap">
                {server.name}
                {server.orphan && (
                  <span
                    className="stamp-bad ml-2"
                    title="The folder this declaration points at is no longer on disk."
                  >
                    project is gone
                  </span>
                )}
              </td>
              <td>
                <span className="stamp">
                  {server.scope === 'user'
                    ? 'All projects'
                    : server.scope === 'local'
                      ? 'This project only'
                      : 'This project'}
                </span>
              </td>
              <td>
                <span className={flag.tone === 'fact' ? 'stamp' : `stamp-${flag.tone}`}>
                  {flag.text}
                </span>
                {statusReason !== null && (
                  <p className="mt-1 text-xs text-ink-2">{statusReason}</p>
                )}
              </td>
              <td className="text-ink-2">
                <details>
                  <summary>Connection details</summary>
                  <div className="mt-2 text-xs break-words">
                    Transport: {server.transport}
                    <br />
                    Settings file: {server.source}
                  </div>
                </details>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
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
  run: (
    call: (api: KondoApi) => Promise<Scan<JournalEntryInfo | null>>,
    retry?: () => void
  ) => Promise<void>
}) {
  /**
   * A toggle is a settings edit (ADR-0006), and the layer it lands in may not
   * exist yet: main asks first, and the retry is the same request with the
   * user's yes on it — the file is created only then.
   */
  const toggle = (skill: SkillInfo, operation: ToggleOperation, confirm = false): void => {
    void run(
      (api) => api.entityMutate(skill.id, { op: operation, confirm }),
      () => toggle(skill, operation, true)
    )
  }
  return (
    <table className="ledger">
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
            <tr key={skill.id} data-force={skill.enabled ? undefined : 'off'}>
              <td className="font-medium whitespace-nowrap" title={skill.origin}>
                {skill.name}
                {!skill.enabled && <span className="stamp-off ml-2">disabled</span>}
                {/* Claude's own skillUsage record, not a count kondo keeps.
                    A hint about a skill worth a second look — never a claim
                    that it should go. */}
                {skill.neverUsed === true && (
                  <span
                    className="stamp-unknown ml-2"
                    title="Claude has never recorded a use of this skill."
                  >
                    never used
                  </span>
                )}
              </td>
              <td className="max-w-md text-ink-2">{skill.description ?? '—'}</td>
              <td>
                <MovePicker
                  name={skill.name}
                  destinations={destinations}
                  disabled={!skill.capabilities.move.allowed || busy}
                  onMove={(destinationId) => void run((api) => api.skillMove(skill.id, destinationId))}
                />
                <Refusal reason={skill.capabilities.move.reason} />
              </td>
              <td className="text-right">
                <button
                  type="button"
                  disabled={reason !== null || busy}
                  aria-label={`${operation === 'disable' ? 'Disable' : 'Enable'} ${skill.name}`}
                  className="btn btn-quiet btn-sm"
                  onClick={() => toggle(skill, operation)}
                >
                  {operation === 'disable' ? 'Disable' : 'Enable'}
                </button>
                <div className="text-left">
                  <Refusal reason={reason} />
                </div>
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
 * same work (entry 034). The mirror stamp is free — main joined the desktop
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
  staleAfterDays,
  busy,
  onTrash
}: {
  projectId: string
  sessions: SessionSummary[]
  /** The day count behind `stale`, from the same detail payload as the rows. */
  staleAfterDays: number
  busy: boolean
  onTrash: (ids: string[], token: string) => void
}) {
  const [opened, setOpened] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [review, setReview] = useState<(SessionTrashPreview & { ids: string[] }) | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const requestNumber = useRef(0)
  useEffect(() => () => { requestNumber.current += 1 }, [])
  const cancelReview = (): void => {
    requestNumber.current += 1
    setReview(null)
    setReviewing(false)
  }
  const [groups, setGroups] = useState<SessionDuplicateGroup[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const problemRef = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (problem !== null) problemRef.current?.focus() }, [problem])
  const sectionId = useId()
  const trashButtonId = useId()
  const questionId = useId()
  const confirmation = useConfirmationFocus(review !== null || reviewing, cancelReview, review?.reviewToken)

  const find = async (): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setLooking(true)
    setProblem(null)
    try {
      const scan = await api.sessionNearDuplicates(projectId)
      // A transcript that would not open costs itself a group and nothing
      // else (ADR-0005), so whatever did group is still shown beside it.
      setProblem(joinErrors(scan.errors))
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
    cancelReview()
    setPicked((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )
  }

  const trash = (): void => {
    if (review === null) return
    setReview(null)
    onTrash(review.ids, review.reviewToken)
    // The store is the state (ADR-0006): what was picked and what was found
    // both describe the tree before the move, so neither survives it.
    setPicked([])
    setGroups(null)
  }

  const chosen = picked.filter((id) => sessions.some((session) => session.id === id))
  const prepareReview = async (): Promise<void> => {
    const api = window.kondo
    if (!api || chosen.length === 0) return
    const ids = [...chosen]
    const request = ++requestNumber.current
    confirmation.rememberFocus(trashButtonId)
    setReviewing(true)
    setProblem(null)
    try {
      const scan = await api.sessionTrashPreview(ids)
      if (request !== requestNumber.current) return
      setProblem(joinErrors(scan.errors))
      if (scan.data !== null && scan.errors.length === 0) setReview({ ...scan.data, ids })
      else setPicked([])
    } catch (cause) {
      if (request === requestNumber.current) setProblem(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (request === requestNumber.current) setReviewing(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-ink-2">Open a conversation to read its first message. Select only the copies you want to move to trash; you can undo the change from History.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={looking || busy || reviewing}
          className="btn btn-quiet btn-sm"
          onClick={() => void find()}
        >
          {looking ? 'Comparing first messages…' : 'Find similar conversations'}
        </button>
        {groups !== null && (
          <span role="status" className="text-xs text-ink-2">
            {groups.length === 0
              ? 'No two sessions here open the same way.'
              : `${formatCount(groups.length, 'set')} of sessions open the same way.`}
          </span>
        )}
        {problem !== null && <span ref={problemRef} tabIndex={-1} role="alert" className="text-pencil">{problem}</span>}
      </div>

      <table className="ledger">
        <thead>
          <tr>
            <th />
            <th>Conversation</th>
            <th className="num">Size</th>
            <th>Last activity</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session, index) => {
            const group = groupOf.get(session.id)
            return (
              <Fragment key={session.id}>
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select session ${session.uuid}`}
                      disabled={busy || reviewing}
                      checked={picked.includes(session.id)}
                      onChange={() => pick(session.id)}
                    />
                  </td>
                  <td className="font-mono text-xs">
                    <button
                      type="button"
                      className="disclose"
                      aria-label={`Session ${session.uuid} details`}
                      aria-expanded={opened === session.id}
                      aria-controls={opened === session.id ? `${sectionId}-${session.id}` : undefined}
                      onClick={() => setOpened(opened === session.id ? null : session.id)}
                    >
                      Conversation {index + 1}
                    </button>
                  </td>
                  <td className="num">{formatBytes(session.bytes)}</td>
                  <td className="text-ink-2">{formatAgo(session.mtimeMs)}</td>
                  <td className="space-x-1">
                    {session.stale && (
                      <span className="stamp-off" data-sigil="undone">
                        untouched {staleAfterDays}+ days
                      </span>
                    )}
                    {session.releasedByDesktop && (
                      <span
                        className="stamp-off"
                        data-sigil="undone"
                        title="The desktop app left a released marker beside this transcript."
                      >
                        deleted in desktop app
                      </span>
                    )}
                    {session.hasSidecar && <span className="stamp">session folder</span>}
                    {session.mirroredIn !== null && (
                      <span
                        className="stamp"
                        title={`The ${session.mirroredIn} store holds a session with this id — the same work recorded twice.`}
                      >
                        also in {session.mirroredIn}
                      </span>
                    )}
                    {group && (
                      <span className="stamp" title={`Opens with: ${group.prompt}`}>
                        same opening #{group.at}
                      </span>
                    )}
                  </td>
                </tr>
                {opened === session.id && (
                  <tr>
                    <td id={`${sectionId}-${session.id}`} colSpan={5}>
                      <SessionDetailView sessionId={session.id} uuid={session.uuid} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {reviewing ? (
        <div className="band" role="group" aria-label="Preparing conversation review" onKeyDown={confirmation.onKeyDown}>
          <span role="status">Checking selected conversations…</span>
          <button ref={confirmation.cancelRef} type="button" className="btn btn-quiet btn-sm" onClick={confirmation.cancel}>Cancel</button>
        </div>
      ) : review !== null ? (
        <div className="band band-pencil flex-col items-start gap-3" role="group" aria-labelledby={questionId} onKeyDown={confirmation.onKeyDown}>
          <span id={questionId}>
            Move {formatCount(review.count, 'conversation')} and their saved supporting files
            into kondo&rsquo;s trash?
          </span>
          <ul className="space-y-1 text-ink-2">
            {review.sessions.map((session) => (
              <li key={session.id} className="break-all">
                {session.uuid} · {formatBytes(session.bytes)} · last activity {formatAgo(session.mtimeMs)}
              </li>
            ))}
          </ul>
          <p>If a conversation changes or resumes, nothing moves until you review again.</p>
          <button type="button" disabled={busy || review.count === 0} className="btn btn-pencil btn-sm" onClick={trash}>
            Move to trash
          </button>
          <button
            ref={confirmation.cancelRef}
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={confirmation.cancel}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          id={trashButtonId}
          type="button"
          disabled={chosen.length === 0 || busy}
          className="btn btn-quiet btn-sm"
          onClick={() => void prepareReview()}
        >
          {chosen.length === 0
            ? 'Pick conversations to move to trash'
            : `Move ${formatCount(chosen.length, 'conversation')} to trash`}
        </button>
      )}
    </div>
  )
}

/** Tier-2, and only for the transcript actually opened (ADR-0007). */
function SessionDetailView({ sessionId, uuid }: { sessionId: string; uuid: string }) {
  const state = useScan((api) => api.sessionDetail(sessionId), [sessionId])
  return (
    <AsyncView state={state}>
      {(scan) =>
        scan.data === null ? (
          <span className="text-ink-2">No detail available.</span>
        ) : (
          <div className="space-y-1 py-1 text-xs">
            {scan.data.firstUserPrompt ? (
              <div className="font-mono text-ink">“{scan.data.firstUserPrompt}”</div>
            ) : <p className="text-ink-2">No first message was found.</p>}
            <div className="text-ink-2">
              {scan.data.messageCount.toLocaleString()} messages
              {scan.data.badLines > 0 && (
                <span className="text-note"> · Some saved records could not be read</span>
              )}
            </div>
            <details>
              <summary>Conversation details</summary>
              <div className="mt-2 break-words font-mono text-ink-2">ID: {uuid}</div>
              <div className="text-ink-2">{scan.data.lineCount.toLocaleString()} saved events · {scan.data.badLines} unreadable records</div>
              <div className="text-ink-2">{scan.data.firstTimestamp ?? 'Unknown start'} → {scan.data.lastTimestamp ?? 'Unknown end'}</div>
            </details>
          </div>
        )
      }
    </AsyncView>
  )
}

/** What the old size dashboard was, now a ruled block of the global row. */
function StoreCard({ title, report }: { title: string; report: StoreReport }) {
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between">
        <h3>{title}</h3>
        <span className="text-sm text-ink-2">{formatBytes(report.totalBytes)}</span>
      </div>
      <div className="mb-2 font-mono text-xs text-ink-2">{report.root}</div>
      {!report.exists ? (
        <div className="text-ink-2">Not found on this machine.</div>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>Entry</th>
              <th className="num">Size</th>
              <th>Touched</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.length === 0 && (
              <tr>
                <td colSpan={3} className="text-ink-2">
                  The folder is there and holds nothing.
                </td>
              </tr>
            )}
            {report.entries.slice(0, 10).map((entry) => (
              <tr key={entry.name}>
                <td className="font-mono text-xs">
                  {entry.name}
                  {entry.type === 'dir' ? '/' : ''}
                </td>
                <td className="num">{formatBytes(entry.bytes)}</td>
                <td className="text-ink-2">{formatAgo(entry.mtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
