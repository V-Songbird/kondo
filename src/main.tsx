import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app'
import { ErrorBoundary } from './ui/error-boundary'
import { DEFAULT_THEME, isThemeId } from '../shared/themes'
import { applyTheme } from './features/themes/appearance'
import type { AppearanceState } from './features/themes/themes'
import './index.css'

async function mount(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) return
  const appearance: AppearanceState = { theme: DEFAULT_THEME, saving: false, saved: false, error: null }
  applyTheme(DEFAULT_THEME)
  try {
    if (window.kondo) {
      const result = await window.kondo.appearanceGet()
      if (isThemeId(result.data.theme)) appearance.theme = result.data.theme
      if (result.errors.length) appearance.error = 'Kondo could not read your saved theme. Choose a theme to save a new preference.'
    }
  } catch {
    appearance.error = 'Kondo could not read your saved theme. You can choose it again in Themes.'
  }
  applyTheme(appearance.theme)
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App initialAppearance={appearance} />
      </ErrorBoundary>
    </StrictMode>
  )
}

void mount()
