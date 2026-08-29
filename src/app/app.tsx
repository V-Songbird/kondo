import { useState } from 'react'
import { Dashboard } from '../features/dashboard/dashboard'
import { Sessions } from '../features/sessions/sessions'
import { Skills } from '../features/skills/skills'
import { Plugins } from '../features/plugins/plugins'
import { Hooks } from '../features/hooks/hooks'
import { Settings } from '../features/settings/settings'

const views = [
  { key: 'dashboard', label: 'Dashboard', component: Dashboard },
  { key: 'sessions', label: 'Sessions', component: Sessions },
  { key: 'skills', label: 'Skills', component: Skills },
  { key: 'plugins', label: 'Plugins', component: Plugins },
  { key: 'hooks', label: 'Hooks', component: Hooks },
  { key: 'settings', label: 'Settings', component: Settings }
] as const

type ViewKey = (typeof views)[number]['key']

export function App() {
  const [active, setActive] = useState<ViewKey>('dashboard')
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
