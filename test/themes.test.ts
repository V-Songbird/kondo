import { describe, expect, it } from 'vitest'
import { THEMES, THEME_IDS } from '../shared/themes'

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
}

function contrast(foreground: string, background: string): number {
  const light = luminance(foreground)
  const dark = luminance(background)
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
}

describe('theme legibility', () => {
  for (const id of THEME_IDS) {
    const { colors } = THEMES[id]
    it(`${id}: body copy and status text remain readable on every content surface`, () => {
      for (const foreground of ['ink', 'ink-2', 'ink-3', 'accent', 'ok', 'off', 'bad', 'unknown'] as const) {
        for (const background of ['base', 'raised', 'raised-more'] as const) {
          expect(contrast(colors[foreground], colors[background]), `${id}: ${foreground} on ${background}`)
            .toBeGreaterThanOrEqual(4.5)
        }
      }
    })
    it(`${id}: heading, navigation and action labels remain readable on their own fills`, () => {
      for (const [foreground, background] of [
        ['chrome-ink', 'chrome'], ['chrome-muted', 'chrome'],
        ['hero-ink', 'hero'], ['hero-muted', 'hero'],
        ['nav-ink', 'nav'], ['nav-muted', 'nav'],
        ['accent-ink', 'accent'], ['hero-action-ink', 'hero-action']
      ] as const) {
        expect(contrast(colors[foreground], colors[background]), `${id}: ${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
