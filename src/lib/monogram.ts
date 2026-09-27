/**
 * Deterministic monograms for facilities without a logo.
 *
 * A hospital that has not uploaded artwork still needs to be told apart at a
 * glance in a list of twenty cards, so it gets a tile whose colour is derived
 * from its code and whose text is the code itself. The same input always gives
 * the same tile, on every device, with nothing stored.
 */

/** djb2 -- small, fast and stable across runtimes. */
export function hashString(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash
}

/** A hue in 0..359 spread so that neighbouring codes land on different colours. */
export function monogramHue(seed: string): number {
  // The golden-angle step keeps sequential seeds ("H001", "H002") far apart.
  return Math.round((hashString(seed.trim().toLowerCase()) * 137.508) % 360)
}

/** The text on the tile: a short code when there is one, otherwise initials. */
export function monogramText(name: string | null | undefined, code?: string | null): string {
  const cleanCode = (code ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (cleanCode.length >= 2 && cleanCode.length <= 5) return cleanCode
  if (cleanCode.length > 5) return cleanCode.slice(0, 4)

  const words = (name ?? '')
    .split(/[\s\-/(),.]+/)
    .filter(
      (word) =>
        word.length > 1 && !/^(the|of|and|for|at|in|hospital|clinic|centre|center)$/i.test(word),
    )
  if (words.length === 0) return (name ?? '?').slice(0, 2).toUpperCase() || '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

export interface MonogramColors {
  background: string
  foreground: string
  border: string
}

/**
 * Tile colours for one seed. Both palettes keep a strong contrast between text
 * and tile: about 7:1 on light, 8:1 on dark, for every hue.
 */
export function monogramColors(seed: string, dark = false): MonogramColors {
  const hue = monogramHue(seed)
  return dark
    ? {
        background: `hsl(${hue} 38% 20%)`,
        foreground: `hsl(${hue} 70% 82%)`,
        border: `hsl(${hue} 30% 30%)`,
      }
    : {
        background: `hsl(${hue} 60% 93%)`,
        foreground: `hsl(${hue} 55% 28%)`,
        border: `hsl(${hue} 45% 82%)`,
      }
}
