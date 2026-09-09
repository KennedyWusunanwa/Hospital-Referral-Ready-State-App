/**
 * Shift arithmetic.
 *
 * Readiness is reported once per department per shift, and the traffic-light
 * status is a function of how many shift boundaries have passed since the last
 * submission. All of that arithmetic lives here, expressed against a hospital's
 * local timezone so that a facility three time zones away is still judged
 * against *its* shift calendar, not the viewer's.
 *
 * Everything in this module is pure: pass `now` explicitly and the result is
 * fully deterministic, which is what the unit tests rely on.
 */

import {
  DEFAULT_TIMEZONE,
  SHIFTS_PER_DAY,
  SHIFT_TYPES,
  SHIFT_WINDOWS,
  type ShiftType,
} from '@/lib/constants'

export interface ShiftRef {
  /** Calendar date on which the shift *started*, in the hospital's timezone. */
  shiftDate: string // YYYY-MM-DD
  shiftType: ShiftType
  /**
   * Monotonically increasing index. Consecutive shifts differ by exactly 1,
   * which is what makes staleness a subtraction.
   */
  index: number
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const MS_PER_DAY = 86_400_000

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    } catch {
      // An unknown IANA zone should degrade, not crash a dashboard.
      formatter = getFormatter('UTC')
    }
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** Wall-clock fields for an instant, as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)
    return found ? Number(found.value) : 0
  }
  // `en-GB` with hour12:false renders midnight as 24; normalise it to 0.
  const hour = read('hour') % 24
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  }
}

function toIsoDate(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

function daysSinceEpoch(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function shiftOrder(type: ShiftType): number {
  return SHIFT_TYPES.indexOf(type)
}

/**
 * Which shift an instant falls in.
 *
 * The night shift straddles midnight (23:00-07:00), and is attributed to the
 * calendar date on which it *started* -- so 02:00 on the 5th belongs to the
 * night shift of the 4th.
 */
export function getShiftAt(date: Date, timeZone: string = DEFAULT_TIMEZONE): ShiftRef {
  const { year, month, day, hour } = getZonedParts(date, timeZone)

  const morning = SHIFT_WINDOWS[0]
  const afternoon = SHIFT_WINDOWS[1]

  let shiftType: ShiftType
  let epochDay = daysSinceEpoch(year, month, day)

  if (hour >= morning.startHour && hour < morning.endHour) {
    shiftType = 'morning'
  } else if (hour >= afternoon.startHour && hour < afternoon.endHour) {
    shiftType = 'afternoon'
  } else {
    shiftType = 'night'
    // Hours before the morning shift belong to the previous day's night shift.
    if (hour < morning.startHour) epochDay -= 1
  }

  const startOfShiftDay = new Date(epochDay * MS_PER_DAY)
  const shiftDate = toIsoDate(
    startOfShiftDay.getUTCFullYear(),
    startOfShiftDay.getUTCMonth() + 1,
    startOfShiftDay.getUTCDate(),
  )

  return {
    shiftDate,
    shiftType,
    index: epochDay * SHIFTS_PER_DAY + shiftOrder(shiftType),
  }
}

/** The shift index for an already-recorded (shiftDate, shiftType) pair. */
export function shiftIndexOf(shiftDate: string, shiftType: ShiftType): number {
  const [year, month, day] = shiftDate.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return daysSinceEpoch(year, month, day) * SHIFTS_PER_DAY + shiftOrder(shiftType)
}

/**
 * How many shift boundaries have elapsed between an update and `now`.
 *
 * 0 means the update belongs to the shift currently running.
 * Returns `Infinity` when there is no update at all -- a facility that has
 * never reported is maximally stale, not freshly compliant.
 */
export function shiftsSince(
  lastUpdatedAt: string | Date | null | undefined,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  if (!lastUpdatedAt) return Number.POSITIVE_INFINITY
  const last = lastUpdatedAt instanceof Date ? lastUpdatedAt : new Date(lastUpdatedAt)
  if (Number.isNaN(last.getTime())) return Number.POSITIVE_INFINITY

  const current = getShiftAt(now, timeZone)
  const previous = getShiftAt(last, timeZone)
  return Math.max(0, current.index - previous.index)
}

/** Same as `shiftsSince`, but starting from a stored shift reference. */
export function shiftsSinceShift(
  shiftDate: string | null | undefined,
  shiftType: ShiftType | null | undefined,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  if (!shiftDate || !shiftType) return Number.POSITIVE_INFINITY
  const index = shiftIndexOf(shiftDate, shiftType)
  if (Number.isNaN(index)) return Number.POSITIVE_INFINITY
  return Math.max(0, getShiftAt(now, timeZone).index - index)
}

/** UTC instant at which the given shift starts. */
export function shiftStartInstant(
  shiftDate: string,
  shiftType: ShiftType,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const window = SHIFT_WINDOWS.find((w) => w.type === shiftType) ?? SHIFT_WINDOWS[0]
  const [year, month, day] = shiftDate.split('-').map(Number)

  // Guess the instant as if the zone were UTC, then correct by the offset that
  // the zone actually reports at that moment.
  const guess = Date.UTC(year, month - 1, day, window.startHour, 0, 0)
  const parts = getZonedParts(new Date(guess), timeZone)
  const asZoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const offsetMs = asZoned - guess
  return new Date(guess - offsetMs)
}

/** Minutes remaining in the shift that contains `now`. */
export function minutesLeftInShift(now: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const { hour, minute } = getZonedParts(now, timeZone)
  const current = getShiftAt(now, timeZone)
  const window = SHIFT_WINDOWS.find((w) => w.type === current.shiftType) ?? SHIFT_WINDOWS[0]

  const minutesIntoDay = hour * 60 + minute
  let endMinutes = window.endHour * 60
  // Night shift ends the following morning.
  if (window.endHour <= window.startHour) endMinutes += 24 * 60
  let position = minutesIntoDay
  if (current.shiftType === 'night' && hour < window.startHour) position += 24 * 60

  return Math.max(0, endMinutes - position)
}

/** The shift `n` positions before the one containing `now` (n = 1 -> previous). */
export function previousShift(
  now: Date,
  n = 1,
  timeZone: string = DEFAULT_TIMEZONE,
): ShiftRef {
  const current = getShiftAt(now, timeZone)
  return shiftFromIndex(current.index - n)
}

/** Inverse of `ShiftRef.index`. */
export function shiftFromIndex(index: number): ShiftRef {
  const epochDay = Math.floor(index / SHIFTS_PER_DAY)
  const order = ((index % SHIFTS_PER_DAY) + SHIFTS_PER_DAY) % SHIFTS_PER_DAY
  const date = new Date(epochDay * MS_PER_DAY)
  return {
    shiftDate: toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
    shiftType: SHIFT_TYPES[order],
    index,
  }
}

export function shiftLabel(ref: Pick<ShiftRef, 'shiftDate' | 'shiftType'>): string {
  const window = SHIFT_WINDOWS.find((w) => w.type === ref.shiftType)
  const name = window ? window.type : ref.shiftType
  return `${ref.shiftDate} - ${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

/** Number of shifts expected in a window of `days` days. */
export function expectedShiftsInDays(days: number): number {
  return Math.max(0, Math.round(days * SHIFTS_PER_DAY))
}
