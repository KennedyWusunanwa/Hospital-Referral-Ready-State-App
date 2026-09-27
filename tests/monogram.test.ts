import { describe, expect, it } from 'vitest'
import { hashString, monogramColors, monogramHue, monogramText } from '@/lib/monogram'

describe('hashString', () => {
  it('is deterministic and unsigned', () => {
    expect(hashString('KBTH')).toBe(hashString('KBTH'))
    expect(hashString('KBTH')).toBeGreaterThanOrEqual(0)
    expect(hashString('KBTH')).not.toBe(hashString('KATH'))
  })
})

describe('monogramHue', () => {
  it('stays inside the colour wheel', () => {
    for (const seed of ['KBTH', 'MIL37', 'RIDGE', 'TEMA', 'LEKMA', 'GAEAST', 'KATH', 'CCTH']) {
      const hue = monogramHue(seed)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('ignores case and surrounding whitespace', () => {
    expect(monogramHue(' kbth ')).toBe(monogramHue('KBTH'))
  })

  it('spreads sequential codes apart', () => {
    const a = monogramHue('H001')
    const b = monogramHue('H002')
    const distance = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    expect(distance).toBeGreaterThan(20)
  })
})

describe('monogramText', () => {
  it('prefers a short facility code', () => {
    expect(monogramText('Korle-Bu Teaching Hospital', 'KBTH')).toBe('KBTH')
    expect(monogramText('37 Military Hospital', 'MIL37')).toBe('MIL37')
  })

  it('shortens an over-long code', () => {
    expect(monogramText('Somewhere', 'GREATERACCRA')).toBe('GREA')
  })

  it('falls back to initials, skipping filler words', () => {
    expect(monogramText('Korle-Bu Teaching Hospital')).toBe('KBT')
    expect(monogramText('Tema General Hospital', null)).toBe('TG')
    expect(monogramText('Ridge')).toBe('RI')
  })

  it('never returns an empty tile', () => {
    expect(monogramText('', '')).toBe('?')
    expect(monogramText(null)).toBe('?')
  })
})

describe('monogramColors', () => {
  it('returns hsl triples for both surfaces', () => {
    const light = monogramColors('KBTH')
    const dark = monogramColors('KBTH', true)
    expect(light.background).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
    expect(dark.foreground).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
    expect(light.background).not.toBe(dark.background)
  })

  it('keeps the same hue across surfaces', () => {
    const hue = (value: string) => value.match(/^hsl\((\d+)/)?.[1]
    expect(hue(monogramColors('TEMA').background)).toBe(
      hue(monogramColors('TEMA', true).background),
    )
  })
})
