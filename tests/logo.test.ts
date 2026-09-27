import { describe, expect, it } from 'vitest'
import { resolveLogo, toLogoMode } from '@/lib/branding'
import { BUILT_IN_LOGOS } from '@/lib/constants'

const none = { logoUrl: null, logoDarkUrl: null, logoMode: 'auto' as const }

describe('resolveLogo', () => {
  it('follows the theme with the built-in artwork when nothing is uploaded', () => {
    expect(resolveLogo(none, 'light')).toEqual({
      src: BUILT_IN_LOGOS.light,
      variant: 'light',
      builtIn: true,
    })
    expect(resolveLogo(none, 'dark')).toEqual({
      src: BUILT_IN_LOGOS.dark,
      variant: 'dark',
      builtIn: true,
    })
  })

  it('gives a coloured panel the dark-surface artwork whatever the theme', () => {
    expect(resolveLogo(none, 'light', 'dark').src).toBe(BUILT_IN_LOGOS.dark)
  })

  it('hands back the square mark when asked for one', () => {
    expect(resolveLogo(none, 'light', 'auto', 'mark').src).toBe(BUILT_IN_LOGOS.markLight)
    expect(resolveLogo(none, 'dark', 'auto', 'mark').src).toBe(BUILT_IN_LOGOS.markDark)
  })

  it('uses the matching upload for each surface', () => {
    const both = {
      logoUrl: 'https://x/light.png',
      logoDarkUrl: 'https://x/dark.png',
      logoMode: 'auto' as const,
    }
    expect(resolveLogo(both, 'light')).toEqual({
      src: 'https://x/light.png',
      variant: 'light',
      builtIn: false,
    })
    expect(resolveLogo(both, 'dark')).toEqual({
      src: 'https://x/dark.png',
      variant: 'dark',
      builtIn: false,
    })
  })

  it('uses a single upload on both surfaces rather than mixing it with the built-in art', () => {
    const lightOnly = { logoUrl: 'https://x/one.png', logoDarkUrl: null, logoMode: 'auto' as const }
    expect(resolveLogo(lightOnly, 'dark').src).toBe('https://x/one.png')
    const darkOnly = { logoUrl: null, logoDarkUrl: 'https://x/two.png', logoMode: 'auto' as const }
    expect(resolveLogo(darkOnly, 'light').src).toBe('https://x/two.png')
  })

  it('a custom upload beats the mark request', () => {
    const custom = { logoUrl: 'https://x/one.png', logoDarkUrl: null, logoMode: 'auto' as const }
    expect(resolveLogo(custom, 'light', 'auto', 'mark').src).toBe('https://x/one.png')
  })

  it('a pinned mode overrides both the theme and the surface', () => {
    expect(resolveLogo({ ...none, logoMode: 'light' }, 'dark', 'dark').src).toBe(
      BUILT_IN_LOGOS.light,
    )
    expect(resolveLogo({ ...none, logoMode: 'dark' }, 'light', 'light').src).toBe(
      BUILT_IN_LOGOS.dark,
    )
  })
})

describe('toLogoMode', () => {
  it('accepts the three modes and defaults everything else to auto', () => {
    expect(toLogoMode('light')).toBe('light')
    expect(toLogoMode('dark')).toBe('dark')
    expect(toLogoMode('auto')).toBe('auto')
    expect(toLogoMode('purple')).toBe('auto')
    expect(toLogoMode(null)).toBe('auto')
  })
})
