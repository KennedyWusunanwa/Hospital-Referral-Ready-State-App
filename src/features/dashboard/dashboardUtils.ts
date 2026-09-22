/**
 * Shared helpers for the dashboard panels.
 *
 * Every panel fetches its own data so one slow request never blocks the rest of
 * the page. These helpers keep the derived inputs identical between panels, so
 * panels that ask for the same window still share a single query cache entry.
 */

import { getZonedParts } from '@/domain/shifts'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Start of the rolling 7-day window, snapped down to the hour. Snapping is what
 * makes the timestamp stable enough to sit inside a query key without
 * refetching on every render.
 */
export function weekStartIso(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - 7 * DAY_MS).toISOString()
}

/** Greeting judged in the hospital's timezone, not the viewer's. */
export function greetingFor(now: Date, timeZone: string): string {
  const { hour } = getZonedParts(now, timeZone)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Titles are stripped before picking a first name. Clinical staff overwhelmingly
 * register as "Dr. Ama Boateng" or "Matron Grace Adjei", and greeting someone as
 * "Good morning, Dr." reads as a bug to the person it is addressing.
 */
const HONORIFICS = new Set([
  'dr',
  'drs',
  'prof',
  'professor',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'sr',
  'sister',
  'matron',
  'nurse',
  'midwife',
  'pharm',
  'rev',
])

export function firstNameOf(fullName: string | null | undefined): string {
  const tokens = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const name = tokens.find((token) => !HONORIFICS.has(token.replace(/\.$/, '').toLowerCase()))
  // A name that is *only* a title still beats greeting an empty string.
  return name || tokens[0] || 'there'
}

/** Whole minutes a referral has been waiting for a response. */
export function waitingMinutes(requestedAt: string, now: Date): number {
  const elapsed = (now.getTime() - new Date(requestedAt).getTime()) / 60_000
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0
}

export function shiftsOverdueLabel(shiftsSinceUpdate: number): string {
  if (!Number.isFinite(shiftsSinceUpdate)) return 'Never submitted'
  if (shiftsSinceUpdate <= 0) return 'Reported this shift'
  return `${shiftsSinceUpdate} shift${shiftsSinceUpdate === 1 ? '' : 's'} without an update`
}
