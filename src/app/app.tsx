import { useState } from 'react'
import { Projects } from '../features/projects/projects'
import { Tidy } from '../features/tidy/tidy'
import { Journal } from '../features/journal/journal'

/**
 * Three destinations, and the first one is where the app opens. Kondo used to
 * offer a tab per entity kind, which asked the user to know what a hook or a
 * settings layer was before they could find anything; the kinds are still all
 * there, reached the way a person actually thinks about them — through the
 * project they belong to.
 *
 * What is left beside Projects is the two things that are not about one
 * project at all: the sweep, and the history of everything kondo has changed.
 */
const views = [
  { key: 'projects', label: 'Projects', component: Projects },
  { key: 'cleanup', label: 'Clean up', component: Tidy },
  { key: 'history', label: 'History', component: Journal }
] as const

type ViewKey = (typeof views)[number]['key']

export function App() {
  const [active, setActive] = useState<ViewKey>('projects')
  const view = views.find((entry) => entry.key === active) ?? views[0]
  const Body = view.component

  return (
    <div className="flex h-screen">
      <nav className="flex w-48 shrink-0 flex-col border-r border-edge bg-panel p-3">
        <div className="mb-6 px-2 pt-1">
          <span className="text-lg font-semibold text-accent">kondo</span>
          <div className="text-xs text-mut">keep your Claude tight</div>
        </div>
        {views.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setActive(entry.key)}
            className={`mb-1 cursor-pointer rounded-md px-3 py-1.5 text-left ${
              entry.key === active
                ? 'bg-inset text-ink'
                : 'text-mut hover:bg-inset/60 hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        ))}
        {/* Every write is journaled and reversible (ADR-0001), which is the
            promise worth putting where the old "read-only" claim was. */}
        <div className="mt-auto px-2 text-[11px] text-mut">every change is undoable · v0.1</div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <Body />
      </main>
    </div>
  )
}
