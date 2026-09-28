import { Toaster } from 'sonner'
import { useTheme } from '@/lib/theme'
import { useMediaQuery } from '@/lib/useMediaQuery'

/**
 * Sonner paints its own surface, so it needs the theme handed to it explicitly
 * -- it cannot read our class-based dark mode off the document. Toasts sit at
 * the bottom right on a desktop, where an incoming referral can wait to be
 * dealt with; on a phone the tab bar owns the bottom edge, so they drop in
 * from the top.
 */
export function AppToaster() {
  const { theme } = useTheme()
  const desktop = useMediaQuery('(min-width: 768px)')

  return (
    <Toaster
      position={desktop ? 'bottom-right' : 'top-center'}
      theme={theme}
      richColors
      closeButton
      visibleToasts={5}
      toastOptions={{ duration: 6000 }}
    />
  )
}
