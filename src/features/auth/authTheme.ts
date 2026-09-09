import { useEffect } from 'react'

/**
 * The auth screens render outside AppLayout, which is where the theme class is
 * normally applied. Without this, a user who prefers dark mode gets a white
 * flash on the sign-in screen and a mismatched app after signing in.
 */
export function useAuthPageTheme(): void {
  useEffect(() => {
    const stored = localStorage.getItem('fern.theme')
    const dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  }, [])
}
