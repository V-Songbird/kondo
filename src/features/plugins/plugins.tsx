import { Fragment, useState } from 'react'
import type { PluginInfo, PluginScopeState } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatAgo } from '../../lib/format'

/** Base first, override last: how the layers of one project read left to right. */
const WITHIN_PROJECT: Record<PluginScopeState['layer'], number> = {
  user: 0,
  project: 1,
  local: 2
}

/** One project's chips: its id, the name to show, and its layers in order. */
interface OwnerGroup {
  key: string
  label: string
  scopes: PluginScopeState[]
}

/**
 * The layers grouped by the project they belong to, user layer first. Every
 * project contributes a `project` and a `local` layer, so ungrouped the
 * chips are a row of identical words — the owner is the only thing that
 * tells them apart. Grouped by `projectId` and not by the folder name, since
 * two projects can share a name (ADR-0008).
 */
function byOwner(scopes: PluginScopeState[]): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>()
  for (const scope of scopes) {
    const key = scope.projectId ?? ''
    const group = groups.get(key) ?? {
      key,
      label: scope.projectLabel ?? 'global',
      scopes: []
    }
    group.scopes.push(scope)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => ({
      ...group,
      scopes: [...group.scopes].sort((a, b) => WITHIN_PROJECT[a.layer] - WITHIN_PROJECT[b.layer])
    }))
}

/** What a click on this scope would do — a layer that is silent gets enabled. */
function operationFor(scope: PluginScopeState): 'enable' | 'disable' {
  return scope.enabled === true ? 'disable' : 'enable'
}

function stateLabel(scope: PluginScopeState): string {
  if (scope.enabled === null) return '—'
  return scope.enabled ? 'on' : 'off'
}

/**
 * The skills one plugin ships, under the plugin that owns them. Loaded when
 * the row is opened and not before, so a plugins view of thirty rows reads
 * thirty `SKILL.md` files only if the user asks for all thirty (ADR-0007).
 *
 * Read-only by construction, which is why there is not a button in it: every
 * entry carries the `plugin` skill scope, whose capability row refuses enable,
 * disable and move alike. A plugin that ships none says so.
 */
function PluginSkills({ pluginId }: { pluginId: string }) {
  const state = useScan((api) => api.pluginSkills(pluginId), [pluginId])
  return (
    <AsyncView state={state}>
      {(scan) =>
        scan.data.length === 0 ? (
          <span className="text-mut">Ships no skills.</span>
        ) : (
          <ul className="space-y-1">
            {scan.data.map((skill) => (
              <li key={skill.id} className="flex gap-3">
                <span
                  className="w-56 shrink-0 truncate font-mono text-ink"
                  title={skill.origin}
                >
                  {skill.name}
                </span>
                <span className="truncate text-mut" title={skill.description ?? undefined}>
                  {skill.description ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    </AsyncView>
  )
}

/** A layer whose file is not there yet, held until the user says to create it. */
interface Pending {
  plugin: PluginInfo
  scope: PluginScopeState
  message: string
}

export function Plugins() {
  const state = useScan((api) => api.pluginsList())
  const [busy, setBusy] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const { reload } = state

  const toggle = async (
    plugin: PluginInfo,
    scope: PluginScopeState,
    createLayer: boolean
  ): Promise<void> => {
    const api = window.kondo
    if (!api) return
    setBusy(`${plugin.id}|${scope.layerId}`)
    setRefusal(null)
    setPending(null)
    try {
      const result = await api.pluginToggle(
        plugin.id,
        scope.layerId,
        operationFor(scope),
        createLayer
      )
      const error = result.errors[0]
      // A missing settings file is a question, not a failure: nothing was
      // written, and the layer is created only if the user says so.
      if (error?.code === 'needs-confirmation') {
        setPending({ plugin, scope, message: error.message })
      } else {
        setRefusal(error?.message ?? null)
      }
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      // ADR-0006: the settings file is the state, so nothing is patched here
      // — the list comes back from a fresh read of the store.
      reload()
    }
  }

  const chip = (
    plugin: PluginInfo,
    scope: PluginScopeState,
    winners: ReadonlySet<string>
  ): React.ReactElement => {
    const decision = scope.capabilities[operationFor(scope)]
    // Precedence is per project (domain.md), so a layer can be the one that
    // stands for its own project and say nothing about anyone else's.
    const wins = winners.has(scope.layerId)
    return (
      <button
        key={scope.layerId}
        type="button"
        disabled={!decision.allowed || busy !== null}
        title={`${scope.path}${scope.exists ? '' : ' (not created yet)'}${
          decision.reason ? ` — ${decision.reason}` : ''
        }`}
        className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
          wins ? 'border-accent text-ink' : 'border-edge text-mut'
        } hover:text-ink`}
        onClick={() => void toggle(plugin, scope, false)}
      >
        {scope.layer !== 'user' && `${scope.layer} `}
        <span className={scope.enabled === true ? 'text-ok' : 'text-mut'}>
          {stateLabel(scope)}
        </span>
        {wins && <span className="text-accent"> ★</span>}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {refusal !== null && <div className="card border-bad/50 text-bad">{refusal}</div>}
      {pending !== null && (
        <div className="card flex items-center gap-3">
          <span className="text-mut">{pending.message}</span>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-ink hover:text-accent"
            onClick={() => void toggle(pending.plugin, pending.scope, true)}
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
      <AsyncView state={state}>
        {(scan) => (
          <table className="tbl">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Marketplace</th>
                <th>Version</th>
                <th>Updated</th>
                <th>Enabled in</th>
              </tr>
            </thead>
            <tbody>
              {scan.data.map((plugin) => {
                const winners = new Set(plugin.effectiveIn.map((state) => state.layerId))
                return (
                <Fragment key={plugin.id}>
                  <tr>
                    <td className="font-mono">
                      <button
                        type="button"
                        aria-expanded={opened === plugin.id}
                        title={`${plugin.installPath} — show the skills it ships`}
                        className="cursor-pointer text-left hover:text-accent"
                        onClick={() =>
                          setOpened(opened === plugin.id ? null : plugin.id)
                        }
                      >
                        <span className="text-mut">
                          {opened === plugin.id ? '▾' : '▸'}
                        </span>{' '}
                        {plugin.name}
                      </button>
                    </td>
                    <td className="text-mut">{plugin.marketplace}</td>
                    <td className="font-mono">{plugin.version ?? '—'}</td>
                    <td className="text-mut">
                      {plugin.lastUpdated ? formatAgo(Date.parse(plugin.lastUpdated)) : '—'}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {plugin.effectiveIn.length === 0 && (
                          <span className="pill w-fit text-warn">enabled nowhere</span>
                        )}
                        {byOwner(plugin.scopes).map((group) => (
                          <div key={group.key} className="flex items-center gap-1">
                            <span
                              className="w-44 shrink-0 truncate text-right font-mono text-xs text-mut"
                              title={group.key === '' ? 'user settings' : group.key}
                            >
                              {group.key === '' ? 'global' : group.label}
                            </span>
                            {group.scopes.map((scope) => chip(plugin, scope, winners))}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {opened === plugin.id && (
                    <tr>
                      <td colSpan={5} className="bg-inset">
                        <PluginSkills pluginId={plugin.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </AsyncView>
    </div>
  )
}
