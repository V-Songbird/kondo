import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  HookInfo,
  McpServerInfo,
  PlacedEntryInfo,
  SkillInfo
} from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { Problems } from '../../ui/problems'
import { formatAgo, formatBytes } from '../../lib/format'
import {
  KIND_LABEL,
  allHooks,
  buildCatalog,
  countByKind,
  filterCatalog,
  findings,
  hookName,
  installScopeWord,
  installationSummary,
  objectKey,
  managementProjects,
  mcpStatusFlag,
  scopeLabel
} from './catalog'
import type { CatalogInput, Flag, LibraryKind, LibraryObject } from './catalog'

const KIND_HELP: Record<LibraryKind, string> = {
  skill: 'Instructions for a repeatable task',
  plugin: 'A bundle of skills and other extensions',
  mcp: 'A connection to tools or services',
  hook: 'An action triggered by a Claude Code event',
  agent: 'An assistant with a specific role',
  command: 'A saved slash command',
  rule: 'Guidance Claude Code follows',
  'output-style': 'How Claude Code formats its answers',
  settings: 'Preferences for Claude Code'
}

const CATEGORY: Record<LibraryKind, string> = {
  skill: 'Skills', plugin: 'Plugins', mcp: 'Connections', hook: 'Hooks',
  agent: 'Agents', command: 'Commands', rule: 'Rules', 'output-style': 'Output styles', settings: 'Settings'
}

/**
 * The Library: the named object is the row.
 *
 * Kondo used to answer "where does this skill live", "which hooks will fire on
 * this machine" and "which settings file switched that off" only by opening
 * one project page at a time — which on a real store is 11,517 tier-2 reads to
 * answer one question. Five bridge channels already held the answers and no
 * screen called them. This is that screen.
 *
 * It is read-only on purpose. Every mutation in the app still runs from the
 * project page, where it is tested; moving the controls here wants the pending
 * destination row and a plan-without-applying step, and both are their own
 * change. What ships here is the reading.
 */

/** A chip in the register its tone names. Shape first, hue second. */
function Chip({ flag }: { flag: Flag }) {
  if (flag.tone === 'fact') return <span className="stamp">{flag.text}</span>
  return <span className={`stamp-${flag.tone === 'unknown' ? 'unknown' : flag.tone}`}>{flag.text}</span>
}

function itemFlag(kind: LibraryKind, flag: Flag): Flag {
  if (kind === 'mcp' && flag.text === 'on') return { text: 'configured', tone: 'fact' }
  if (kind === 'plugin' && flag.text === 'leftover') return { text: 'installation not found', tone: 'unknown' }
  if (flag.text === 'nothing says') return { ...flag, text: 'no explicit setting' }
  return flag
}

function Section({
  title,
  count,
  children
}: {
  title: string
  count?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="sheet">
      <div className="sheet-head">
        <h2>{title}</h2>
        {count !== undefined && <span className="count">{count}</span>}
      </div>
      {children}
    </section>
  )
}

export function Library({
  query,
  onQuery,
  kind,
  onKind,
  picked,
  onPick,
  onOpenProject,
  onOpenHistory,
  onReviewSettings
}: {
  query: string
  onQuery: (value: string) => void
  kind: LibraryKind | null
  onKind: (value: LibraryKind | null) => void
  picked: string | null
  onPick: (key: string | null) => void
  onOpenProject: (projectId: string, kind: LibraryKind) => void
  onOpenHistory: () => void
  onReviewSettings: () => void
}) {
  const detail = useRef<HTMLDivElement>(null)
  const browser = useRef<HTMLDivElement>(null)
  const lastPicked = useRef(picked)
  const [overviewOpen, setOverviewOpen] = useState(false)
  // Every read contributes its data AND its diagnostics (ADR-0005).
  const skills = useScan((api) => api.skillsList())
  const duplicates = useScan((api) => api.skillDuplicates())
  const plugins = useScan((api) => api.pluginsList())
  const hookGroups = useScan((api) => api.hooksList())
  const mcp = useScan((api) => api.entityList('mcp'))
  const agents = useScan((api) => api.entityList('agent'))
  const commands = useScan((api) => api.entityList('command'))
  const rules = useScan((api) => api.entityList('rule'))
  const styles = useScan((api) => api.entityList('output-style'))
  const layers = useScan((api) => api.settingsLayers())
  const projects = useScan((api) => api.projectsList())

  // `entityList` is typed to the identity every kind shares; main's own
  // `listAs<T>` is what decides the row shape, and these four listings are
  // parentless (kinds.ts). Narrowing here rather than at ten call sites.
  const placed = [agents, commands, rules, styles]
    .flatMap((state) => (state.scan?.data ?? []) as PlacedEntryInfo[])

  const input: CatalogInput = {
    skills: skills.scan?.data ?? [],
    duplicates: duplicates.scan?.data ?? [],
    plugins: plugins.scan?.data ?? [],
    hookGroups: hookGroups.scan?.data ?? [],
    mcp: (mcp.scan?.data ?? []) as McpServerInfo[],
    placed,
    layers: layers.scan?.data ?? [],
    projects: projects.scan?.data ?? []
  }

  const catalog = buildCatalog(input)
  const found = findings(input)
  const counts = countByKind(catalog, found)
  const shown = filterCatalog(catalog, query, kind)
  const open = catalog.find((object) => object.key === picked) ?? null
  const missingInstallation = open?.kind === 'plugin' &&
    input.plugins.some((plugin) => plugin.name === open.name && !plugin.installed)
  const management = open === null || missingInstallation ? [] : managementProjects(open, input)
  const kinds = counts.map((count) => count.kind)

  useEffect(() => {
    if (open !== null) {
      lastPicked.current = open.key
      detail.current?.querySelector<HTMLElement>('h1')?.focus()
      detail.current?.scrollTo(0, 0)
    }
  }, [open?.key])

  const backToLibrary = (): void => {
    onPick(null)
    setOverviewOpen(false)
    requestAnimationFrame(() => {
      const row = [...(browser.current?.querySelectorAll<HTMLButtonElement>('[data-library-key]') ?? [])]
        .find((button) => button.dataset.libraryKey === lastPicked.current)
      const target = row ?? browser.current?.querySelector<HTMLInputElement>('input')
      target?.focus()
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  const reads = [
    { label: 'Skills', state: skills },
    { label: 'Duplicate skills', state: duplicates },
    { label: 'Plugins', state: plugins },
    { label: 'Hooks', state: hookGroups },
    { label: 'MCP servers', state: mcp },
    { label: 'Agents', state: agents },
    { label: 'Commands', state: commands },
    { label: 'Rules', state: rules },
    { label: 'Output styles', state: styles },
    { label: 'Settings', state: layers },
    { label: 'Projects', state: projects }
  ]
  const loading = reads.some(({ state }) => state.loading && !state.scan)
  const incomplete = reads.some(({ state }) =>
    state.failure !== null || (state.scan?.errors.length ?? 0) > 0 ||
    (state.scan?.unknown.length ?? 0) > 0
  )

  return (
    <div className="destination-stack">
      {open === null && <header className="page-intro">
        <h1>Library</h1>
        <p>Your skills, plugins and connections, together. Choose an item to see where it works.</p>
      </header>}
      {loading && <p role="status">Reading your Claude Code setup…</p>}
      {incomplete && <div className="read-notice">
        <p role="status">Some information could not be read or recognized. The items below are still available.</p>
        {reads.map(({ label, state }) => <div key={label}>
          {state.failure !== null && <div role="alert" className="band band-pencil">
            {label} could not be read: {state.failure}
            <button type="button" className="btn btn-sm" onClick={state.reload}>Try again</button>
          </div>}
          {state.scan && (state.scan.errors.length > 0 || state.scan.unknown.length > 0) &&
            <div aria-label={label + ' reading problems'}>
              <p>{label}</p><Problems scan={state.scan} />
            </div>}
        </div>)}
      </div>}
      <div className="workspace-split library-workspace" data-detail-open={picked !== null || overviewOpen}>
        <div ref={browser} className="workspace-browser">
          <label className="field-label" htmlFor="library-search">Find an item</label>
          <input id="library-search" aria-label="Search the Library" value={query}
            onChange={(event) => onQuery(event.target.value)} placeholder="Search by name…" className="field" />
          <label className="field-label" htmlFor="library-kind">Item type</label>
          <select id="library-kind" aria-label="Item type" className="field" value={kind ?? ''}
            onChange={(event) => {
              onKind(event.target.value === '' ? null : event.target.value as LibraryKind)
              onPick(null)
              setOverviewOpen(false)
            }}>
            <option value="">All items</option>
            {kinds.map((entry) => <option key={entry} value={entry}>
              {CATEGORY[entry]} ({counts.find((count) => count.kind === entry)?.objects ?? 0})
            </option>)}
          </select>
          {kind !== null && <p className="browser-help">{KIND_HELP[kind]}.</p>}
          <div className="browser-summary">
            <span>{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>
            {(query !== '' || kind !== null) && <button type="button" className="btn btn-sm"
              onClick={() => {
                onQuery(''); onKind(null)
                requestAnimationFrame(() => browser.current?.querySelector<HTMLInputElement>('input')?.focus())
              }}>Clear filters</button>}
          </div>
          <div className="browser-items">
            {loading && shown.length === 0 ? <div className="slot"><i /><i /><i /></div>
              : shown.length === 0 ? <p>{incomplete
                ? 'No matching items in the information Kondo could read. Check the reading problems.'
                : catalog.length === 0 ? 'No items found in the Claude Code locations Kondo checks.'
                  : 'No items match these filters. Try another name or choose All items.'}</p>
              : shown.map((object) => <button key={object.key} type="button"
                data-library-key={object.key} aria-current={object.key === picked ? 'true' : undefined}
                className="row-item library-item" onClick={() => { setOverviewOpen(false); onPick(object.key) }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{object.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{object.kind === 'plugin'
                    ? `${object.places} saved ${object.places === 1 ? 'setting' : 'settings'}`
                    : `${object.places} ${object.places === 1 ? 'location' : 'locations'}`}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                  <span className="text-ink-3">{CATEGORY[object.kind]}</span>
                  {object.flags.filter((flag) => flag.tone !== 'fact').slice(0, 2).map((flag) =>
                    <Chip key={flag.text} flag={itemFlag(object.kind, flag)} />)}
                </div>
              </button>)}
          </div>
          <button type="button" className="btn overview-link" onClick={() => {
            onPick(null); setOverviewOpen(true)
            requestAnimationFrame(() => detail.current?.querySelector<HTMLElement>('[data-overview-title]')?.focus())
          }}>Setup overview{found.length > 0 ? ' · ' + found.length + ' to review' : ''}</button>
        </div>
        <div ref={detail} className="workspace-detail">
          {(picked !== null || overviewOpen) && <button type="button" className="btn mb-4"
            onClick={backToLibrary}>Back to Library</button>}
          {open === null ? picked !== null ? <p role="status">{loading
            ? 'Reading this item…' : 'This item is no longer in the current scan. Return to the Library to choose another.'}</p>
            : <Machine counts={counts} found={found} onPick={onPick} onKind={(next) => {
              onKind(next); onQuery(''); setOverviewOpen(false)
              requestAnimationFrame(() => browser.current?.querySelector<HTMLInputElement>('input')?.focus())
            }} complete={!loading && !incomplete} />
            : <>
              <ObjectPage object={open} input={input} management={<Section title="Manage this item">
                {management.length > 0 ? <>
                  <p className="mb-2">Choose where to manage this {KIND_LABEL[open.kind]}. Global means all projects.</p>
                  <div className="flex flex-wrap gap-3">
                    {management.map((project) => <button key={project.id} type="button" className="btn"
                      title={project.label} onClick={() => onOpenProject(project.id, open.kind)}>
                      Manage in {management.filter((item) => item.name === project.name).length > 1 ? project.label : project.name}
                    </button>)}
                  </div>
                </> : missingInstallation ? <>
                  <p className="mb-2">Kondo did not find this plugin's installation. Review its saved settings before deciding whether to remove anything.</p>
                  <button type="button" className="btn" onClick={onReviewSettings}>Review settings leftovers</button>
                </> : <p>This item has no linked management location in the current scan. Its information is available below.</p>}
              </Section>} />
              <button type="button" className="btn mb-4" onClick={onOpenHistory}>Open History to undo changes</button>
            </>}
        </div>
      </div>
    </div>
  )
}

/** Nothing selected: what Claude loads here, and the six things to look at. */
function Machine({
  counts,
  found,
  onPick,
  onKind,
  complete
}: {
  counts: ReturnType<typeof countByKind>
  found: ReturnType<typeof findings>
  onPick: (key: string) => void
  onKind: (kind: LibraryKind) => void
  complete: boolean
}) {
  return (
    <div>
      <Section title="Your Claude Code setup">
        <h2 data-overview-title tabIndex={-1} className="overview-title">Make Claude Code your own</h2>
        <p className="mb-4">Start with skills for repeatable tasks, plugins for bundles of features,
          or connections for other tools. Nothing changes while you browse.</p>
        <div className="category-list">
          {counts.map((count) => <button key={count.kind} type="button" className="category-row"
            onClick={() => onKind(count.kind)}>
            <span><strong>{CATEGORY[count.kind]}</strong><span className="category-description">{KIND_HELP[count.kind]}</span></span>
            <span className="category-count">{count.objects}<span aria-hidden="true"> →</span></span>
          </button>)}
        </div>
        <p className="mt-3">An item can be available in all projects or saved for one project.
          Choose it to compare locations and see the available controls.</p>
      </Section>

      <Section title="Needs a look" count={found.length === 0 ? undefined : found.length}>
        {found.length === 0 ? (
          <p>
            {complete ? 'No issues found in the information Kondo checked.'
              : 'The check is incomplete. Missing information can hide issues.'}
          </p>
        ) : (
          <>
            <ul className="finding-list">
              {found.map((finding) => <li key={finding.key + ' ' + finding.why}>
                <button type="button" className="btn" onClick={() => onPick(finding.key)}>{finding.name}</button>
                <span className="ml-3 text-ink-3">{CATEGORY[finding.kind]}</span>
                <p className="mt-1">{finding.why}</p>
                <details className="technical-details"><summary>Location details</summary>
                  <p className="break-all">{finding.where}</p>
                </details>
              </li>)}
            </ul>
            <p className="mt-3 text-xs">
              Review these items before changing anything. A finding does not mean an item
              should be removed.
            </p>
          </>
        )}
      </Section>
    </div>
  )
}

interface ObjectPageProps {
  object: LibraryObject
  input: CatalogInput
  management: ReactNode
}

function ObjectPage({ object, input, management }: ObjectPageProps) {
  switch (object.kind) {
    case 'skill':
      return <SkillPage object={object} input={input} management={management} />
    case 'plugin':
      return <PluginPage object={object} input={input} management={management} />
    case 'hook':
      return <HookPage object={object} input={input} management={management} />
    case 'mcp':
      return <McpPage object={object} input={input} management={management} />
    case 'settings':
      return <SettingsPage object={object} input={input} management={management} />
    default:
      return <PlacedPage object={object} input={input} management={management} />
  }
}

/** The heading every object page shares: name, kind, and its fact line. */
function Head({
  object,
  facts,
  description
}: {
  object: LibraryObject
  facts: string
  description?: string | null
}) {
  return (
    <div className="hero">
      <h1 tabIndex={-1}>{object.name}</h1>
      <div className="mt-1 text-xs text-ink-3">
        {KIND_LABEL[object.kind]} · {facts}
      </div>
      {description !== undefined && description !== null && (
        <p className="mt-2">{description}</p>
      )}
    </div>
  )
}

/**
 * One skill, every scope it lives in, and which settings file decided each.
 * `SkillOverrideState.layerPath` is computed for every skill in the app today
 * and referenced nowhere under `src/` — it is the answer to "which file
 * switched that off", and it is printed rather than hovered for.
 */
function SkillPage({ object, input, management }: ObjectPageProps) {
  const members = input.skills.filter((skill) => skill.name === object.name)
  const group = input.duplicates.find((entry) => entry.name === object.name)
  const digest = (skill: SkillInfo): string | null =>
    group?.members.find((member) => member.skill.id === skill.id)?.digest ?? null
  const ids = new Set(members.map((skill) => skill.id))
  const on = members.filter((skill) => skill.enabled).length

  return (
    <div>
      <Head
        object={object}
        facts={`${members.length} ${members.length === 1 ? 'location' : 'locations'} · enabled in ${on}`}
        description={members.find((skill) => skill.description !== null)?.description ?? null}
      />
      {management}

      <Section title="Where it lives" count={members.length}>
        <p className="mb-3">Global is available across projects. A copy in a project belongs to that project.</p>
        <table className="ledger">
          <thead><tr><th>Location</th><th>Availability</th><th>Details</th></tr></thead>
          <tbody>{members.map((skill) => <tr key={skill.id} data-force={skill.enabled ? undefined : 'off'}>
            <td>{scopeLabel(skill.projectId, input.projects)}<p>{skill.projectId === null ? 'All projects' : 'This project'}</p></td>
            <td><span className={skill.enabled ? 'stamp-ok' : 'stamp-off'}>{skill.enabled ? 'Enabled' : 'Disabled'}</span></td>
            <td><details className="technical-details">
              <summary>Technical details</summary>
              <p className="break-all">File: {skill.origin}</p>
              <p className="break-all">Contents hash: {digest(skill) ?? 'Not compared'}</p>
              {skill.override === null ? <p>No explicit override in settings.</p>
                : <p className="break-all">Setting: {skill.override.value} in {skill.override.layerPath}</p>}
            </details></td>
          </tr>)}</tbody>
        </table>
        {group !== undefined && <p className="mt-3">
          {group.identical
            ? 'These copies have identical contents. Choose which location you want to keep before removing a copy.'
            : group.members.some((member) => member.digest === null)
              ? 'Some contents could not be compared. Keep both copies until they can be read.'
              : 'These copies have different contents. Keep both unless you have reviewed the differences.'}
        </p>}
      </Section>

      <Changes ids={ids} noun="skill" />
    </div>
  )
}

/** One plugin: which layers state it, what is in effect, and what it ships. */
function PluginPage({ object, input, management }: ObjectPageProps) {
  const plugin = input.plugins.find((entry) => entry.name === object.name)
  const shipped = useScan(
    (api) => api.pluginSkills(plugin?.id ?? ''),
    [plugin?.id ?? '']
  )
  if (plugin === undefined) return <p>That plugin is no longer in the scan.</p>
  const stated = plugin.scopes.filter((scope) => scope.enabled !== null)

  return (
    <div>
      <Head
        object={object}
        facts={[
          plugin.marketplace,
          installationSummary(plugin),
          plugin.installed ? 'installation found' : 'installation not found',
          plugin.lastUpdated === null ? null : `updated ${formatAgo(Date.parse(plugin.lastUpdated))}`
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      />
      {management}

      <Section title="Where it is installed" count={plugin.installations.length}>
        {plugin.installations.length === 0
          ? <p>{plugin.source === 'skills-dir'
            ? 'This plugin is a folder in a skills directory, so Claude loads it without an installation record.'
            : 'No installation record names this plugin.'}</p>
          : <table className="ledger">
            <thead><tr><th>Where it applies</th><th>Version</th><th>Details</th></tr></thead>
            <tbody>{plugin.installations.map((place) => (
              <tr key={`${place.scope}:${place.installPath}`} data-force={place.followed ? undefined : 'off'}>
                <td>{installScopeWord(place.scope)}
                  {place.projectPath === null ? null : <p className="break-all">{place.projectPath}</p>}</td>
                <td>{place.version ?? <span className="null">—</span>}</td>
                <td><details className="technical-details"><summary>Technical details</summary>
                  <p className="break-all">Files: {place.installPath}</p>
                  {place.followed ? null : <p>This path is outside the Claude store, so Kondo did not read it.</p>}
                  {place.installedAt === null ? null : <p>Installed: {place.installedAt}</p>}
                </details></td>
              </tr>
            ))}</tbody>
          </table>}
      </Section>

      <Section title="Where it is configured" count={stated.length}>
        <p className="mb-3">These are explicit settings. A project's own setting can override the shared one.</p>
        {stated.length === 0 ? <p>No explicit on/off setting was found. Kondo cannot determine availability from this alone.</p>
          : <table className="ledger">
            <thead><tr><th>Location</th><th>Setting</th><th>Details</th></tr></thead>
            <tbody>{stated.map((scope) => <tr key={scope.layerId} data-force={scope.enabled ? undefined : 'off'}>
              <td>{scope.projectLabel ?? scopeLabel(scope.projectId, input.projects)}
                <p>{scope.projectId === null ? 'All projects' : 'This project'}</p></td>
              <td><span className={scope.enabled ? 'stamp-ok' : 'stamp-off'}>{scope.enabled ? 'Enabled' : 'Disabled'}</span></td>
              <td><details className="technical-details"><summary>Technical details</summary>
                <p>Settings layer: {scope.layer}</p><p className="break-all">File: {scope.path}{scope.exists ? '' : ' (not created yet)'}</p>
              </details></td>
            </tr>)}</tbody>
          </table>}
      </Section>

      <Section title="Skills it ships">
        <AsyncView state={shipped} empty="No skills found in the plugin locations Kondo checks.">
          {(scan) => (
            <table className="ledger">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Description</th>
                  <th>Where it comes from</th>
                </tr>
              </thead>
              <tbody>
                {scan.data.map((skill) => (
                  <tr key={skill.id}>
                    <td className="whitespace-nowrap">{skill.name}</td>
                    <td className="text-ink-2">
                      {skill.description ?? <span className="null">—</span>}
                    </td>
                    {/* A plugin can ship one name from several directories and
                        several installations; the path is what says which. */}
                    <td className="break-all font-mono text-ink-2">{skill.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncView>
        <p className="mt-3 text-xs">
          Kondo reads a plugin's own skills folder, any skills folder its manifest adds, and its commands. These skills are managed together with their plugin. Open a management location above to see its controls.
        </p>
      </Section>

      <Changes ids={new Set([plugin.id])} noun="plugin" />
    </div>
  )
}

function HookPage({ object, input, management }: ObjectPageProps) {
  const hook = allHooks(input.hookGroups).find(
    (entry) => objectKey('hook', `${hookName(entry)} ${entry.id}`) === object.key
  )
  if (hook === undefined) return <p>That hook is no longer in the scan.</p>
  return (
    <div>
      <Head
        object={object}
        facts={`${hook.layer} · ${hook.projectLabel ?? 'Global'}`}
      />
      {management}
      <Section title="What it runs">
        <Row label="Event">
          {hook.event ?? <span className="stamp-unknown">not recognized</span>}
        </Row>
        <Row label="Type">{hook.type ?? <span className="null">—</span>}</Row>
        <Row label="Matcher">
          {hook.hasMatcher ? 'Set (pattern not shown)' : <span className="null">— none</span>}
        </Row>
        <Row label="Script">
          {hook.script === null ? (
            <span className="null">— no script file named</span>
          ) : (
            <ScriptCell script={hook.script} />
          )}
        </Row>
        <Row label="Armed by">
          <span className="text-ink-2">{hook.source}</span>
        </Row>
        <p className="mt-3 text-xs">
          Commands, matcher patterns and names Kondo does not recognize can hold private
          values, so they are not shown. Open the settings file to read them.
        </p>
        <p className="mt-3 text-xs">
          Claude has no way to switch off one hook. Edit the settings file that runs it.
        </p>
      </Section>
      <Changes ids={new Set([hook.id])} noun="hook" />
    </div>
  )
}

function ScriptCell({ script }: { script: NonNullable<HookInfo['script']> }) {
  return script === 'present' ? (
    <span className="stamp-ok">on disk</span>
  ) : script === 'missing' ? (
    <span className="stamp-bad">not found</span>
  ) : (
    <span className="stamp-unknown">cannot check</span>
  )
}

function McpPage({ object, input, management }: ObjectPageProps) {
  const members = (input.mcp as McpServerInfo[]).filter(
    (server) => server.name === object.name
  )
  return (
    <div>
      <Head object={object} facts={`${members.length} configured ${members.length === 1 ? 'location' : 'locations'}`} description="Connections let Claude Code use other tools and services." />
      {management}
      <Section title="Where it is configured" count={members.length}>
        <table className="ledger">
          <thead><tr><th>Location</th><th>In Claude Code</th><th>Details</th></tr></thead>
          <tbody>{members.map((server) => <tr key={server.id}>
            <td>{server.project ?? (server.scope === 'user' ? 'Global' : server.scope)}</td>
            <td>{server.orphan ? <span className="stamp-bad">project is gone</span>
              : <Chip flag={mcpStatusFlag(server.status)} />}
              {server.statusReason !== null && <p className="mt-1 text-xs text-ink-2">{server.statusReason}</p>}</td>
            <td><details className="technical-details"><summary>Technical details</summary>
              <p>Connection type: {server.transport}</p><p className="break-all">File: {server.source}</p>
            </details></td>
          </tr>)}</tbody>
        </table>
        <p className="mt-3 text-xs">
          These states come from the files Kondo reads: Claude’s registry, a project’s <code>.mcp.json</code> and its settings files. Kondo does not read managed policy and does not test whether a connection is running. Private connection values are hidden.
        </p>
      </Section>
    </div>
  )
}

function SettingsPage({ object, input, management }: ObjectPageProps) {
  const layer = input.layers.find((entry) => objectKey('settings', entry.id) === object.key)
  if (layer === undefined) return <p>That settings file is no longer in the scan.</p>
  return (
    <div>
      <Head object={object} facts={layer.exists ? formatBytes(layer.bytes) : 'not created yet'} />
      {management}
      <p className="mb-3">Preferences saved for {scopeLabel(layer.projectId, input.projects)}. Settings are shown for reference.</p>
      <details className="technical-details"><summary>Technical details</summary>
      <Section title="What it states" count={layer.keys.length}>
        <Row label="File">
          <span className="break-all text-ink-2">{layer.path}</span>
        </Row>
        <Row label="Layer">
          <span className="stamp">{layer.layer}</span>
        </Row>
        <Row label="Keys">
          {layer.keys.length > 0 && <span className="break-all text-ink-2">{layer.keys.join(' · ')}</span>}
          {layer.keys.length === 0 && !layer.unlistedKeys && <span className="null">— nothing</span>}
          {layer.unlistedKeys && (
            <span className="block text-xs">
              Other top-level settings are not shown. Kondo lists only documented setting names.
            </span>
          )}
        </Row>
        <p className="mt-3 text-xs">
          The highest layer that states a value wins: local over project over user. A
          settings file is a file, not a toggle.
        </p>
      </Section></details>
    </div>
  )
}

function PlacedPage({ object, input, management }: ObjectPageProps) {
  const members = input.placed.filter(
    (entry) => objectKey(entry.kind as LibraryKind, entry.name) === object.key
  )
  return (
    <div>
      <Head
        object={object}
        facts={`in ${members.length} ${members.length === 1 ? 'location' : 'locations'}`}
        description={members.find((entry) => entry.description !== null)?.description ?? null}
      />
      {management}
      <Section title="Where it lives" count={members.length}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {members.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">
                    {scopeLabel(entry.projectId, input.projects)}
                  </td>
                  <td><details className="technical-details"><summary>Technical details</summary>
                    <p className="break-all">File: {entry.origin}</p>
                  </details></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs">
          Open a management location above to see the actions available for this item.
        </p>
      </Section>
      <Changes ids={new Set(members.map((entry) => entry.id))} noun={KIND_LABEL[object.kind]} />
    </div>
  )
}

/** A hairline label/value row, for an object with no table to put it in. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="line">
      <span className="w-28 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

/**
 * Everything kondo has done to this object, filtered from the journal by an
 * exact id match — a join on an opaque id, never a parse of one (ADR-0008).
 */
function Changes({ ids, noun }: { ids: Set<string>; noun: string }) {
  const journal = useScan((api) => api.journalList())
  const entries = (journal.scan?.data ?? []).filter((entry) => ids.has(entry.entityId))
  return (
    <Section title={`Changes to this ${noun}`} count={entries.length}>
      <AsyncView state={journal}>
        {() => (
          <>
            {entries.length === 0 && <p>No changes recorded for this item.</p>}
            {entries.map((entry) => (
              <div key={entry.id} className="line">
                <span className="w-20 shrink-0 text-ink-3" title={entry.at}>
                  {formatAgo(Date.parse(entry.at))}
                </span>
                <span className="min-w-0 flex-1">{entry.summary}</span>
                <span className="stamp">{entry.op}</span>
              </div>
            ))}
            <p className="mt-3 text-xs">
              Undo lives on History, where every change kondo has made is listed with a way
              back.
            </p>
          </>
        )}
      </AsyncView>
    </Section>
  )
}
