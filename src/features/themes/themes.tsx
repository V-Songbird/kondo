import { useRef } from 'react'
import { DEFAULT_THEME, THEMES, THEME_IDS } from '../../../shared/themes'
import type { ThemeId } from '../../../shared/themes'
import markUrl from '../../assets/kondo-mark.svg?no-inline'
import { themeStyle } from './appearance'
import './themes.css'

export interface AppearanceState {
  theme: ThemeId
  saving: boolean
  error: string | null
  saved: boolean
}

export function Themes({ appearance, onChoose }: {
  appearance: AppearanceState
  onChoose: (theme: ThemeId) => void
}) {
  const current = THEMES[appearance.theme]
  const choices = useRef<HTMLFieldSetElement>(null)
  return (
    <div className="themes-page">
      <div className="hero">
        <h1>Themes</h1>
        <p className="mt-2">Make Kondo feel like your space. Choose a look and keep working.</p>
      </div>
      <fieldset ref={choices} className="theme-choices" aria-describedby="theme-help">
        <legend>Choose a theme</legend>
        <p id="theme-help">Chalk is the default. Your choice applies throughout Kondo and is remembered on this computer.</p>
        <div className="theme-grid">
          {THEME_IDS.map((id) => {
            const theme = THEMES[id]
            const selected = id === appearance.theme
            return (
              <label key={id} className="theme-option" data-selected={selected}>
                <span className="theme-option-heading">
                  <input type="radio" className="theme-radio" name="kondo-theme" value={id}
                    aria-label={theme.name} aria-describedby={`theme-description-${id}`}
                    checked={selected} onChange={() => onChoose(id)} />
                  <span className="theme-name">{theme.name}</span>
                  {id === DEFAULT_THEME && <span className="theme-default">Default</span>}
                </span>
                <span className="theme-preview" style={themeStyle(id)} aria-hidden="true">
                  <span className="theme-preview-chrome"><img src={markUrl} alt="" />kondo_</span>
                  <span className="theme-preview-hero">A place for<br />everything.</span>
                  <span className="theme-preview-workspace">
                    <span className="theme-preview-items">
                      <span className="theme-preview-item">Your skills<span className="theme-preview-line" /></span>
                      <span className="theme-preview-item">Your plugins<span className="theme-preview-line" /></span>
                    </span>
                    <span className="theme-preview-detail"><span className="theme-preview-line" /><span className="theme-preview-action">Manage</span></span>
                  </span>
                </span>
                <span id={`theme-description-${id}`} className="theme-description">{theme.description}</span>
                <span className="theme-current">{selected ? 'Current theme' : 'Use this theme'}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="theme-save-status" role="status" aria-live="polite" aria-atomic="true">
        {appearance.saving ? `Saving ${current.name}…` :
          appearance.saved && !appearance.error ? `${current.name} saved. Kondo will use it next time you open the app.` :
            !appearance.error ? `Using ${current.name}.` : null}
      </div>
      {appearance.error && <div className="theme-save-error" role="alert">
        <p>{appearance.error}</p>
        <button type="button" className="btn" onClick={() => {
          choices.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
          onChoose(appearance.theme)
        }}>Save current theme again</button>
      </div>}
      <p className="theme-scope-note">Themes change Kondo’s appearance. Your Claude Code setup stays the same.</p>
    </div>
  )
}
