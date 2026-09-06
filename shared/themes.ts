/** Appearance is Kondo's own preference; these colors never enter Claude settings. */
export const THEME_IDS = ['chalk', 'parchment', 'sage', 'slate', 'carbon', 'signal'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export const DEFAULT_THEME: ThemeId = 'chalk'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.some((id) => id === value)
}

const chalk = {
  base: '#f1f2f0', raised: '#fcfcfa', 'raised-more': '#e5edeb',
  rule: '#d0d5d3', 'rule-strong': '#666d6e',
  ink: '#23282a', 'ink-2': '#50595b', 'ink-3': '#5f696b',
  accent: '#47696b', 'accent-ink': '#ffffff',
  ok: '#356343', off: '#805820', bad: '#9a3e36', unknown: '#566477',
  chrome: '#23282a', 'chrome-ink': '#f4f5f2', 'chrome-muted': '#c0c8c7',
  hero: '#fcfcfa', 'hero-ink': '#23282a', 'hero-muted': '#50595b',
  'hero-action': '#23282a', 'hero-action-ink': '#f5f6f3',
  nav: '#23282a', 'nav-ink': '#f5f6f3', 'nav-muted': '#d7dedb',
  shadow: '#a8b3af'
} as const

export type ThemeColors = Record<keyof typeof chalk, string>

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  appearance: 'light' | 'dark'
  colors: ThemeColors
}

/** One catalog supplies renderer variables, theme previews and native window colors. */
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  chalk: {
    id: 'chalk', name: 'Chalk', description: 'Soft white, charcoal and a quiet teal accent.',
    appearance: 'light', colors: chalk
  },
  parchment: {
    id: 'parchment', name: 'Parchment', description: 'Warm paper, brown ink and a dark heading band.',
    appearance: 'light', colors: {
      base: '#eeeae2', raised: '#faf7f0', 'raised-more': '#e8e0d2',
      rule: '#d3cabe', 'rule-strong': '#776b60',
      ink: '#352f2b', 'ink-2': '#65594e', 'ink-3': '#6d6257',
      accent: '#765b48', 'accent-ink': '#ffffff',
      ok: '#456143', off: '#805020', bad: '#984333', unknown: '#5d596c',
      chrome: '#352f2b', 'chrome-ink': '#faf7f0', 'chrome-muted': '#d5cabe',
      hero: '#352f2b', 'hero-ink': '#faf7f0', 'hero-muted': '#d5cabe',
      'hero-action': '#e8e0d2', 'hero-action-ink': '#352f2b',
      nav: '#e8e0d2', 'nav-ink': '#352f2b', 'nav-muted': '#65594e',
      shadow: '#b1a79a'
    }
  },
  sage: {
    id: 'sage', name: 'Sage', description: 'Pale greens and restrained woodland accents.',
    appearance: 'light', colors: {
      base: '#f0f1ec', raised: '#fbfbf6', 'raised-more': '#e4e9df',
      rule: '#cdd4c9', 'rule-strong': '#6c766d',
      ink: '#29312e', 'ink-2': '#566251', 'ink-3': '#5b6857',
      accent: '#536b5d', 'accent-ink': '#ffffff',
      ok: '#3f6045', off: '#7b5628', bad: '#963f37', unknown: '#536273',
      chrome: '#29312e', 'chrome-ink': '#f5f6f0', 'chrome-muted': '#c3cec2',
      hero: '#e1e7db', 'hero-ink': '#29312e', 'hero-muted': '#546253',
      'hero-action': '#536b5d', 'hero-action-ink': '#fbfbf6',
      nav: '#536b5d', 'nav-ink': '#fbfbf6', 'nav-muted': '#f0f3e9',
      shadow: '#a4b2a3'
    }
  },
  slate: {
    id: 'slate', name: 'Slate', description: 'Cool gray surfaces with a muted blue heading band.',
    appearance: 'light', colors: {
      base: '#eaeef0', raised: '#f8faf9', 'raised-more': '#dbe4e9',
      rule: '#c8d2d7', 'rule-strong': '#687880',
      ink: '#283238', 'ink-2': '#4e5d67', 'ink-3': '#56646b',
      accent: '#4b6373', 'accent-ink': '#ffffff',
      ok: '#326047', off: '#795423', bad: '#963f3d', unknown: '#505e7a',
      chrome: '#283238', 'chrome-ink': '#f0f4f5', 'chrome-muted': '#c1cfd5',
      hero: '#506575', 'hero-ink': '#fafcfc', 'hero-muted': '#e0e8ec',
      'hero-action': '#e0e8ec', 'hero-action-ink': '#283238',
      nav: '#dbe4e9', 'nav-ink': '#283238', 'nav-muted': '#4e5d67',
      shadow: '#9eafb9'
    }
  },
  carbon: {
    id: 'carbon', name: 'Carbon', description: 'Dark charcoal with soft mint and clear, quiet contrast.',
    appearance: 'dark', colors: {
      base: '#202626', raised: '#272e2e', 'raised-more': '#354441',
      rule: '#485651', 'rule-strong': '#7b8a84',
      ink: '#edf0eb', 'ink-2': '#c2ccc6', 'ink-3': '#b1beb7',
      accent: '#a0beb8', 'accent-ink': '#182423',
      ok: '#b1ce9b', off: '#e2c184', bad: '#f0a296', unknown: '#b9c5de',
      chrome: '#161c1c', 'chrome-ink': '#edf0eb', 'chrome-muted': '#abb8b2',
      hero: '#202626', 'hero-ink': '#edf0eb', 'hero-muted': '#b5c0bb',
      'hero-action': '#a0beb8', 'hero-action-ink': '#182423',
      nav: '#354441', 'nav-ink': '#edf0eb', 'nav-muted': '#c2ccc6',
      shadow: '#111717'
    }
  },
  signal: {
    id: 'signal', name: 'Signal Original', description: 'The original vivid Signal: cobalt, warm paper and a citrus accent.',
    appearance: 'light', colors: {
      base: '#f4f1e7', raised: '#fffdf7', 'raised-more': '#e4f260',
      rule: '#d0d0ba', 'rule-strong': '#171913',
      ink: '#171913', 'ink-2': '#484d40', 'ink-3': '#59604c',
      accent: '#1841df', 'accent-ink': '#ffffff',
      ok: '#305b31', off: '#795119', bad: '#9a3028', unknown: '#465377',
      chrome: '#171913', 'chrome-ink': '#f4f1e7', 'chrome-muted': '#d3d6c8',
      hero: '#1841df', 'hero-ink': '#ffffff', 'hero-muted': '#f0f3ff',
      'hero-action': '#e4f260', 'hero-action-ink': '#171913',
      nav: '#1841df', 'nav-ink': '#ffffff', 'nav-muted': '#e4eaff',
      shadow: '#171913'
    }
  }
}
