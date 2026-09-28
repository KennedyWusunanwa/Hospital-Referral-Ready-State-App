/**
 * A short two-tone chime for arrivals that need a person now: an incoming
 * referral, a critical alert. Synthesised with the Web Audio API so there is
 * no asset to load or cache, and switchable per device from the sidebar.
 *
 * Browsers only let audio start after the person has interacted with the
 * page, so the first chime of a session may be silent; every one after a
 * click or a key press plays.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'fern.alert-sound'
const listeners = new Set<(enabled: boolean) => void>()
let context: AudioContext | null = null

export function isAlertSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAlertSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Not worth failing over; the choice simply does not persist.
  }
  listeners.forEach((listener) => listener(enabled))
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!context) context = new Ctor()
  return context
}

/** Plays the chime if sound is enabled and the browser allows it. Never throws. */
export function playAlertChime(kind: 'incoming' | 'critical' = 'incoming'): void {
  if (!isAlertSoundEnabled()) return
  try {
    const ctx = getContext()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

    const now = ctx.currentTime
    const notes = kind === 'critical' ? [880, 660, 880, 660] : [660, 880]
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = now + index * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.18)
    })
  } catch {
    // Autoplay policy or no audio device: the toast still shows.
  }
}

export function useAlertSound(): { enabled: boolean; setEnabled: (enabled: boolean) => void } {
  const [enabled, setState] = useState(() => isAlertSoundEnabled())

  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  const setEnabled = useCallback((next: boolean) => setAlertSoundEnabled(next), [])
  return { enabled, setEnabled }
}
