/**
 * Shape and normalisation of the `platform_stats()` payload. Pure, so the
 * console can be unit tested without a database.
 */

import type { Json } from '@/lib/database.types'

export interface DailyLogins {
  day: string
  logins: number
  uniqueUsers: number
}

export interface DailyReferrals {
  day: string
  created: number
  completed: number
}

export interface PlatformStats {
  generatedAt: string | null
  hospitals: {
    total: number
    active: number
    accepting: number
    onDiversion: number
    withLogo: number
    byRegion: Array<{ region: string; count: number }>
    byLevel: Record<string, number>
    readiness: { green: number; yellow: number; red: number; unconfigured: number }
  }
  departments: {
    total: number
    reporting: number
    green: number
    yellow: number
    red: number
    updates24h: number
  }
  users: {
    total: number
    active: number
    deactivated: number
    unattached: number
    neverSignedIn: number
    byRole: Record<string, number>
    signedIn24h: number
    signedIn7d: number
    signedIn30d: number
    pendingInvites: number
  }
  referrals: {
    last24h: number
    last7d: number
    last30d: number
    allTime: number
    pending: number
    pendingOverdue: number
    inTransit: number
    accepted7d: number
    declined7d: number
    completed7d: number
    avgResponseSeconds7d: number | null
  }
  activity: {
    auditEvents24h: number
    messages24h: number
    notifications24h: number
    unreadNotifications: number
    logins24h: number
    failedLogins24h: number
  }
  loginsDaily: DailyLogins[]
  referralsDaily: DailyReferrals[]
}

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : {}
}

function num(source: Rec, key: string): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNum(source: Rec, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, count] of Object.entries(rec(value))) {
    if (typeof count === 'number' && Number.isFinite(count)) out[key] = count
  }
  return out
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** The RPC hands back loosely typed JSON; every field gets a safe default. */
export function normalisePlatformStats(raw: Json | null): PlatformStats {
  const root = rec(raw)
  const hospitals = rec(root.hospitals)
  const readiness = rec(hospitals.readiness)
  const departments = rec(root.departments)
  const users = rec(root.users)
  const referrals = rec(root.referrals)
  const activity = rec(root.activity)

  return {
    generatedAt: typeof root.generated_at === 'string' ? root.generated_at : null,
    hospitals: {
      total: num(hospitals, 'total'),
      active: num(hospitals, 'active'),
      accepting: num(hospitals, 'accepting'),
      onDiversion: num(hospitals, 'on_diversion'),
      withLogo: num(hospitals, 'with_logo'),
      byRegion: (Array.isArray(hospitals.by_region) ? hospitals.by_region : []).map((entry) => {
        const row = rec(entry)
        return { region: text(row.region, 'Unspecified'), count: num(row, 'count') }
      }),
      byLevel: counts(hospitals.by_level),
      readiness: {
        green: num(readiness, 'green'),
        yellow: num(readiness, 'yellow'),
        red: num(readiness, 'red'),
        unconfigured: num(readiness, 'unconfigured'),
      },
    },
    departments: {
      total: num(departments, 'total'),
      reporting: num(departments, 'reporting'),
      green: num(departments, 'green'),
      yellow: num(departments, 'yellow'),
      red: num(departments, 'red'),
      updates24h: num(departments, 'updates_24h'),
    },
    users: {
      total: num(users, 'total'),
      active: num(users, 'active'),
      deactivated: num(users, 'deactivated'),
      unattached: num(users, 'unattached'),
      neverSignedIn: num(users, 'never_signed_in'),
      byRole: counts(users.by_role),
      signedIn24h: num(users, 'signed_in_24h'),
      signedIn7d: num(users, 'signed_in_7d'),
      signedIn30d: num(users, 'signed_in_30d'),
      pendingInvites: num(users, 'pending_invites'),
    },
    referrals: {
      last24h: num(referrals, 'last_24h'),
      last7d: num(referrals, 'last_7d'),
      last30d: num(referrals, 'last_30d'),
      allTime: num(referrals, 'all_time'),
      pending: num(referrals, 'pending'),
      pendingOverdue: num(referrals, 'pending_overdue'),
      inTransit: num(referrals, 'in_transit'),
      accepted7d: num(referrals, 'accepted_7d'),
      declined7d: num(referrals, 'declined_7d'),
      completed7d: num(referrals, 'completed_7d'),
      avgResponseSeconds7d: nullableNum(referrals, 'avg_response_seconds_7d'),
    },
    activity: {
      auditEvents24h: num(activity, 'audit_events_24h'),
      messages24h: num(activity, 'messages_24h'),
      notifications24h: num(activity, 'notifications_24h'),
      unreadNotifications: num(activity, 'unread_notifications'),
      logins24h: num(activity, 'logins_24h'),
      failedLogins24h: num(activity, 'failed_logins_24h'),
    },
    loginsDaily: (Array.isArray(root.logins_daily) ? root.logins_daily : []).map((entry) => {
      const row = rec(entry)
      return {
        day: text(row.day),
        logins: num(row, 'logins'),
        uniqueUsers: num(row, 'unique_users'),
      }
    }),
    referralsDaily: (Array.isArray(root.referrals_daily) ? root.referrals_daily : []).map(
      (entry) => {
        const row = rec(entry)
        return {
          day: text(row.day),
          created: num(row, 'created'),
          completed: num(row, 'completed'),
        }
      },
    ),
  }
}
