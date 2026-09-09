import { describe, expect, it } from 'vitest'
import { SHIFTS_PER_DAY, SHIFT_TYPES } from '@/lib/constants'
import {
  expectedShiftsInDays,
  getShiftAt,
  getZonedParts,
  minutesLeftInShift,
  previousShift,
  shiftFromIndex,
  shiftIndexOf,
  shiftLabel,
  shiftStartInstant,
  shiftsSince,
  shiftsSinceShift,
} from '@/domain/shifts'

/** Africa/Accra is UTC+0 all year, so a UTC instant reads as the local clock. */
const TZ = 'Africa/Accra'

const at = (iso: string) => new Date(iso)

describe('getShiftAt', () => {
  it('maps each window to the right shift type', () => {
    expect(getShiftAt(at('2025-06-15T07:00:00Z'), TZ).shiftType).toBe('morning')
    expect(getShiftAt(at('2025-06-15T11:30:00Z'), TZ).shiftType).toBe('morning')
    expect(getShiftAt(at('2025-06-15T14:59:59Z'), TZ).shiftType).toBe('morning')

    expect(getShiftAt(at('2025-06-15T15:00:00Z'), TZ).shiftType).toBe('afternoon')
    expect(getShiftAt(at('2025-06-15T19:00:00Z'), TZ).shiftType).toBe('afternoon')
    expect(getShiftAt(at('2025-06-15T22:59:59Z'), TZ).shiftType).toBe('afternoon')

    expect(getShiftAt(at('2025-06-15T23:00:00Z'), TZ).shiftType).toBe('night')
    expect(getShiftAt(at('2025-06-16T03:00:00Z'), TZ).shiftType).toBe('night')
    expect(getShiftAt(at('2025-06-16T06:59:59Z'), TZ).shiftType).toBe('night')
  })

  it('treats each window boundary as an inclusive start', () => {
    // 06:59 still belongs to the night shift that began the previous evening.
    expect(getShiftAt(at('2025-06-15T06:59:00Z'), TZ)).toMatchObject({
      shiftType: 'night',
      shiftDate: '2025-06-14',
    })
    expect(getShiftAt(at('2025-06-15T07:00:00Z'), TZ)).toMatchObject({
      shiftType: 'morning',
      shiftDate: '2025-06-15',
    })
    expect(getShiftAt(at('2025-06-15T15:00:00Z'), TZ)).toMatchObject({
      shiftType: 'afternoon',
      shiftDate: '2025-06-15',
    })
    expect(getShiftAt(at('2025-06-15T23:00:00Z'), TZ)).toMatchObject({
      shiftType: 'night',
      shiftDate: '2025-06-15',
    })
  })

  it('attributes the night shift to the date it started', () => {
    const lateEvening = getShiftAt(at('2025-06-04T23:30:00Z'), TZ)
    const earlyMorning = getShiftAt(at('2025-06-05T02:00:00Z'), TZ)

    expect(earlyMorning.shiftDate).toBe('2025-06-04')
    expect(earlyMorning.shiftType).toBe('night')
    // 02:00 on the 5th is the *same* shift as 23:30 on the 4th.
    expect(earlyMorning.index).toBe(lateEvening.index)
  })

  it('agrees with shiftIndexOf', () => {
    for (const iso of [
      '2025-06-15T08:00:00Z',
      '2025-06-15T16:00:00Z',
      '2025-06-15T23:10:00Z',
      '2025-06-16T04:00:00Z',
    ]) {
      const ref = getShiftAt(at(iso), TZ)
      expect(shiftIndexOf(ref.shiftDate, ref.shiftType)).toBe(ref.index)
    }
  })

  it('returns NaN for an unparseable shift date', () => {
    expect(Number.isNaN(shiftIndexOf('not-a-date', 'morning'))).toBe(true)
  })
})

describe('shift index monotonicity', () => {
  const indexAt = (iso: string) => getShiftAt(at(iso), TZ).index

  it('increments by exactly 1 between consecutive shifts', () => {
    const sequence = [
      '2025-06-15T08:00:00Z', // morning 15th
      '2025-06-15T16:00:00Z', // afternoon 15th
      '2025-06-15T23:30:00Z', // night 15th
      '2025-06-16T08:00:00Z', // morning 16th
      '2025-06-16T16:00:00Z', // afternoon 16th
    ].map(indexAt)

    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i] - sequence[i - 1]).toBe(1)
    }
  })

  it('stays monotonic across a month boundary', () => {
    expect(indexAt('2025-07-01T08:00:00Z') - indexAt('2025-06-30T23:30:00Z')).toBe(1)
    expect(indexAt('2025-07-01T08:00:00Z')).toBeGreaterThan(indexAt('2025-06-30T08:00:00Z'))
  })

  it('stays monotonic across a year boundary', () => {
    expect(indexAt('2026-01-01T08:00:00Z') - indexAt('2025-12-31T23:30:00Z')).toBe(1)
    // 02:00 on 1 Jan is still the night shift of 31 Dec.
    expect(indexAt('2026-01-01T02:00:00Z')).toBe(indexAt('2025-12-31T23:30:00Z'))
  })

  it('advances by SHIFTS_PER_DAY over a full day', () => {
    expect(indexAt('2025-06-16T08:00:00Z') - indexAt('2025-06-15T08:00:00Z')).toBe(SHIFTS_PER_DAY)
  })
})

describe('shiftsSince', () => {
  const now = at('2025-06-15T10:00:00Z') // morning of the 15th

  it('is 0 within the same shift', () => {
    expect(shiftsSince('2025-06-15T07:05:00Z', now, TZ)).toBe(0)
    expect(shiftsSince(at('2025-06-15T09:59:00Z'), now, TZ)).toBe(0)
  })

  it('is 1 across a single boundary', () => {
    // Night shift of the 14th, which ended at 07:00 on the 15th.
    expect(shiftsSince('2025-06-15T02:00:00Z', now, TZ)).toBe(1)
    expect(shiftsSince('2025-06-14T23:30:00Z', now, TZ)).toBe(1)
  })

  it('is 3 a full day earlier', () => {
    expect(shiftsSince('2025-06-14T10:00:00Z', now, TZ)).toBe(3)
  })

  it('never goes negative for a future timestamp', () => {
    expect(shiftsSince('2025-06-16T10:00:00Z', now, TZ)).toBe(0)
  })

  it('is Infinity for a missing or unparseable timestamp', () => {
    expect(shiftsSince(null, now, TZ)).toBe(Number.POSITIVE_INFINITY)
    expect(shiftsSince(undefined, now, TZ)).toBe(Number.POSITIVE_INFINITY)
    expect(shiftsSince('', now, TZ)).toBe(Number.POSITIVE_INFINITY)
    expect(shiftsSince('rubbish', now, TZ)).toBe(Number.POSITIVE_INFINITY)
  })

  it('genuinely depends on the timezone', () => {
    const instant = at('2025-06-15T20:00:00Z')

    const accra = getShiftAt(instant, 'Africa/Accra')
    const auckland = getShiftAt(instant, 'Pacific/Auckland')

    // 20:00 in Accra (UTC+0) is the afternoon shift of the 15th; the same
    // instant in Auckland (UTC+12 in June) is 08:00 on the 16th.
    expect(accra).toMatchObject({ shiftDate: '2025-06-15', shiftType: 'afternoon' })
    expect(auckland).toMatchObject({ shiftDate: '2025-06-16', shiftType: 'morning' })
    expect(auckland.index).not.toBe(accra.index)

    // The same pair of instants is two shifts apart in Accra (night of the
    // 14th -> afternoon of the 15th) but three in Auckland (morning -> night).
    const lastUpdate = '2025-06-15T02:00:00Z'
    expect(shiftsSince(lastUpdate, instant, 'Africa/Accra')).toBe(2)
    expect(shiftsSince(lastUpdate, instant, 'Pacific/Auckland')).toBe(3)
  })
})

describe('shiftsSinceShift', () => {
  const now = at('2025-06-15T10:00:00Z')

  it('counts from a stored shift reference', () => {
    expect(shiftsSinceShift('2025-06-15', 'morning', now, TZ)).toBe(0)
    expect(shiftsSinceShift('2025-06-14', 'night', now, TZ)).toBe(1)
    expect(shiftsSinceShift('2025-06-14', 'morning', now, TZ)).toBe(3)
  })

  it('is Infinity when either half of the reference is missing', () => {
    expect(shiftsSinceShift(null, 'morning', now, TZ)).toBe(Number.POSITIVE_INFINITY)
    expect(shiftsSinceShift('2025-06-15', null, now, TZ)).toBe(Number.POSITIVE_INFINITY)
    expect(shiftsSinceShift('nonsense', 'morning', now, TZ)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('minutesLeftInShift', () => {
  it('is a full 480 minutes at the start of each window', () => {
    expect(minutesLeftInShift(at('2025-06-15T07:00:00Z'), TZ)).toBe(480)
    expect(minutesLeftInShift(at('2025-06-15T15:00:00Z'), TZ)).toBe(480)
    expect(minutesLeftInShift(at('2025-06-15T23:00:00Z'), TZ)).toBe(480)
  })

  it('halves in the middle of each window', () => {
    expect(minutesLeftInShift(at('2025-06-15T11:00:00Z'), TZ)).toBe(240)
    expect(minutesLeftInShift(at('2025-06-15T19:00:00Z'), TZ)).toBe(240)
    expect(minutesLeftInShift(at('2025-06-16T03:00:00Z'), TZ)).toBe(240)
  })

  it('runs down to 1 minute at the end of each window', () => {
    expect(minutesLeftInShift(at('2025-06-15T14:59:00Z'), TZ)).toBe(1)
    expect(minutesLeftInShift(at('2025-06-15T22:59:00Z'), TZ)).toBe(1)
    expect(minutesLeftInShift(at('2025-06-16T06:59:00Z'), TZ)).toBe(1)
  })

  it('stays within one shift length at every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const iso = '2025-06-15T' + String(hour).padStart(2, '0') + ':30:00Z'
      const left = minutesLeftInShift(at(iso), TZ)
      expect(left).toBeGreaterThan(0)
      expect(left).toBeLessThanOrEqual(480)
    }
  })
})

describe('shiftFromIndex', () => {
  it('round-trips getShiftAt', () => {
    for (const iso of [
      '2025-01-01T08:00:00Z',
      '2025-06-15T16:00:00Z',
      '2025-12-31T23:30:00Z',
      '2026-01-01T05:00:00Z',
    ]) {
      const ref = getShiftAt(at(iso), TZ)
      expect(shiftFromIndex(ref.index)).toEqual(ref)
    }
  })

  it('walks backwards through the shift types', () => {
    const morning = getShiftAt(at('2025-06-15T08:00:00Z'), TZ)
    expect(shiftFromIndex(morning.index - 1)).toMatchObject({
      shiftDate: '2025-06-14',
      shiftType: 'night',
    })
    expect(shiftFromIndex(morning.index - 2)).toMatchObject({
      shiftDate: '2025-06-14',
      shiftType: 'afternoon',
    })
    expect(shiftFromIndex(morning.index - 3)).toMatchObject({
      shiftDate: '2025-06-14',
      shiftType: 'morning',
    })
  })
})

describe('previousShift', () => {
  it('steps back n shifts from the shift containing now', () => {
    const now = at('2025-06-15T10:00:00Z')
    expect(previousShift(now, 1, TZ)).toMatchObject({
      shiftDate: '2025-06-14',
      shiftType: 'night',
    })
    expect(previousShift(now, 3, TZ)).toMatchObject({
      shiftDate: '2025-06-14',
      shiftType: 'morning',
    })
    expect(previousShift(now, 0, TZ)).toEqual(getShiftAt(now, TZ))
  })
})

describe('shiftStartInstant', () => {
  it('resolves the UTC instant a shift begins in a zero-offset zone', () => {
    expect(shiftStartInstant('2025-06-15', 'morning', TZ).toISOString()).toBe(
      '2025-06-15T07:00:00.000Z',
    )
    expect(shiftStartInstant('2025-06-15', 'afternoon', TZ).toISOString()).toBe(
      '2025-06-15T15:00:00.000Z',
    )
    expect(shiftStartInstant('2025-06-15', 'night', TZ).toISOString()).toBe(
      '2025-06-15T23:00:00.000Z',
    )
  })

  it('accounts for a non-zero offset', () => {
    // 07:00 local in Auckland (UTC+12 in June) is 19:00 UTC the day before.
    expect(shiftStartInstant('2025-06-15', 'morning', 'Pacific/Auckland').toISOString()).toBe(
      '2025-06-14T19:00:00.000Z',
    )
  })

  it('lands inside the shift it names', () => {
    for (const type of SHIFT_TYPES) {
      const instant = shiftStartInstant('2025-06-15', type, TZ)
      expect(getShiftAt(instant, TZ)).toMatchObject({ shiftDate: '2025-06-15', shiftType: type })
    }
  })
})

describe('getZonedParts', () => {
  it('normalises midnight to hour 0', () => {
    expect(getZonedParts(at('2025-06-15T00:00:00Z'), TZ)).toEqual({
      year: 2025,
      month: 6,
      day: 15,
      hour: 0,
      minute: 0,
    })
  })

  it('falls back to UTC for an unknown zone rather than throwing', () => {
    expect(getZonedParts(at('2025-06-15T13:45:00Z'), 'Not/AZone')).toEqual({
      year: 2025,
      month: 6,
      day: 15,
      hour: 13,
      minute: 45,
    })
  })
})

describe('labels and expectations', () => {
  it('renders a human shift label', () => {
    expect(shiftLabel({ shiftDate: '2025-06-15', shiftType: 'morning' })).toBe(
      '2025-06-15 - Morning',
    )
    expect(shiftLabel({ shiftDate: '2025-06-15', shiftType: 'night' })).toBe('2025-06-15 - Night')
  })

  it('expects three shifts per day', () => {
    expect(expectedShiftsInDays(1)).toBe(SHIFTS_PER_DAY)
    expect(expectedShiftsInDays(7)).toBe(21)
    expect(expectedShiftsInDays(0)).toBe(0)
    expect(expectedShiftsInDays(-4)).toBe(0)
  })
})
