import { describe, expect, it } from 'vitest'
import { normalisePlatformStats } from '@/features/console/platformStats'
import { describeUserAgent } from '@/lib/userAgent'
import { matchRank, matchesQuery } from '@/lib/textMatch'

describe('normalisePlatformStats', () => {
  it('fills every field with a safe default when the payload is empty', () => {
    const stats = normalisePlatformStats(null)
    expect(stats.hospitals.total).toBe(0)
    expect(stats.users.byRole).toEqual({})
    expect(stats.referrals.avgResponseSeconds7d).toBeNull()
    expect(stats.loginsDaily).toEqual([])
    expect(stats.generatedAt).toBeNull()
  })

  it('reads the snake_case payload into the typed shape', () => {
    const stats = normalisePlatformStats({
      generated_at: '2026-09-27T10:00:00Z',
      hospitals: {
        total: 12,
        active: 11,
        accepting: 9,
        on_diversion: 1,
        with_logo: 4,
        by_region: [{ region: 'Greater Accra', count: 6 }],
        by_level: { tertiary: 3 },
        readiness: { green: 5, yellow: 4, red: 2, unconfigured: 0 },
      },
      users: { active: 40, by_role: { super_admin: 2 }, signed_in_24h: 7 },
      referrals: { last_7d: 15, avg_response_seconds_7d: 420 },
      logins_daily: [{ day: '2026-09-26', logins: 9, unique_users: 6 }],
    })
    expect(stats.generatedAt).toBe('2026-09-27T10:00:00Z')
    expect(stats.hospitals.onDiversion).toBe(1)
    expect(stats.hospitals.byRegion).toEqual([{ region: 'Greater Accra', count: 6 }])
    expect(stats.hospitals.readiness.yellow).toBe(4)
    expect(stats.users.byRole.super_admin).toBe(2)
    expect(stats.users.signedIn24h).toBe(7)
    expect(stats.referrals.avgResponseSeconds7d).toBe(420)
    expect(stats.loginsDaily[0]).toEqual({ day: '2026-09-26', logins: 9, uniqueUsers: 6 })
  })

  it('drops non-numeric counts rather than propagating them', () => {
    const stats = normalisePlatformStats({ users: { by_role: { viewer: 'many', super_admin: 1 } } })
    expect(stats.users.byRole).toEqual({ super_admin: 1 })
  })
})

describe('describeUserAgent', () => {
  it('names the common browser and platform pairs', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
      ),
    ).toBe('Edge on Windows')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/127.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android')
  })

  it('never throws on an empty value', () => {
    expect(describeUserAgent(null)).toBe('Unknown device')
    expect(describeUserAgent('')).toBe('Unknown device')
  })
})

describe('text matching', () => {
  it('requires every token, in any order, ignoring case', () => {
    expect(matchesQuery('Korle-Bu Teaching Hospital KBTH Accra', 'accra korle')).toBe(true)
    expect(matchesQuery('Korle-Bu Teaching Hospital KBTH Accra', 'kumasi')).toBe(false)
    expect(matchesQuery('anything', '')).toBe(true)
  })

  it('ranks prefix matches ahead of word starts ahead of substrings', () => {
    expect(matchRank('Tema General Hospital', 'tem')).toBe(0)
    expect(matchRank('Tema General Hospital', 'gen')).toBe(1)
    expect(matchRank('Tema General Hospital', 'ospit')).toBe(2)
  })
})
