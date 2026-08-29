import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatAgo } from '../../lib/format'

export function Plugins() {
  const state = useScan((api) => api.pluginsList())
  return (
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
            {scan.data.map((plugin) => (
              <tr key={plugin.id}>
                <td className="font-mono">{plugin.name}</td>
                <td className="text-mut">{plugin.marketplace}</td>
                <td className="font-mono">{plugin.version ?? '—'}</td>
                <td className="text-mut">
                  {plugin.lastUpdated ? formatAgo(Date.parse(plugin.lastUpdated)) : '—'}
                </td>
                <td>
                  {plugin.enabledIn.length === 0 ? (
                    <span className="pill text-warn">nowhere</span>
                  ) : (
                    plugin.enabledIn.map((layer) => (
                      <span key={layer} className="pill mr-1 font-mono text-xs" title={layer}>
                        {layer}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AsyncView>
  )
}
