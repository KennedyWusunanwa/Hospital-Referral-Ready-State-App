import { describe, expect, it } from 'vitest'
import {
  REFERRAL_RESPONSE_TARGET_MINUTES,
  ROLE_CAPABILITIES,
  USER_ROLES,
  type Capability,
  type UserRole,
} from '@/lib/constants'
import {
  can,
  canAny,
  formatDate,
  formatPercent,
  formatSeconds,
  groupBy,
  initials,
  isReferralOverdue,
  median,
  relativeTime,
  sum,
  telHref,
  toCsv,
  unique,
} from '@/lib/utils'

const ALL_CAPABILITIES: Capability[] = [
  'readiness:submit',
  'readiness:view',
  'referral:create',
  'referral:respond',
  'referral:view',
  'messaging:use',
  'reports:view',
  'reports:view_all',
  'admin:hospital',
  'admin:system',
  'audit:view',
]

describe('can', () => {
  it('agrees with the capability matrix for every role and capability', () => {
    for (const role of USER_ROLES) {
      const granted = ROLE_CAPABILITIES[role] as readonly string[]
      for (const capability of ALL_CAPABILITIES) {
        expect(can(role, capability)).toBe(granted.includes(capability))
      }
    }
  })

  it('gives the super admin everything', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can('super_admin', capability)).toBe(true)
    }
  })

  it('keeps system administration away from a hospital admin', () => {
    expect(can('hospital_admin', 'admin:hospital')).toBe(true)
    expect(can('hospital_admin', 'admin:system')).toBe(false)
    expect(can('hospital_admin', 'reports:view_all')).toBe(false)
  })

  it('limits a shift in-charge to readiness, viewing and messaging', () => {
    expect(can('shift_in_charge', 'readiness:submit')).toBe(true)
    expect(can('shift_in_charge', 'messaging:use')).toBe(true)
    expect(can('shift_in_charge', 'referral:create')).toBe(false)
    expect(can('shift_in_charge', 'reports:view')).toBe(false)
    expect(can('shift_in_charge', 'audit:view')).toBe(false)
  })

  it('lets a referral coordinator raise and answer referrals but not submit readiness', () => {
    expect(can('referral_coordinator', 'referral:create')).toBe(true)
    expect(can('referral_coordinator', 'referral:respond')).toBe(true)
    expect(can('referral_coordinator', 'readiness:submit')).toBe(false)
    expect(can('referral_coordinator', 'admin:hospital')).toBe(false)
  })

  it('keeps a viewer read-only', () => {
    expect(can('viewer', 'readiness:view')).toBe(true)
    expect(can('viewer', 'referral:view')).toBe(true)
    expect(can('viewer', 'reports:view')).toBe(true)
    expect(can('viewer', 'readiness:submit')).toBe(false)
    expect(can('viewer', 'referral:create')).toBe(false)
    expect(can('viewer', 'messaging:use')).toBe(false)
  })

  it('denies everything for an absent or unknown role', () => {
    expect(can(null, 'readiness:view')).toBe(false)
    expect(can(undefined, 'readiness:view')).toBe(false)
    expect(can('not_a_role' as UserRole, 'readiness:view')).toBe(false)
  })
})

describe('canAny', () => {
  it('is true when at least one capability is granted', () => {
    expect(canAny('viewer', ['admin:system', 'reports:view'])).toBe(true)
    expect(canAny('shift_in_charge', ['readiness:submit', 'admin:system'])).toBe(true)
  })

  it('is false when none is granted, or the list is empty', () => {
    expect(canAny('viewer', ['admin:system', 'admin:hospital'])).toBe(false)
    expect(canAny('viewer', [])).toBe(false)
    expect(canAny(null, ['reports:view'])).toBe(false)
  })
})

describe('toCsv', () => {
  it('emits a header row and CRLF line endings', () => {
    const csv = toCsv([
      { code: 'KBTH', beds: 12 },
      { code: 'KATH', beds: 7 },
    ])

    expect(csv).toBe('code,beds\r\nKBTH,12\r\nKATH,7')
  })

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('honours an explicit column list and order', () => {
    const csv = toCsv([{ a: 1, b: 2, c: 3 }], ['c', 'a'])
    expect(csv).toBe('c,a\r\n3,1')
  })

  it('renders missing and null cells as empty', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c', 'missing'])
    expect(csv).toBe('a,b,c,missing\r\n,,0,')
  })

  it('quotes cells containing commas, quotes or newlines', () => {
    const csv = toCsv([
      { note: 'Accra, Greater Accra' },
      { note: 'says "ready"' },
      { note: 'line one\nline two' },
      { note: 'carriage\rreturn' },
    ])

    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('note')
    expect(lines[1]).toBe('"Accra, Greater Accra"')
    expect(lines[2]).toBe('"says ""ready"""')
    expect(csv).toContain('"line one\nline two"')
    expect(csv).toContain('"carriage\rreturn"')
  })

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([
      { v: '=1+1' },
      { v: '+44 20 7946' },
      { v: '-12' },
      { v: '@user' },
      { v: '=SUM(A1,A2)' },
    ])

    const lines = csv.split('\r\n')
    expect(lines[1]).toBe("'=1+1")
    expect(lines[2]).toBe("'+44 20 7946")
    expect(lines[3]).toBe("'-12")
    expect(lines[4]).toBe("'@user")
    // The guard runs before quoting, so an escaped cell keeps both protections.
    expect(lines[5]).toBe('"\'=SUM(A1,A2)"')
  })

  it('applies the same guard to header names', () => {
    expect(toCsv([{ '=total': 1 }])).toBe("'=total\r\n1")
  })
})

describe('median', () => {
  it('is the middle value for an odd-length list', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([42])).toBe(42)
  })

  it('is the mean of the middle pair for an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([10, 20])).toBe(15)
  })

  it('sorts numerically, not lexically', () => {
    expect(median([100, 9, 80])).toBe(80)
  })

  it('is null for an empty list, and ignores non-finite values', () => {
    expect(median([])).toBeNull()
    expect(median([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull()
    expect(median([Number.NaN, 4, 2, 6])).toBe(4)
  })
})

describe('formatSeconds', () => {
  it('uses seconds below a minute', () => {
    expect(formatSeconds(0)).toBe('0 s')
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatSeconds(59.4)).toBe('59 s')
    // Rounds first, so 59.6 s crosses the minute boundary.
    expect(formatSeconds(59.6)).toBe('1 m 00 s')
  })

  it('uses minutes and zero-padded seconds below an hour', () => {
    expect(formatSeconds(60)).toBe('1 m 00 s')
    expect(formatSeconds(252)).toBe('4 m 12 s')
    expect(formatSeconds(3599)).toBe('59 m 59 s')
  })

  it('uses hours and zero-padded minutes above', () => {
    expect(formatSeconds(3600)).toBe('1 h 00 m')
    expect(formatSeconds(3900)).toBe('1 h 05 m')
    expect(formatSeconds(7380)).toBe('2 h 03 m')
  })

  it('clamps a negative value and dashes out missing input', () => {
    expect(formatSeconds(-30)).toBe('0 s')
    expect(formatSeconds(null)).toBe('-')
    expect(formatSeconds(undefined)).toBe('-')
    expect(formatSeconds(Number.NaN)).toBe('-')
  })
})

describe('formatPercent', () => {
  it('renders with the requested precision', () => {
    expect(formatPercent(87)).toBe('87%')
    expect(formatPercent(87.456, 1)).toBe('87.5%')
    expect(formatPercent(0)).toBe('0%')
  })

  it('dashes out missing input', () => {
    expect(formatPercent(null)).toBe('-')
    expect(formatPercent(undefined)).toBe('-')
    expect(formatPercent(Number.NaN)).toBe('-')
  })
})

describe('relativeTime', () => {
  const now = new Date('2025-06-15T12:00:00Z')

  it('collapses the last 45 seconds to "just now"', () => {
    expect(relativeTime('2025-06-15T12:00:00Z', now)).toBe('just now')
    expect(relativeTime('2025-06-15T11:59:16Z', now)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(relativeTime('2025-06-15T11:48:00Z', now)).toBe('12 min ago')
    expect(relativeTime('2025-06-15T09:00:00Z', now)).toBe('3 h ago')
    expect(relativeTime('2025-06-10T12:00:00Z', now)).toBe('5 d ago')
  })

  it('handles a future timestamp', () => {
    expect(relativeTime('2025-06-15T12:00:20Z', now)).toBe('shortly')
    expect(relativeTime('2025-06-15T12:30:00Z', now)).toBe('in 30 min')
    expect(relativeTime('2025-06-15T14:00:00Z', now)).toBe('in 2 h')
  })

  it('falls back to an absolute date beyond thirty days', () => {
    const old = '2025-01-05T12:00:00Z'
    expect(relativeTime(old, now)).toBe(formatDate(old))
    expect(relativeTime(old, now)).toContain('2025')
  })

  it('says "never" for a missing or unparseable value', () => {
    expect(relativeTime(null, now)).toBe('never')
    expect(relativeTime(undefined, now)).toBe('never')
    expect(relativeTime('not a date', now)).toBe('never')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(relativeTime(new Date('2025-06-15T11:00:00Z'), now)).toBe('1 h ago')
  })
})

describe('initials', () => {
  it('takes the first and last initial of a full name', () => {
    expect(initials('Ama Serwaa Boateng')).toBe('AB')
    expect(initials('Kwame Nkrumah')).toBe('KN')
  })

  it('takes two letters from a single name', () => {
    expect(initials('Ama')).toBe('AM')
    expect(initials('yaw')).toBe('YA')
  })

  it('tolerates messy whitespace', () => {
    expect(initials('  Ama   Boateng  ')).toBe('AB')
  })

  it('falls back to a question mark for nothing usable', () => {
    expect(initials(null)).toBe('?')
    expect(initials(undefined)).toBe('?')
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('telHref', () => {
  it('strips formatting but keeps a leading plus', () => {
    expect(telHref('+233 (0)30 268 1000')).toBe('tel:+2330302681000')
    expect(telHref('030-268-1000')).toBe('tel:0302681000')
    expect(telHref('0302 681000 ext. 12')).toBe('tel:030268100012')
  })

  it('rejects a number too short to dial', () => {
    expect(telHref('1234')).toBeUndefined()
    expect(telHref('n/a')).toBeUndefined()
    expect(telHref('12345')).toBe('tel:12345')
  })

  it('returns undefined for a missing number', () => {
    expect(telHref(null)).toBeUndefined()
    expect(telHref(undefined)).toBeUndefined()
    expect(telHref('')).toBeUndefined()
  })
})

describe('isReferralOverdue', () => {
  const now = new Date('2025-06-15T12:00:00Z')

  it('is false inside the response target', () => {
    expect(REFERRAL_RESPONSE_TARGET_MINUTES).toBe(15)
    expect(isReferralOverdue('2025-06-15T11:50:00Z', now)).toBe(false)
    expect(isReferralOverdue('2025-06-15T11:45:00Z', now)).toBe(false) // exactly on target
  })

  it('is true once the target is passed', () => {
    expect(isReferralOverdue('2025-06-15T11:44:00Z', now)).toBe(true)
    expect(isReferralOverdue('2025-06-15T09:00:00Z', now)).toBe(true)
  })

  it('is false for a request timestamped in the future', () => {
    expect(isReferralOverdue('2025-06-15T12:30:00Z', now)).toBe(false)
  })
})

describe('groupBy', () => {
  const rows = [
    { hospital: 'KBTH', status: 'green' },
    { hospital: 'KATH', status: 'red' },
    { hospital: 'KBTH', status: 'yellow' },
  ]

  it('buckets items by the derived key, preserving order', () => {
    const grouped = groupBy(rows, (row) => row.hospital)

    expect(Object.keys(grouped).sort()).toEqual(['KATH', 'KBTH'])
    expect(grouped.KBTH).toHaveLength(2)
    expect(grouped.KBTH.map((row) => row.status)).toEqual(['green', 'yellow'])
    expect(grouped.KATH).toHaveLength(1)
  })

  it('returns an empty object for an empty list', () => {
    expect(groupBy([] as Array<{ id: string }>, (row) => row.id)).toEqual({})
  })

  it('supports numeric keys', () => {
    const grouped = groupBy([1, 2, 3, 4], (n) => n % 2)
    expect(grouped[0]).toEqual([2, 4])
    expect(grouped[1]).toEqual([1, 3])
  })
})

describe('sum', () => {
  it('adds the numbers it is given', () => {
    expect(sum([1, 2, 3])).toBe(6)
    expect(sum([])).toBe(0)
    expect(sum([-4, 4])).toBe(0)
  })

  it('treats null and undefined as zero', () => {
    expect(sum([1, null, 2, undefined, 3])).toBe(6)
    expect(sum([null, undefined])).toBe(0)
  })
})

describe('unique', () => {
  it('removes duplicates, keeping first-seen order', () => {
    expect(unique(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    expect(unique([1, 1, 1])).toEqual([1])
    expect(unique([])).toEqual([])
  })
})
