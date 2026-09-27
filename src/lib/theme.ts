import { useCallback, useEffect, useState } from 'react'

/** What is actually painted. */
export type Theme = 'light' | 'dark'
/** What the person asked for. `system` follows the operating system and tracks changes to it. */
export type ThemePreference = 'system' | Theme

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const STORAGE_KEY = 'fern.theme'

/** The dark shell surface, mirrored from the Tailwind slate-950 used by `body`. */
const DARK_CHROME = '#0f172a'

interface ThemeSnapshot {
  theme: Theme
  preference: ThemePreference
}

/** Listeners so every `useTheme` consumer re-renders on a change, not just the toggler. */
const listeners = new Set<(snapshot: ThemeSnapshot) => void>()

let currentPreference: ThemePreference = 'system'
let currentTheme: Theme = 'light'
let mediaQuery: MediaQueryList | null = null

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
  } catch {
    // Private mode or blocked site data: fall through to the OS preference.
    return 'system'
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference
}

/**
 * Keeps the browser chrome (Android address bar, installed-app title bar) in
 * step with the app: brand colour on light, the dark shell surface on dark.
 * The brand colour is read back from the CSS variable so a re-branded network
 * gets its own colour without this file knowing about it.
 */
export function syncThemeColorMeta(): void {
  if (typeof document === 'undefined') return
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  if (currentTheme === 'dark') {
    meta.content = DARK_CHROME
    return
  }
  const channels = getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()
  meta.content = channels ? `rgb(${channels})` : '#1b5cf5'
}

function paint(theme: Theme): void {
  currentTheme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  syncThemeColorMeta()
  const snapshot = { theme, preference: currentPreference }
  listeners.forEach((listener) => listener(snapshot))
}

/**
 * Sets the preference, persists it and repaints. `system` starts tracking the
 * OS setting again; a fixed theme stops tracking it.
 */
export function setThemePreference(preference: ThemePreference): void {
  currentPreference = preference
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // A themed preference is not worth failing a render over.
  }
  paint(resolveTheme(preference))
}

/** Back-compat for callers that only know light and dark: pins that theme. */
export function applyTheme(theme: Theme, persist = true): void {
  if (persist) {
    setThemePreference(theme)
    return
  }
  currentPreference = theme
  paint(theme)
}

/**
 * Applied once at boot, before React renders.
 *
 * This has to happen outside the component tree: the sign-in and password-reset
 * screens render without the app shell, so a preference applied only inside the
 * layout would leave those two pages stuck in light mode.
 */
export function initTheme(): void {
  currentPreference = readStoredPreference()
  paint(resolveTheme(currentPreference))

  if (typeof document !== 'undefined') {
    document.documentElement.addEventListener('fern:brand-color', () => syncThemeColorMeta())
  }

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  if (!mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (currentPreference === 'system') paint(systemTheme())
    }
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange)
    } else {
      // Safari < 14.
      mediaQuery.addListener(onChange)
    }
  }
}

export interface UseTheme {
  /** The theme currently painted. */
  theme: Theme
  /** The stored preference, which may be `system`. */
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  /** Flips between light and dark, pinning the result. */
  toggle: () => void
}

export function useTheme(): UseTheme {
  const [snapshot, setSnapshot] = useState<ThemeSnapshot>(() => ({
    theme:
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light',
    preference: currentPreference,
  }))

  useEffect(() => {
    listeners.add(setSnapshot)
    // The module may have painted between the initial render and this effect.
    setSnapshot({ theme: currentTheme, preference: currentPreference })
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const setPreference = useCallback((next: ThemePreference) => setThemePreference(next), [])
  const toggle = useCallback(
    () => setThemePreference(currentTheme === 'dark' ? 'light' : 'dark'),
    [],
  )

  return { theme: snapshot.theme, preference: snapshot.preference, setPreference, toggle }
}
