import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'fern.theme'

/** Listeners so every `useTheme` consumer re-renders on a change, not just the toggler. */
const listeners = new Set<(theme: Theme) => void>()

function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    // Private mode or blocked site data: fall through to the OS preference.
    return null
  }
}

export function resolveInitialTheme(): Theme {
  const stored = readStored()
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // A themed preference is not worth failing a render over.
    }
  }
  listeners.forEach((listener) => listener(theme))
}

/**
 * Applied once at boot, before React renders.
 *
 * This has to happen outside the component tree: the sign-in and password-reset
 * screens render without the app shell, so a preference applied only inside the
 * layout would leave those two pages stuck in light mode.
 */
export function initTheme(): void {
  applyTheme(resolveInitialTheme(), false)
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    listeners.add(setThemeState)
    return () => {
      listeners.delete(setThemeState)
    }
  }, [])

  const setTheme = useCallback((next: Theme) => applyTheme(next), [])

  return [theme, setTheme]
}
