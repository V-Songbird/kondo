import { useScan } from '../../lib/use-scan'
import { AsyncView } from '../../ui/async-view'
import { formatBytes } from '../../lib/format'

export function Settings() {
  const state = useScan((api) => api.settingsLayers())
  return (
    <AsyncView state={state}>
      {(scan) => (
        <div className="space-y-3">
          {scan.data
            .filter((layer) => layer.exists)
            .map((layer) => (
              <div key={layer.id} className="card">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-sm">{layer.path}</span>
                  <span className="text-xs text-mut">
                    <span className="pill mr-2">{layer.layer}</span>
                    {formatBytes(layer.bytes)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {layer.keys.map((key) => (
                    <span key={key} className="pill font-mono">
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          <p className="text-xs text-mut">
            Layers that do not exist on disk are hidden. Precedence: local over
            project over user.
          </p>
        </div>
      )}
    </AsyncView>
  )
}
