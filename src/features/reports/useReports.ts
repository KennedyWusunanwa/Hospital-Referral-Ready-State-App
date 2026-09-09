/**
 * Reporting reads. Every figure on the reports screen comes from one of the
 * three analytics RPCs -- aggregation stays in Postgres so the browser never
 * has to pull a period's worth of referral rows just to count them.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type {
  ComplianceRow,
  HospitalPerformanceRow,
  Json,
  ReferralAnalytics,
} from '@/lib/types'
import { isReferralAnalytics } from '@/lib/types'

export interface ReportRangeFilters {
  hospitalId?: string | null
  from?: string
  to?: string
}

export const EMPTY_ANALYTICS: ReferralAnalytics = {
  total: 0,
  by_status: {},
  by_urgency: {},
  by_emergency_type: [],
  acceptance_rate: 0,
  avg_response_seconds: null,
  median_response_seconds: null,
  avg_completion_minutes: null,
  daily: [],
  top_receiving: [],
  top_referring: [],
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toCountMap(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, count]) => [key, toNumber(count)]),
  )
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * The RPC hands back loosely typed JSON. Filling in every field here means the
 * page can render each tile without a chain of null guards, and a partially
 * populated response from an older database still renders rather than throwing.
 */
function normaliseAnalytics(value: Json | null): ReferralAnalytics {
  if (value === null || !isReferralAnalytics(value)) return EMPTY_ANALYTICS
  const raw = asRecord(value)

  const named = (entry: unknown) => {
    const row = asRecord(entry)
    return {
      hospital_id: toText(row.hospital_id),
      name: toText(row.name, 'Unknown'),
      count: toNumber(row.count),
    }
  }

  return {
    total: toNumber(raw.total),
    by_status: toCountMap(raw.by_status),
    by_urgency: toCountMap(raw.by_urgency),
    by_emergency_type: asArray(raw.by_emergency_type).map((entry) => {
      const row = asRecord(entry)
      const code = toText(row.code)
      return { code, name: toText(row.name, code || 'Unknown'), count: toNumber(row.count) }
    }),
    acceptance_rate: toNumber(raw.acceptance_rate),
    avg_response_seconds: toNullableNumber(raw.avg_response_seconds),
    median_response_seconds: toNullableNumber(raw.median_response_seconds),
    avg_completion_minutes: toNullableNumber(raw.avg_completion_minutes),
    daily: asArray(raw.daily).map((entry) => {
      const row = asRecord(entry)
      return {
        day: toText(row.day),
        created: toNumber(row.created),
        accepted: toNumber(row.accepted),
        completed: toNumber(row.completed),
      }
    }),
    top_receiving: asArray(raw.top_receiving).map(named),
    top_referring: asArray(raw.top_referring).map(named),
  }
}

export function useReferralAnalytics(f: ReportRangeFilters): UseQueryResult<ReferralAnalytics> {
  const hospitalId = f.hospitalId ?? null
  const from = f.from ?? null
  const to = f.to ?? null

  return useQuery({
    queryKey: queryKeys.reports.analytics({ hospitalId, from, to }),
    staleTime: 60_000,
    queryFn: async (): Promise<ReferralAnalytics> => {
      const { data, error } = await supabase.rpc('referral_analytics', {
        p_hospital_id: hospitalId,
        p_from: from,
        p_to: to,
      })
      if (error) throw new Error(humanizeSupabaseError(error))
      return normaliseAnalytics(data ?? null)
    },
  })
}

export function useHospitalPerformance(
  f: ReportRangeFilters,
): UseQueryResult<HospitalPerformanceRow[]> {
  const hospitalId = f.hospitalId ?? null
  const from = f.from ?? null
  const to = f.to ?? null

  return useQuery({
    queryKey: queryKeys.reports.performance({ hospitalId, from, to }),
    staleTime: 60_000,
    queryFn: async (): Promise<HospitalPerformanceRow[]> => {
      const { data, error } = await supabase.rpc('hospital_performance', {
        p_hospital_id: hospitalId,
        p_from: from,
        p_to: to,
      })
      if (error) throw new Error(humanizeSupabaseError(error))
      return data ?? []
    },
  })
}

export function useComplianceReport(f: {
  hospitalId?: string | null
  days?: number
}): UseQueryResult<ComplianceRow[]> {
  const hospitalId = f.hospitalId ?? null
  const days = f.days ?? 7

  return useQuery({
    queryKey: queryKeys.reports.compliance({ hospitalId, days }),
    staleTime: 60_000,
    queryFn: async (): Promise<ComplianceRow[]> => {
      const { data, error } = await supabase.rpc('compliance_report', {
        p_hospital_id: hospitalId,
        p_days: days,
      })
      if (error) throw new Error(humanizeSupabaseError(error))
      return data ?? []
    },
  })
}

// ---------------------------------------------------------------------------
// Export auditing
// ---------------------------------------------------------------------------

export type ReportKind = 'overview' | 'hospitals' | 'compliance'

export type AuditDetail = Record<string, string | number | boolean | null>

/**
 * Exporting aggregate data is a reportable event, but a failed audit write must
 * never cost the user the download they asked for -- so this resolves either way
 * and returns whether the trail was written.
 */
export async function logReportExport(kind: ReportKind, details: AuditDetail): Promise<boolean> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: 'report.export',
    p_entity_type: 'report',
    p_entity_id: null,
    p_details: { report: kind, ...details },
  })
  return !error
}

// ---------------------------------------------------------------------------
// Rate helpers
// ---------------------------------------------------------------------------

/**
 * Acceptance and compliance rates are expected as 0-100, matching
 * `domain/readiness.complianceRate`. A database that returns 0-1 fractions
 * would otherwise render every hospital as "0%", so the scale is inferred once
 * per column instead of per value -- a per-value guess would misread a genuine
 * 0.5% rate as 50%.
 */
export function percentScale(values: Array<number | null | undefined>): number {
  let max = 0
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  return max > 0 && max <= 1 ? 100 : 1
}

export function clampPercent(value: number | null | undefined, scale = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value * scale))
}
