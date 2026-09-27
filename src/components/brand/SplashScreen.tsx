import { Spinner } from '@/components/ui'
import { BrandLogo } from './BrandLogo'

/**
 * The full-screen wait shown before the shell exists: session check, profile
 * load, and the first download of a route outside the app layout. Branded, so
 * an installed app opening cold looks like itself from the first frame.
 */
export function SplashScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-slate-50 px-6 pt-[var(--titlebar-h)] dark:bg-slate-950"
    >
      <BrandLogo className="h-10 w-auto animate-fade-in" decorative />
      <Spinner className="h-6 w-6 text-brand-600 dark:text-brand-400" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}
