import type { SkillScope } from '../../../shared/contract'
import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'

const SCOPE_LABEL: Record<SkillScope, string> = {
  user: 'global',
  'user-disabled': 'disabled',
  plugin: 'plugin',
  project: 'project'
}

export function Skills() {
  const state = useScan((api) => api.skillsList())
  return (
    <AsyncView state={state}>
      {(scan) => (
        <table className="tbl">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Scope</th>
              <th>Description</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {scan.data.map((skill) => (
              <tr key={skill.id} className={skill.enabled ? '' : 'opacity-60'}>
                <td className="font-mono">{skill.name}</td>
                <td>
                  <span className={`pill ${skill.enabled ? '' : 'text-warn'}`}>
                    {SCOPE_LABEL[skill.scope]}
                  </span>
                </td>
                <td className="max-w-lg text-mut">{skill.description ?? '—'}</td>
                <td className="max-w-xs truncate font-mono text-xs text-mut" title={skill.origin}>
                  {skill.origin}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AsyncView>
  )
}
