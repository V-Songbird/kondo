import type { CSSProperties } from 'react'
import { THEMES } from '../../../shared/themes'
import type { ThemeId } from '../../../shared/themes'

/** The same palette supplies the real window and each local theme preview. */
export function themeStyle(id: ThemeId): CSSProperties {
  const theme = THEMES[id]
  return {
    ...Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [`--${key}`, value])),
    colorScheme: theme.appearance
  }
}

export function applyTheme(id: ThemeId): void {
  const theme = THEMES[id]
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.colors)) root.style.setProperty(`--${key}`, value)
  root.style.colorScheme = theme.appearance
  root.dataset.theme = id
}
