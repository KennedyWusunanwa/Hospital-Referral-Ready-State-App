/**
 * Runtime brand theming.
 *
 * Tailwind compiles a fixed palette, so the brand colours are declared as CSS
 * variables (see tailwind.config.js and index.css) and rewritten here from
 * `app_settings`. An administrator picks one colour; the other ten stops are
 * derived so hover, border and dark-mode shades stay coherent instead of
 * needing eleven colour pickers.
 */

export const DEFAULT_BRAND_COLOR = '#1b5cf5'

export type Rgb = [number, number, number]

/** The Tailwind stops the app actually uses. */
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
type Stop = (typeof STOPS)[number]

/**
 * Lightness targets, and saturation relative to the chosen colour, measured off
 * the original hand-picked palette. The chosen colour becomes the 600 stop --
 * the one buttons and links use -- and everything else ramps away from it.
 */
const RAMP: Record<Stop, { l: number; s: number }> = {
  50: { l: 97, s: 1.1 },
  100: { l: 93, s: 1.1 },
  200: { l: 87, s: 1.1 },
  300: { l: 78, s: 1.1 },
  400: { l: 67, s: 1.1 },
  500: { l: 60, s: 1.1 },
  600: { l: 53, s: 1.0 },
  700: { l: 48, s: 0.92 },
  800: { l: 40, s: 0.86 },
  900: { l: 33, s: 0.77 },
  950: { l: 21, s: 0.68 },
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

export function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim()
  if (!isValidHex(value)) return null
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ]
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6

  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100

  if (sn === 0) {
    const v = Math.round(ln * 255)
    return [v, v, v]
  }

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const channel = (t: number) => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }

  return [
    Math.round(channel(hn + 1 / 3) * 255),
    Math.round(channel(hn) * 255),
    Math.round(channel(hn - 1 / 3) * 255),
  ]
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

const WHITE: Rgb = [255, 255, 255]
/** slate-950, the app's darkest surface -- used when white would be unreadable. */
const NEAR_BLACK: Rgb = [2, 6, 23]

/** Whichever of white / near-black is more readable on the given colour. */
export function readableForeground(background: Rgb): Rgb {
  return contrastRatio(background, WHITE) >= contrastRatio(background, NEAR_BLACK)
    ? WHITE
    : NEAR_BLACK
}

/** Contrast of white text on this colour. Below 4.5 fails WCAG AA for body text. */
export function whiteContrast(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 21
  return contrastRatio(rgb, WHITE)
}

/** The eleven stops derived from one colour, with 600 left exactly as chosen. */
export function buildBrandScale(hex: string): Record<Stop, Rgb> {
  const base = hexToRgb(hex) ?? (hexToRgb(DEFAULT_BRAND_COLOR) as Rgb)
  const [h, s] = rgbToHsl(base)

  const scale = {} as Record<Stop, Rgb>
  for (const stop of STOPS) {
    const { l, s: sFactor } = RAMP[stop]
    scale[stop] = hslToRgb(h, clamp(s * sFactor, 0, 100), l)
  }
  // The administrator picked this exact colour; do not hand back a rounded
  // approximation of it for the stop they will actually look at.
  scale[600] = base
  return scale
}

/**
 * Writes the ramp onto the document. Called before first paint with the stored
 * colour, and again on every save so the change is visible immediately.
 */
export function applyBrandColor(hex: string): void {
  if (typeof document === 'undefined') return
  const scale = buildBrandScale(hex)
  const root = document.documentElement
  for (const stop of STOPS) {
    const [r, g, b] = scale[stop]
    root.style.setProperty(`--brand-${stop}`, `${r} ${g} ${b}`)
  }
  const [fr, fg, fb] = readableForeground(scale[600])
  root.style.setProperty('--brand-fg', `${fr} ${fg} ${fb}`)
}

/** Restores the compiled-in defaults by removing the inline overrides. */
export function clearBrandColor(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const stop of STOPS) root.style.removeProperty(`--brand-${stop}`)
  root.style.removeProperty('--brand-fg')
}

const CACHE_KEY = 'fern.branding'

export interface CachedBranding {
  brandColor: string
  logoUrl: string | null
  appName: string
  appTagline: string
}

/**
 * Branding lives behind a network request, so the first paint would otherwise
 * flash the default blue before settling. The last known values are cached and
 * applied synchronously at boot, then reconciled when the query resolves.
 */
export function readCachedBranding(): CachedBranding | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedBranding>
    if (!parsed.brandColor || !isValidHex(parsed.brandColor)) return null
    return {
      brandColor: parsed.brandColor,
      logoUrl: parsed.logoUrl ?? null,
      appName: parsed.appName ?? 'FERN',
      appTagline: parsed.appTagline ?? '',
    }
  } catch {
    return null
  }
}

export function writeCachedBranding(value: CachedBranding): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // Private mode or blocked site data: the colour just re-fetches next load.
  }
}

/** Applied once at boot, before React renders, from the cached values. */
export function initBranding(): void {
  const cached = readCachedBranding()
  applyBrandColor(cached?.brandColor ?? DEFAULT_BRAND_COLOR)
}
