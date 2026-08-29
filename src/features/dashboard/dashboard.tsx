import type { StoreReport } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatAgo, formatBytes, formatCount } from '../../lib/format'

export function Dashboard() {
  const state = useScan((api) => api.storesOverview())

  return (
    <AsyncView state={state}>
      {(scan) => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="card">
              <div className="text-mut">Projects</div>
              <div className="text-2xl font-semibold">
                {scan.data.sessions.projectCount.toLocaleString()}
              </div>
            </div>
            <div className="card">
              <div className="text-mut">Sessions</div>
              <div className="text-2xl font-semibold">
                {scan.data.sessions.sessionCount.toLocaleString()}
              </div>
              <div className="text-xs text-warn">
                {formatCount(scan.data.sessions.staleCount, 'stale session')}
              </div>
            </div>
            <div className="card">
              <div className="text-mut">Transcript data</div>
              <div className="text-2xl font-semibold">
                {formatBytes(scan.data.sessions.transcriptBytes)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StoreCard title="Claude Code store" report={scan.data.user} />
            <StoreCard title="Claude desktop store" report={scan.data.desktop} />
          </div>
        </div>
      )}
    </AsyncView>
  )
}

function StoreCard({ title, report }: { title: string; report: StoreReport }) {
  return (
    <div className="card">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-sm text-mut">{formatBytes(report.totalBytes)}</span>
      </div>
      <div className="mb-3 font-mono text-xs text-mut">{report.root}</div>
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
