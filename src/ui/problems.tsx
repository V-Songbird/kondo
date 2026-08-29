import { useState } from 'react'
import type { Scan } from '../../shared/contract'

/**
 * The mandatory error half of every Scan (ADR-0005): a compact banner that
 * expands into the itemized list. Views must render this next to data.
 */
export function Problems({ scan }: { scan: Scan<unknown> }) {
  const [open, setOpen] = useState(false)
  const errorCount = scan.errors.length
  const unknownCount = scan.unknown.length
  if (errorCount === 0 && unknownCount === 0) return null

  const label = [
    errorCount > 0 ? `${errorCount} problem${errorCount === 1 ? '' : 's'}` : null,
    unknownCount > 0 ? `${unknownCount} unrecognized entr${unknownCount === 1 ? 'y' : 'ies'}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="card mb-4 border-warn/40 p-0">
      <button
        type="button"
        className="w-full cursor-pointer px-4 py-2 text-left text-warn"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t border-edge px-4 py-2 font-mono text-xs">
          {scan.errors.map((error, index) => (
            <div key={`e${index}`} className="py-0.5">
              <span className="text-bad">{error.code}</span>{' '}
              <span className="text-mut">{error.path}</span> — {error.message}
            </div>
          ))}
          {scan.unknown.map((entry, index) => (
            <div key={`u${index}`} className="py-0.5 text-mut">
              unknown: {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
