/**
 * Install and update affordances for the installed app.
 *
 * Both are deliberately quiet: a clinician mid-referral must never have the
 * page reloaded under them, and an install banner that cannot be dismissed
 * permanently is worse than no banner at all.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Download, RefreshCw, Share, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { APP_NAME } from '@/lib/constants'

const DISMISS_KEY = 'fern.install-dismissed'
/** Re-offer the install a month after a dismissal rather than never again. */
const DISMISS_DAYS = 30
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000

/** Chromium-only; not in lib.dom, so it is declared where it is used. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode media query for home-screen apps.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

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
      className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-4 md:bottom-4 md:w-96 md:p-0 md:pb-0 no-print"
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

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [installDismissed, setInstallDismissed] = useState(false)

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return

    const onBeforeInstall = (event: Event) => {
      // Keep the browser's own mini-infobar from firing; we offer the install
      // at a calmer moment instead.
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    const onInstalled = () => setInstallEvent(null)
    window.addEventListener('appinstalled', onInstalled)

    // iOS never fires beforeinstallprompt, so Add to Home Screen has to be
    // explained rather than triggered.
    if (isIos()) setShowIosHint(true)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Not worth failing a render over; the banner simply returns next visit.
    }
  }, [])

  const install = useCallback(async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    setInstallEvent(null)
    if (outcome === 'dismissed') dismissInstall()
  }, [installEvent, dismissInstall])

  // An available update outranks an install offer.
  if (needRefresh) {
    return (
      <Banner>
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
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

  if (installDismissed) return null

  if (installEvent) {
    return (
      <Banner>
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Install {APP_NAME}
          </p>
          <p className="mt-0.5 hint">
            Add it to your device for full-screen access and faster start-up.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void install()}>
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

  if (showIosHint) {
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
