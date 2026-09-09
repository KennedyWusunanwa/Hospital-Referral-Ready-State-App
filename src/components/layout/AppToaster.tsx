import { Toaster } from 'sonner'
import { useTheme } from '@/lib/theme'

/**
 * Sonner paints its own surface, so it needs the theme handed to it explicitly
 * -- it cannot read our class-based dark mode off the document.
 */
export function AppToaster() {
  const [theme] = useTheme()

  return (
    <Toaster
      position="top-right"
      theme={theme}
      richColors
      closeButton
      toastOptions={{ duration: 5000 }}
    />
  )
}
