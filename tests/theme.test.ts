import { describe, expect, it } from 'vitest'
import { THEME_PREFERENCES, THEME_PREFERENCE_LABELS, resolveTheme } from '@/lib/theme'

describe('resolveTheme', () => {
  it('pins an explicit preference', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('falls back to light for the system preference where no media query exists', () => {
    // Node has no `window.matchMedia`; the browser path is exercised manually.
    expect(resolveTheme('system')).toBe('light')
  })

  it('offers exactly three preferences, each with a label', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
    for (const preference of THEME_PREFERENCES) {
      expect(THEME_PREFERENCE_LABELS[preference]).toBeTruthy()
    }
  })
})
