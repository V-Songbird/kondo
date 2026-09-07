import { useEffect, useRef, useState } from 'react'
import markUrl from '../assets/kondo-mark.svg?no-inline'
import { FIRST_PLACE, Projects } from '../features/projects/projects'
import type { ProjectsPlace, ProjectSection } from '../features/projects/projects'
import { Library } from '../features/library/library'
import type { LibraryKind } from '../features/library/catalog'
import { Tidy } from '../features/tidy/tidy'
import type { CleanupSection } from '../features/tidy/tidy'
import { Journal } from '../features/journal/journal'
import { Themes } from '../features/themes/themes'
import type { AppearanceState } from '../features/themes/themes'
import { applyTheme } from '../features/themes/appearance'
import { THEMES } from '../../shared/themes'
import type { ThemeId } from '../../shared/themes'

/**
 * Four management destinations, plus appearance. Kondo used to offer a tab
 * per entity kind, which asked
 * the user to know what a hook or a settings layer was before they could find
 * anything; then it offered them only through the project they belong to,
 * which answered "what is in this project" and could not answer "where does
 * this skill live" without opening 11,517 project pages.
 *
 * Library is the other lens on the same set: the named object is the row, and
 * a project is the other lens on it. Clean up groups file cleanup, duplicate
 * skills and configuration leftovers, with a separate review for each.
 * History provides the way back from changes.
 *
 * Where the user is inside a destination lives here rather than inside the
 * view, because a view is unmounted on every tab change. Going to History to
 * undo something and coming back preserves the filter and the open item.
 */
const DESTINATIONS = [
  { key: 'library', label: 'Library', help: 'Find skills and extensions' },
  { key: 'projects', label: 'Projects', help: 'Choose where they work' },
  { key: 'cleanup', label: 'Clean up', help: 'Review what you can remove' },
  { key: 'history', label: 'History', help: 'Review and undo changes' }
] as const

type ViewKey = (typeof DESTINATIONS)[number]['key'] | 'themes'

interface LibraryPlace {
  query: string
  kind: LibraryKind | null
  picked: string | null
}

const PROJECT_SECTION: Record<LibraryKind, ProjectSection> = {
  skill: 'skills', plugin: 'plugins', mcp: 'connections', hook: 'technical',
  agent: 'tools', command: 'tools', rule: 'tools', 'output-style': 'tools', settings: 'technical'
}

export function App({ initialAppearance }: { initialAppearance: AppearanceState }) {
  const [appearance, setAppearance] = useState(initialAppearance)
  const appearanceRequest = useRef(0)
  const confirmedAppearance = useRef({ request: 0, theme: initialAppearance.theme })
  const [active, setActive] = useState<ViewKey>('library')
  const [projectsPlace, setProjectsPlace] = useState<ProjectsPlace>(FIRST_PLACE)
  const [cleanupSection, setCleanupSection] = useState<CleanupSection>('files')
  const [fromLibrary, setFromLibrary] = useState(false)
  const main = useRef<HTMLElement>(null)
  const focusContent = useRef(false)
  const [libraryPlace, setLibraryPlace] = useState<LibraryPlace>({
    query: '',
    kind: null,
    picked: null
  })

  useEffect(() => {
    if (focusContent.current) {
      main.current?.focus()
      focusContent.current = false
    }
  }, [active])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1179px)')
    let lastFocused: HTMLElement | null = null
    let frame: number | null = null
    const rememberFocus = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement && event.target !== document.body) lastFocused = event.target
    }
    const keepFocusVisible = (): void => {
      // Chromium can blur an element as its pane hides, before matchMedia
      // fires. Remember the last control so that body is not a dead end.
      const focused = document.activeElement === document.body ? lastFocused : document.activeElement
      if (!(focused instanceof HTMLElement) || !focused.isConnected ||
        !main.current?.contains(focused) || focused.getClientRects().length > 0) return
      const candidates = [...(main.current?.querySelectorAll<HTMLElement>('h1, input, button') ?? [])]
        .filter((element) => element.getClientRects().length > 0)
      const target = candidates.find((element) => element.tagName === 'H1') ?? candidates[0]
      target?.focus()
    }
    const afterLayout = (): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(keepFocusVisible)
    }
    document.addEventListener('focusin', rememberFocus)
    narrow.addEventListener('change', afterLayout)
    return () => {
      document.removeEventListener('focusin', rememberFocus)
      narrow.removeEventListener('change', afterLayout)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  const openView = (view: ViewKey): void => {
    focusContent.current = true
    setActive(view)
  }

  const chooseTheme = async (theme: ThemeId): Promise<void> => {
    const request = ++appearanceRequest.current
    applyTheme(theme)
    setAppearance({ theme, saving: true, saved: false, error: null })
    try {
      const api = window.kondo
      if (!api) throw new Error('The Kondo bridge is unavailable.')
      const result = await api.appearanceSet(theme)
      const persisted = result.data.theme
      if (request >= confirmedAppearance.current.request) confirmedAppearance.current = { request, theme: persisted }
      if (request !== appearanceRequest.current) return
      applyTheme(persisted)
      setAppearance({ theme: persisted, saving: false, saved: !result.errors.length,
        error: result.errors.length
          ? `Kondo couldn’t save that theme. Still using ${THEMES[persisted].name}. You can try again.` : null })
    } catch {
      if (request !== appearanceRequest.current) return
      const previous = confirmedAppearance.current.theme
      applyTheme(previous)
      setAppearance({ theme: previous, saving: false, saved: false,
        error: 'Kondo couldn’t save that theme. Check that Kondo can save its preferences and try again.' })
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {/* The window has no OS title bar (electron/main/index.ts); this strip
          is what the user grabs to move it. */}
      <div className="titlebar" />
      <aside className="side">
        <div className="brand-lockup">
          <img className="mark" src={markUrl} width={30} height={30} alt="" />
          <div className="brand-copy">
            <div className="wordmark">kondo</div>
            <div className="tagline">keep your Claude tight</div>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {DESTINATIONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-label={entry.label}
              aria-current={entry.key === active ? 'page' : undefined}
              className="tab"
              onClick={() => setActive(entry.key)}
            >
              <span>{entry.label}</span>
              <span className="nav-purpose">{entry.help}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="tab appearance-link" aria-label="Themes"
          aria-current={active === 'themes' ? 'page' : undefined} onClick={() => openView('themes')}>
          <span>Themes</span>
          <span className="nav-purpose">{THEMES[appearance.theme].name}{appearance.error ? ' · Not saved' : ''}</span>
        </button>
        <div className="colophon">
          On your computer. Under your control.
          <br />v{__KONDO_VERSION__}
        </div>
      </aside>
      <main ref={main} id="main-content" tabIndex={-1} className="app-content">
        {active === 'library' && (
          <Library
            query={libraryPlace.query}
            onQuery={(query) => setLibraryPlace((current) => ({ ...current, query }))}
            kind={libraryPlace.kind}
            onKind={(kind) => setLibraryPlace((current) => ({ ...current, kind }))}
            picked={libraryPlace.picked}
            onPick={(picked) => setLibraryPlace((current) => ({ ...current, picked }))}
            onOpenHistory={() => openView('history')}
            onReviewSettings={() => {
              setCleanupSection('settings')
              openView('cleanup')
            }}
            onOpenProject={(projectId, itemKind) => {
              setProjectsPlace({ ...projectsPlace, picked: projectId, query: '', showFolded: true,
                section: PROJECT_SECTION[itemKind], detailOpen: true })
              setFromLibrary(true)
              openView('projects')
            }}
          />
        )}
        {active === 'projects' && (
          <div className="destination-stack">
            {fromLibrary && libraryPlace.picked !== null && <div className="return-context">
              <button type="button" className="btn" onClick={() => openView('library')}>
                Back to Library item
              </button>
              <p>Your search and selected item are saved.</p>
            </div>}
            <Projects place={projectsPlace} onPlace={setProjectsPlace} />
          </div>
        )}
        {active === 'cleanup' && <Tidy section={cleanupSection} onSection={setCleanupSection}
          onOpenHistory={() => openView('history')} />}
        {active === 'history' && <Journal />}
        {active === 'themes' && <Themes appearance={appearance} onChoose={(theme) => { void chooseTheme(theme) }} />}
      </main>
    </div>
  )
}
