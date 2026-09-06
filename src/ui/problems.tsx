import { useId, useState } from 'react'
import type { Scan } from '../../shared/contract'

/**
 * The mandatory error half of every Scan (ADR-0005): a compact banner that
 * expands into the itemized list. Views must render this next to data.
 *
 * Two tones, because the two halves are not the same news. An error is
 * something kondo could not read and the user may want to act on, so it is a
 * note in the margin — a blue-ruled band. A file kondo did not recognize is
 * drift in Claude's own store (domain.md) and nothing the user did or can
 * fix — that alone is a muted line, not a band competing with the screen it
 * sits above.
 */
export function Problems({ scan }: { scan: Scan<unknown> }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const errorCount = scan.errors.length
  const unrecognized = scan.unknown.length
  if (errorCount === 0 && unrecognized === 0) return null
  const onlyUnrecognized = errorCount === 0

  const label = [
    errorCount > 0 ? `${errorCount} problem${errorCount === 1 ? '' : 's'}` : null,
    unrecognized > 0
      ? `${unrecognized} file${unrecognized === 1 ? '' : 's'} kondo did not recognize`
      : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={onlyUnrecognized ? 'mb-4' : 'band band-note block'}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        className={`disclose w-full ${onlyUnrecognized ? 'py-1' : 'py-0.5 text-note'}`}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div
          id={detailsId}
          className={`max-h-64 overflow-auto font-mono text-xs ${
            onlyUnrecognized ? 'py-1' : 'mt-2 border-t border-line pt-2'
          }`}
        >
          {scan.errors.map((error, index) => (
            <div key={`e${index}`} className="py-0.5">
              <span className="text-pencil">{error.code}</span>{' '}
              <span className="text-ink-2">{error.path}</span> — {error.message}
            </div>
          ))}
          {scan.unknown.map((entry, index) => (
            <div key={`u${index}`} className="py-0.5 text-ink-2">
              not recognized: {entry}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
