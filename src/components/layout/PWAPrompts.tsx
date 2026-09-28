/**
 * Install and update affordances for the installed app.
 *
 * Both are deliberately quiet: a clinician mid-referral must never have the
 * page reloaded under them, and an install banner that cannot be dismissed
 * permanently is worse than no banner at all. The install prompt itself is
 * captured at boot by `lib/installPrompt`, so the sidebar button and the
 * command palette can offer the same install on desktop and mobile alike.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, Share, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { APP_NAME } from '@/lib/constants'
import { useInstallPrompt } from '@/lib/installPrompt'

const DISMISS_KEY = 'fern.install-dismissed'
/** Re-offer the install a month after a dismissal rather than never again. */
const DISMISS_DAYS = 30
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000
/** Let the person settle on the first screen before offering anything. */
const OFFER_DELAY_MS = 8_000

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Blocked site data: showing the banner is the harmless direction to fail.
    return false
  }
}

/** Shared shell so the install and update banners sit in the same place. */
function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:inset-x-auto md:left-4 md:bottom-4 md:w-96 md:p-0 md:pb-0 lg:left-[17rem] no-print"
      role="region"
      aria-label="App notice"
    >
      <div className="card flex items-start gap-3 p-3 shadow-lg animate-fade-in">{children}</div>
    </div>
  )
}

export function PWAPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // A ward terminal can stay open for days, so poll rather than relying on
      // a navigation to discover a new build.
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL)
    },
  })

  const { canInstall, installed, needsManualInstall, install } = useInstallPrompt()
  const [installDismissed, setInstallDismissed] = useState(() => dismissedRecently())
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Not worth failing a render over; the banner simply returns next visit.
    }
  }, [])

  const onInstall = useCallback(async () => {
    const outcome = await install()
    if (outcome === 'dismissed') dismissInstall()
  }, [install, dismissInstall])

  // An available update outranks an install offer.
  if (needRefresh) {
    return (
      <Banner>
        <RefreshCw
          className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            A new version is ready
          </p>
          <p className="mt-0.5 hint">Reload when you are not mid-entry to pick up the changes.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void updateServiceWorker(true)}>
              Reload
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
              Later
            </Button>
          </div>
        </div>
      </Banner>
    )
  }

  if (installed || installDismissed || !settled) return null

  if (canInstall) {
    return (
      <Banner>
        <Download
          className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Install {APP_NAME}
          </p>
          <p className="mt-0.5 hint">
            Opens in its own window, starts faster and stays in your taskbar or home screen.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void onInstall()}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissInstall}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismissInstall}
          aria-label="Dismiss install prompt"
          className="tap-target grid shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </Banner>
    )
  }

  if (needsManualInstall) {
    return (
      <Banner>
        <Share className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Add {APP_NAME} to your Home Screen
          </p>
          <p className="mt-0.5 hint">
            Tap the Share button in Safari, then choose &ldquo;Add to Home Screen&rdquo;.
          </p>
        </div>
        <button
          type="button"
          onClick={dismissInstall}
          aria-label="Dismiss install instructions"
          className="tap-target grid shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </Banner>
    )
  }

  return null
}
