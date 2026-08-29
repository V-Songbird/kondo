import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'

export function Hooks() {
  const state = useScan((api) => api.hooksList())
  return (
    <AsyncView state={state}>
      {(scan) =>
        scan.data.length === 0 ? (
          <div className="text-mut">No hooks armed in any settings layer.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Event</th>
                <th>Matcher</th>
                <th>Command</th>
                <th>Layer</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {scan.data.map((hook) => (
                <tr key={hook.id}>
                  <td className="font-mono">{hook.event}</td>
                  <td className="font-mono text-mut">{hook.matcher ?? '*'}</td>
                  <td className="max-w-md truncate font-mono text-xs" title={hook.command}>
                    {hook.command}
                  </td>
                  <td>
                    <span className="pill">{hook.layer}</span>
                  </td>
                  <td className="max-w-xs truncate font-mono text-xs text-mut" title={hook.source}>
                    {hook.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </AsyncView>
  )
}
