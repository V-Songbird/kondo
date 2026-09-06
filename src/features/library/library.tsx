import type { ReactNode } from 'react'
import type {
  HookInfo,
  McpServerInfo,
  PlacedEntryInfo,
  SkillInfo
} from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatAgo, formatBytes } from '../../lib/format'
import {
  KIND_LABEL,
  allHooks,
  buildCatalog,
  countByKind,
  filterCatalog,
  findings,
  hookName,
  objectKey,
  scopeLabel
} from './catalog'
import type { CatalogInput, Flag, LibraryKind, LibraryObject } from './catalog'

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
  onPick
}: {
  query: string
  onQuery: (value: string) => void
  kind: LibraryKind | null
  onKind: (value: LibraryKind | null) => void
  picked: string | null
  onPick: (key: string | null) => void
}) {
  // Ten reads, every one a channel that already existed. Nine of them are the
  // ones the renderer has never called.
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
  const kinds = counts.map((count) => count.kind)

  const loading = [skills, plugins, hookGroups, layers, projects].some(
    (state) => state.loading && !state.scan
  )
  const failure =
    [skills, plugins, hookGroups, layers, projects].find((state) => state.failure)?.failure ??
    null

  if (failure !== null) return <div className="band band-pencil">{failure}</div>

  return (
    <div className="flex h-full min-h-0 gap-6">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search skills, plugins, hooks…"
          className="field"
        />
        <div className="seg flex-wrap">
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={kind === null}
            onClick={() => onKind(null)}
          >
            All
          </button>
          {kinds.map((entry) => (
            <button
              key={entry}
              type="button"
              className="btn btn-sm"
              aria-pressed={kind === entry}
              onClick={() => onKind(kind === entry ? null : entry)}
            >
              {KIND_LABEL[entry]}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="slot">
              <i />
              <i />
              <i />
            </div>
          ) : shown.length === 0 ? (
            <p>Nothing here matches. Every object Claude loads is in this list.</p>
          ) : (
            shown.map((object) => (
              <button
                key={object.key}
                type="button"
                aria-current={object.key === picked ? 'true' : undefined}
                className="row-item"
                onClick={() => onPick(object.key === picked ? null : object.key)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{object.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">
                    {object.places === 1 ? '1 place' : `${object.places} places`}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                  <span className="stamp">{KIND_LABEL[object.kind]}</span>
                  {object.flags.map((flag) => (
                    <Chip key={flag.text} flag={flag} />
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
        <p className="text-[11px]">
          {catalog.length} objects across {counts.length} kinds.
        </p>
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        {open === null ? (
          <Machine counts={counts} found={found} onPick={onPick} />
        ) : (
          <ObjectPage object={open} input={input} />
        )}
      </div>
    </div>
  )
}

/** Nothing selected: what Claude loads here, and the six things to look at. */
function Machine({
  counts,
  found,
  onPick
}: {
  counts: ReturnType<typeof countByKind>
  found: ReturnType<typeof findings>
  onPick: (key: string) => void
}) {
  return (
    <div>
      <div className="hero">
        <h1>Library</h1>
        <p className="mt-2">
          Everything Claude loads on this machine, and every place it loads it from. Pick
          an object to see its scopes.
        </p>
      </div>

      <Section title="What this machine loads">
        <table className="ledger">
          <thead>
            <tr>
              <th>Kind</th>
              <th className="num">Objects</th>
              <th className="num">Copies</th>
              <th className="num">Needs a look</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((count) => (
              <tr key={count.kind}>
                <td>{KIND_LABEL[count.kind]}</td>
                <td className="num">{count.objects}</td>
                <td className="num">{count.copies}</td>
                <td className="num">
                  {count.findings === 0 ? <span className="null">—</span> : count.findings}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Everything Claude reads</td>
              <td className="num">
                {counts.reduce((sum, count) => sum + count.objects, 0)}
              </td>
              <td className="num">{counts.reduce((sum, count) => sum + count.copies, 0)}</td>
              <td className="num">{found.length}</td>
            </tr>
          </tfoot>
        </table>
        {/* A hook exists exactly once; a skill in four scopes is one object
            and four copies. The two columns are not the same question. */}
        <p className="mt-3 text-xs">
          A hook exists exactly once, so hooks read n of n. A skill in four scopes is one
          object and four copies.
        </p>
      </Section>

      <Section title="Needs a look" count={found.length === 0 ? undefined : found.length}>
        {found.length === 0 ? (
          <p>
            Nothing here needs a look — every hook names a script that is on disk, every
            declaration has a folder behind it, and no name is repeated with different
            contents.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Object</th>
                    <th>Kind</th>
                    <th>Where</th>
                    <th>What is wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((finding) => (
                    <tr key={`${finding.key} ${finding.why}`}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={() => onPick(finding.key)}
                        >
                          {finding.name}
                        </button>
                      </td>
                      <td className="text-ink-3">{KIND_LABEL[finding.kind]}</td>
                      <td className="max-w-xs truncate text-ink-2" title={finding.where}>
                        {finding.where}
                      </td>
                      <td>
                        <Chip flag={finding.chip} />
                        <p className="mt-1 text-xs">{finding.why}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs">
              Getting this to zero is the answer to “am I done” — a question no other
              screen answers. Every row is evidence, never a verdict about what to remove.
            </p>
          </>
        )}
      </Section>
    </div>
  )
}

function ObjectPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
  switch (object.kind) {
    case 'skill':
      return <SkillPage object={object} input={input} />
    case 'plugin':
      return <PluginPage object={object} input={input} />
    case 'hook':
      return <HookPage object={object} input={input} />
    case 'mcp':
      return <McpPage object={object} input={input} />
    case 'settings':
      return <SettingsPage object={object} input={input} />
    default:
      return <PlacedPage object={object} input={input} />
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
      <h1>{object.name}</h1>
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
function SkillPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
  const members = input.skills.filter((skill) => skill.name === object.name)
  const group = input.duplicates.find((entry) => entry.name === object.name)
  const digest = (skill: SkillInfo): string | null =>
    group?.members.find((member) => member.skill.id === skill.id)?.digest ?? null
  const stated = members.filter((skill) => skill.override !== null)
  const ids = new Set(members.map((skill) => skill.id))
  const on = members.filter((skill) => skill.enabled).length

  return (
    <div>
      <Head
        object={object}
        facts={`in ${members.length === 1 ? '1 scope' : `${members.length} scopes`} · on in ${on}`}
        description={members.find((skill) => skill.description !== null)?.description ?? null}
      />

      <Section title="Where it lives" count={members.length}>
        <div className="overflow-x-auto">
          <table className="ledger">
            {/* The answers first, the address last: a path is context, and
                putting it second pushed "in effect" off the right edge. */}
            <thead>
              <tr>
                <th>Scope</th>
                <th>In effect</th>
                <th>Says</th>
                <th>Contents</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {members.map((skill) => (
                <tr key={skill.id} data-force={skill.enabled ? undefined : 'off'}>
                  <td className="whitespace-nowrap">
                    {scopeLabel(skill.projectId, input.projects)}
                  </td>
                  <td>
                    {skill.enabled ? (
                      <span className="stamp-ok">on</span>
                    ) : (
                      <span className="stamp-off">off</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {skill.override === null ? (
                      <span className="stamp-unknown">nothing states it</span>
                    ) : (
                      <>
                        <span className="stamp-off">{skill.override.value}</span>
                        <div
                          className="max-w-xs truncate text-[11px] text-ink-3"
                          title={skill.override.layerPath}
                        >
                          {skill.override.layerPath}
                        </div>
                      </>
                    )}
                  </td>
                  {/* Eight characters is enough to compare two digests at a
                      glance, and the whole tree hash is on the title. */}
                  <td className="text-ink-2" title={digest(skill) ?? undefined}>
                    {digest(skill)?.slice(0, 8) ?? <span className="null">—</span>}
                  </td>
                  <td className="max-w-xs truncate text-ink-2" title={skill.origin}>
                    {skill.origin}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {group !== undefined && (
          <p className="mt-3 text-xs">
            {group.identical
              ? 'Both copies digest the same, so one of them is redundant. Kondo says nothing about which to keep.'
              : 'The copies differ, so neither is redundant.'}
          </p>
        )}
      </Section>

      {stated.length > 0 && (
        <Section title="Where it is switched off" count={stated.length}>
          <table className="ledger">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Layer</th>
                <th>File</th>
                <th>Says</th>
              </tr>
            </thead>
            <tbody>
              {stated.map((skill) => (
                <tr key={skill.id}>
                  <td className="whitespace-nowrap">
                    {scopeLabel(skill.projectId, input.projects)}
                  </td>
                  <td>
                    <span className="stamp">{skill.override?.layer}</span>
                  </td>
                  <td className="max-w-md truncate text-ink-2">{skill.override?.layerPath}</td>
                  <td>
                    <span className="stamp-off">{skill.override?.value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs">Every other scope loads the copy it holds.</p>
        </Section>
      )}

      <Changes ids={ids} noun="skill" />
    </div>
  )
}

/** One plugin: which layers state it, what is in effect, and what it ships. */
function PluginPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
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
          plugin.version ?? 'no version recorded',
          plugin.installed ? 'installed' : 'not installed',
          plugin.lastUpdated === null ? null : `updated ${formatAgo(Date.parse(plugin.lastUpdated))}`
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      />

      <Section title="Where it is stated" count={stated.length}>
        {stated.length === 0 ? (
          <p>
            No settings file states this plugin. Absence is not a `false` — nothing here
            has switched it off, nothing has switched it on.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Says</th>
                  <th>Layer</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {stated.map((scope) => (
                  <tr key={scope.layerId} data-force={scope.enabled ? undefined : 'off'}>
                    <td className="whitespace-nowrap">
                      {scope.projectLabel ?? scopeLabel(scope.projectId, input.projects)}
                    </td>
                    <td>
                      {scope.enabled ? (
                        <span className="stamp-ok">on</span>
                      ) : (
                        <span className="stamp-off">off</span>
                      )}
                    </td>
                    <td>
                      <span className="stamp">{scope.layer}</span>
                    </td>
                    <td className="max-w-xs truncate text-ink-2" title={scope.path}>
                      {scope.path}
                      {scope.exists ? '' : ' (not created yet)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Skills it ships">
        <AsyncView state={shipped} empty="This plugin ships no skills.">
          {(scan) => (
            <table className="ledger">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {scan.data.map((skill) => (
                  <tr key={skill.id}>
                    <td className="whitespace-nowrap">{skill.name}</td>
                    <td className="text-ink-2">
                      {skill.description ?? <span className="null">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AsyncView>
        <p className="mt-3 text-xs">
          A plugin-shipped skill follows its plugin: kondo will not bench or move one,
          because that would leave the plugin pointing at a directory that is gone.
        </p>
      </Section>

      <Changes ids={new Set([plugin.id])} noun="plugin" />
    </div>
  )
}

function HookPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
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
      <Section title="What it runs">
        <Row label="Event">{hook.event}</Row>
        <Row label="Matcher">
          {hook.matcher ?? <span className="null">— every tool</span>}
        </Row>
        <Row label="Command">
          <span className="break-all">{hook.command}</span>
        </Row>
        <Row label="Script">
          {hook.script === null ? (
            <span className="null">— it runs a command, not a file</span>
          ) : (
            <ScriptCell script={hook.script} />
          )}
        </Row>
        <Row label="Armed by">
          <span className="text-ink-2">{hook.source}</span>
        </Row>
        <p className="mt-3 text-xs">
          Claude has no way to switch off one hook. Edit the settings file that runs it.
        </p>
      </Section>
      <Changes ids={new Set([hook.id])} noun="hook" />
    </div>
  )
}

function ScriptCell({ script }: { script: NonNullable<HookInfo['script']> }) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      {script.status === 'present' ? (
        <span className="stamp-ok">on disk</span>
      ) : script.status === 'missing' ? (
        <span className="stamp-bad">not found</span>
      ) : (
        <span className="stamp-unknown">cannot check</span>
      )}
      <span className="break-all text-ink-2">{script.path}</span>
    </span>
  )
}

function McpPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
  const members = (input.mcp as McpServerInfo[]).filter(
    (server) => server.name === object.name
  )
  return (
    <div>
      <Head object={object} facts={`declared in ${members.length}`} />
      <Section title="Where it is declared" count={members.length}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Transport</th>
                <th>In</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {members.map((server) => (
                <tr key={server.id} data-force={server.enabled ? undefined : 'off'}>
                  <td className="whitespace-nowrap">{server.project ?? server.scope}</td>
                  <td>
                    <span className="stamp">{server.transport}</span>
                  </td>
                  <td className="max-w-md truncate text-ink-2" title={server.source}>
                    {server.source}
                  </td>
                  <td className="whitespace-nowrap">
                    {server.orphan ? (
                      <span className="stamp-bad">project is gone</span>
                    ) : server.enabled ? (
                      <span className="stamp-ok">on</span>
                    ) : (
                      <span className="stamp-off">off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs">
          Read-only: the files that hold these declarations are ones kondo cannot yet
          write safely, and its `env` and `headers` never cross the seam at all.
        </p>
      </Section>
    </div>
  )
}

function SettingsPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
  const layer = input.layers.find((entry) => objectKey('settings', entry.id) === object.key)
  if (layer === undefined) return <p>That settings file is no longer in the scan.</p>
  return (
    <div>
      <Head object={object} facts={layer.exists ? formatBytes(layer.bytes) : 'not created yet'} />
      <Section title="What it states" count={layer.keys.length}>
        <Row label="File">
          <span className="break-all text-ink-2">{layer.path}</span>
        </Row>
        <Row label="Layer">
          <span className="stamp">{layer.layer}</span>
        </Row>
        <Row label="Keys">
          {layer.keys.length === 0 ? (
            <span className="null">— nothing</span>
          ) : (
            <span className="break-all text-ink-2">{layer.keys.join(' · ')}</span>
          )}
        </Row>
        <p className="mt-3 text-xs">
          The highest layer that states a value wins: local over project over user. A
          settings file is a file, not a toggle.
        </p>
      </Section>
    </div>
  )
}

function PlacedPage({ object, input }: { object: LibraryObject; input: CatalogInput }) {
  const members = input.placed.filter(
    (entry) => objectKey(entry.kind as LibraryKind, entry.name) === object.key
  )
  return (
    <div>
      <Head
        object={object}
        facts={`in ${members.length === 1 ? '1 scope' : `${members.length} scopes`}`}
        description={members.find((entry) => entry.description !== null)?.description ?? null}
      />
      <Section title="Where it lives" count={members.length}>
        <div className="overflow-x-auto">
          <table className="ledger">
            <thead>
              <tr>
                <th>Scope</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {members.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">
                    {scopeLabel(entry.projectId, input.projects)}
                  </td>
                  <td className="max-w-md truncate text-ink-2" title={entry.origin}>
                    {entry.origin}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs">
          Claude has no way to switch one of these off; move the file out of the folder
          instead.
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
  if (entries.length === 0) return null
  return (
    <Section title={`Changes to this ${noun}`} count={entries.length}>
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
    </Section>
  )
}
