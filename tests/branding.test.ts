import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRAND_COLOR,
  buildBrandScale,
  contrastRatio,
  hexToRgb,
  isValidHex,
  readableForeground,
  rgbToHex,
  whiteContrast,
  type Rgb,
} from '@/lib/branding'

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** Perceived lightness, good enough to assert the ramp runs light to dark. */
function lightness([r, g, b]: Rgb): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

describe('isValidHex', () => {
  it('accepts six-digit hex in either case', () => {
    expect(isValidHex('#1b5cf5')).toBe(true)
    expect(isValidHex('#AABBCC')).toBe(true)
    expect(isValidHex('  #1b5cf5  ')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidHex('#fff')).toBe(false)
    expect(isValidHex('1b5cf5')).toBe(false)
    expect(isValidHex('#1b5cf')).toBe(false)
    expect(isValidHex('rebeccapurple')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('hexToRgb / rgbToHex', () => {
  it('round-trips', () => {
    for (const hex of ['#1b5cf5', '#000000', '#ffffff', '#0d9488', '#e11d48']) {
      expect(rgbToHex(hexToRgb(hex) as Rgb)).toBe(hex)
    }
  })

  it('returns null for an invalid value rather than throwing', () => {
    expect(hexToRgb('nope')).toBeNull()
  })

  it('clamps out-of-range channels', () => {
    expect(rgbToHex([-20, 300, 128])).toBe('#00ff80')
  })
})

describe('buildBrandScale', () => {
  it('keeps the chosen colour exactly at the 600 stop', () => {
    // The 600 stop is what buttons and links use, so an administrator must get
    // back the colour they picked, not a rounded approximation of it.
    for (const hex of ['#1b5cf5', '#0d9488', '#e11d48', '#475569']) {
      expect(rgbToHex(buildBrandScale(hex)[600])).toBe(hex)
    }
  })

  it('produces every stop the app uses', () => {
    const scale = buildBrandScale(DEFAULT_BRAND_COLOR)
    for (const stop of STOPS) {
      expect(scale[stop]).toHaveLength(3)
      for (const channel of scale[stop]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
        expect(Number.isInteger(channel)).toBe(true)
      }
    }
  })

  it('ramps from light to dark', () => {
    const scale = buildBrandScale('#0d9488')
    // 600 is the chosen colour and may sit slightly off the derived curve, so
    // the monotonic check skips it.
    const checked = STOPS.filter((stop) => stop !== 600)
    for (let i = 1; i < checked.length; i += 1) {
      expect(lightness(scale[checked[i]])).toBeLessThan(lightness(scale[checked[i - 1]]))
    }
  })

  it('falls back to the default for an invalid colour instead of throwing', () => {
    expect(rgbToHex(buildBrandScale('not-a-colour')[600])).toBe(DEFAULT_BRAND_COLOR)
  })

  it('handles greyscale, where hue is undefined', () => {
    const scale = buildBrandScale('#808080')
    expect(rgbToHex(scale[600])).toBe('#808080')
    expect(lightness(scale[50])).toBeGreaterThan(lightness(scale[950]))
  })
})

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a: Rgb = [27, 92, 245]
    const b: Rgb = [255, 255, 255]
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('flags a brand colour too light for white button text', () => {
    // The default passes AA; a bright amber does not, which is exactly what the
    // Appearance screen warns about.
    expect(whiteContrast(DEFAULT_BRAND_COLOR)).toBeGreaterThanOrEqual(4.5)
    expect(whiteContrast('#fbbf24')).toBeLessThan(4.5)
  })
})

describe('readableForeground', () => {
  it('picks white on a dark brand and near-black on a light one', () => {
    expect(readableForeground([27, 92, 245])).toEqual([255, 255, 255])
    expect(readableForeground([251, 191, 36])).toEqual([2, 6, 23])
  })

  it('always returns the more readable of the two', () => {
    for (const hex of ['#1b5cf5', '#fbbf24', '#0d9488', '#ffffff', '#000000', '#7c3aed']) {
      const rgb = hexToRgb(hex) as Rgb
      const fg = readableForeground(rgb)
      const other: Rgb = fg[0] === 255 ? [2, 6, 23] : [255, 255, 255]
      expect(contrastRatio(rgb, fg)).toBeGreaterThanOrEqual(contrastRatio(rgb, other))
    }
  })
})
