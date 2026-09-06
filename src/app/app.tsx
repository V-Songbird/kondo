import { useState } from 'react'
import markUrl from '../assets/kondo-mark.svg'
import { FIRST_PLACE, Projects } from '../features/projects/projects'
import type { ProjectsPlace } from '../features/projects/projects'
import { Library } from '../features/library/library'
import type { LibraryKind } from '../features/library/catalog'
import { Tidy } from '../features/tidy/tidy'
import { Orphans } from '../features/orphans/orphans'
import { Journal } from '../features/journal/journal'

/**
 * Five destinations. Kondo used to offer a tab per entity kind, which asked
 * the user to know what a hook or a settings layer was before they could find
 * anything; then it offered them only through the project they belong to,
 * which answered "what is in this project" and could not answer "where does
 * this skill live" without opening 11,517 project pages.
 *
 * Library is the other lens on the same set: the named object is the row, and
 * a project is one filter over it. Beside the two of them sit the three things
 * that are about no single object at all — the sweep of disk, the leftovers
 * inside Claude's configuration files, and the history of every change kondo
 * has made. Clean up and Leftovers are next to each other and stay apart on
 * purpose: one reclaims bytes on disk, the other takes dead lines out of files
 * Claude is still reading.
 *
 * Where the user is inside a destination lives here rather than inside the
 * view, because a view is unmounted on every tab change. Going to History to
 * undo something and coming back used to cost the filter, the open project and
 * the scroll position.
 */
const DESTINATIONS = [
  { key: 'library', label: 'Library' },
  { key: 'projects', label: 'Projects' },
  { key: 'cleanup', label: 'Clean up' },
  { key: 'leftovers', label: 'Leftovers' },
  { key: 'history', label: 'History' }
] as const

type ViewKey = (typeof DESTINATIONS)[number]['key']

interface LibraryPlace {
  query: string
  kind: LibraryKind | null
  picked: string | null
}

export function App() {
  const [active, setActive] = useState<ViewKey>('projects')
  const [projectsPlace, setProjectsPlace] = useState<ProjectsPlace>(FIRST_PLACE)
  const [libraryPlace, setLibraryPlace] = useState<LibraryPlace>({
    query: '',
    kind: null,
    picked: null
  })

  return (
    <div className="flex h-screen p-6 pt-10">
      {/* The window has no OS title bar (electron/main/index.ts); this strip
          is what the user grabs to move it. */}
      <div className="titlebar" />
      <aside className="side">
        <img className="mark" src={markUrl} width={30} height={30} alt="" />
        <div className="wordmark">kondo</div>
        <div className="tagline">keep your Claude tight</div>
        <nav>
          {DESTINATIONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={entry.key === active ? 'page' : undefined}
              className="tab"
              onClick={() => setActive(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        {/* Every write is journaled and reversible (ADR-0001), which is the
            promise worth putting where the old "read-only" claim was. */}
        <div className="colophon">
          every change is undoable
          <br />v{__KONDO_VERSION__}
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto pl-6">
        {active === 'library' && (
          <Library
            query={libraryPlace.query}
            onQuery={(query) => setLibraryPlace({ ...libraryPlace, query })}
            kind={libraryPlace.kind}
            onKind={(kind) => setLibraryPlace({ ...libraryPlace, kind })}
            picked={libraryPlace.picked}
            onPick={(picked) => setLibraryPlace({ ...libraryPlace, picked })}
          />
        )}
        {active === 'projects' && (
          <Projects place={projectsPlace} onPlace={setProjectsPlace} />
        )}
        {active === 'cleanup' && <Tidy />}
        {active === 'leftovers' && <Orphans />}
        {active === 'history' && <Journal />}
      </main>
    </div>
  )
}
