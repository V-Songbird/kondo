import { Fragment, useState } from 'react'
import type { SessionProject } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatAgo, formatBytes } from '../../lib/format'

export function Sessions() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SessionProject | null>(null)
  const state = useScan((api) => api.sessionProjects())

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter projects…"
          className="w-72 rounded-md border border-edge bg-inset px-3 py-1.5 outline-none placeholder:text-mut focus:border-accent"
        />
        <button
          type="button"
          className="cursor-pointer rounded-md border border-edge px-3 py-1.5 text-mut hover:text-ink"
          onClick={() => {
            setSelected(null)
            void window.kondo?.sessionProjects(true).then(() => state.reload())
          }}
        >
          Rescan
        </button>
      </div>

      <AsyncView state={state}>
        {(scan) => {
          const needle = query.trim().toLowerCase()
          const projects = scan.data
            .filter(
              (project) =>
                needle === '' ||
                project.dirName.toLowerCase().includes(needle) ||
                (project.guessedPath ?? '').toLowerCase().includes(needle)
            )
            .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
          return (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Stale</th>
                  <th className="text-right">Orphans</th>
                  <th className="text-right">Transcripts</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {projects.slice(0, 400).map((project) => (
                  <tr
                    key={project.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setSelected(selected?.id === project.id ? null : project)
                    }
                  >
                    <td className="max-w-md truncate font-mono" title={project.dirName}>
                      {project.guessedPath ?? project.dirName}
                    </td>
                    <td className="text-right">{project.sessionCount}</td>
                    <td className="text-right">
                      {project.staleCount > 0 ? (
                        <span className="text-warn">{project.staleCount}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">
                      {project.orphanCount > 0 ? (
                        <span className="text-bad">{project.orphanCount}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">{formatBytes(project.transcriptBytes)}</td>
                    <td className="text-mut">{formatAgo(project.lastActivityMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }}
      </AsyncView>

      {selected && <ProjectSessions project={selected} />}
      <DesktopSessions />
    </div>
  )
}

function ProjectSessions({ project }: { project: SessionProject }) {
  const [openSession, setOpenSession] = useState<string | null>(null)
  const state = useScan((api) => api.sessionList(project.id), [project.id])

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">
        Sessions in <span className="font-mono text-accent">{project.dirName}</span>
      </h2>
      <AsyncView state={state}>
        {(scan) => (
          <table className="tbl">
            <thead>
              <tr>
                <th>Session</th>
                <th className="text-right">Size</th>
                <th>Last activity</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {scan.data.map((session) => (
                <Fragment key={session.id}>
                  <tr
                    className="cursor-pointer"
                    onClick={() =>
                      setOpenSession(openSession === session.id ? null : session.id)
                    }
                  >
                    <td className="font-mono">{session.uuid}</td>
                    <td className="text-right">{formatBytes(session.bytes)}</td>
                    <td className="text-mut">{formatAgo(session.mtimeMs)}</td>
                    <td>
                      {session.stale && <span className="pill mr-1 text-warn">stale</span>}
                      {session.hasSidecar && <span className="pill">sidecar</span>}
                    </td>
                  </tr>
                  {openSession === session.id && (
                    <tr>
                      <td colSpan={4}>
                        <SessionDetailView sessionId={session.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </AsyncView>
    </div>
  )
}

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

function DesktopSessions() {
  const state = useScan((api) => api.desktopSessions())
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Claude desktop app sessions</h2>
      <AsyncView state={state}>
        {(scan) =>
          scan.data.length === 0 ? (
            <div className="text-mut">None found.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Account</th>
                  <th className="text-right">Size</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {scan.data.map((session) => (
                  <tr key={session.id}>
                    <td className="font-mono">{session.name}</td>
                    <td className="font-mono text-mut">{session.accountId}</td>
                    <td className="text-right">{formatBytes(session.bytes)}</td>
                    <td className="text-mut">{formatAgo(session.mtimeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </AsyncView>
    </div>
  )
}
