/**
 * The browser's "install this site as an app" offer, held in one place.
 *
 * Chromium fires `beforeinstallprompt` once, early, and only hands the prompt
 * to whoever caught it. Capturing it here at boot means the sidebar button,
 * the command palette and the install banner can all offer the same install,
 * on desktop (Chrome, Edge on Windows and macOS) as well as Android. iOS never
 * fires the event, so the app explains Add to Home Screen instead.
 */

import { useCallback, useEffect, useState } from 'react'

/** Chromium-only; not in lib.dom, so it is declared where it is used. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let captured = false
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    // iOS Safari predates the display-mode media query for home-screen apps.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Call once, as early as possible -- the event will not wait for React. */
export function captureInstallPrompt(): void {
  if (captured || typeof window === 'undefined') return
  captured = true

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-infobar from firing; the app offers the
    // install at a calmer moment and from more than one place.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function canInstall(): boolean {
  return deferred !== null
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred
  if (!event) return 'unavailable'
  await event.prompt()
  const { outcome } = await event.userChoice
  // The prompt can only be used once, whatever the person chose.
  deferred = null
  notify()
  return outcome
}

export interface InstallPromptState {
  /** True when the browser has offered an install prompt this session. */
  canInstall: boolean
  /** True when already running as an installed app. */
  installed: boolean
  /** iOS Safari: no prompt exists; explain Add to Home Screen instead. */
  needsManualInstall: boolean
  install: () => Promise<InstallOutcome>
}

export function useInstallPrompt(): InstallPromptState {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const install = useCallback(() => promptInstall(), [])
  const installed = isStandalone()

  return {
    canInstall: !installed && canInstall(),
    installed,
    needsManualInstall: !installed && !canInstall() && isIos(),
    install,
  }
}
