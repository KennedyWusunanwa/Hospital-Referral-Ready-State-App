/**
 * What a system administrator sees instead of a hospital dashboard.
 *
 * They have no shift, no department and no inbox of their own, so the useful
 * questions are network-wide: how much is moving, and which facilities are
 * falling behind on readiness updates.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import { Building2, CheckCircle2, ClipboardList, Hourglass, Timer } from 'lucide-react'
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Meter,
  Skeleton,
  Stat,
} from '@/components/ui'
import type { ComplianceRow } from '@/lib/types'
import { formatPercent, formatSeconds, relativeTime } from '@/lib/utils'
import { useHospitals } from '@/features/hospitals/useHospitals'
import { useReferrals } from '@/features/referrals/useReferrals'
import { useComplianceReport, useReferralAnalytics } from '@/features/reports/useReports'
import { weekStartIso } from './dashboardUtils'

const WORST_COMPLIANCE_LIMIT = 6

interface HospitalCompliance {
  hospitalId: string
  name: string
  rate: number
  missedShifts: number
  departments: number
  lastSubmittedAt: string | null
}

/**
 * `compliance_report` is per department; a hospital's rate is the pooled ratio
 * of updates made to updates expected, not an average of averages, so a large
 * department cannot be hidden behind several tiny compliant ones.
 */
function byHospital(rows: ComplianceRow[]): HospitalCompliance[] {
  const totals = new Map<
    string,
    { name: string; expected: number; actual: number; missed: number; departments: number; last: string | null }
  >()

  for (const row of rows) {
    const entry = totals.get(row.hospital_id) ?? {
      name: row.hospital_name,
      expected: 0,
      actual: 0,
      missed: 0,
      departments: 0,
      last: null as string | null,
    }
    entry.expected += row.expected_updates
    entry.actual += row.actual_updates
    entry.missed += row.missed_shifts
    entry.departments += 1
    if (row.last_submitted_at && (!entry.last || row.last_submitted_at > entry.last)) {
      entry.last = row.last_submitted_at
    }
    totals.set(row.hospital_id, entry)
  }

  return [...totals.entries()]
    .map(([hospitalId, entry]) => ({
      hospitalId,
      name: entry.name,
      rate: entry.expected > 0 ? (entry.actual / entry.expected) * 100 : 0,
      missedShifts: entry.missed,
      departments: entry.departments,
      lastSubmittedAt: entry.last,
    }))
    .sort((a, b) => a.rate - b.rate || b.missedShifts - a.missedShifts)
}

function statValue<T>(query: UseQueryResult<T>, render: (data: T) => ReactNode): ReactNode {
  if (query.data === undefined) {
    return query.isError ? '-' : <Skeleton className="h-7 w-16" />
  }
  return render(query.data)
}

function complianceTone(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 90) return 'success'
  if (rate >= 60) return 'warning'
  return 'danger'
}

export function NetworkOverview({ now }: { now: Date }) {
  const from = useMemo(() => weekStartIso(), [])

  const hospitals = useHospitals({ onlyActive: true })
  const analytics = useReferralAnalytics({ hospitalId: null, from })
  const compliance = useComplianceReport({ hospitalId: null, days: 7 })
  const pending = useReferrals({ hospitalId: null, direction: 'all', status: ['pending'] })

  const worst = useMemo(
    () => byHospital(compliance.data ?? []).slice(0, WORST_COMPLIANCE_LIMIT),
    [compliance.data],
  )

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active hospitals"
          icon={<Building2 className="h-4 w-4" aria-hidden />}
          value={statValue(hospitals, (rows) => rows.length)}
          sublabel={
            hospitals.data
              ? `${hospitals.data.filter((hospital) => hospital.accepts_referrals).length} accepting referrals`
              : undefined
          }
        />
        <Stat
          label="Referrals (7 days)"
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          value={statValue(analytics, (data) => data.total)}
          sublabel={
            analytics.data
              ? `${formatPercent(analytics.data.acceptance_rate)} accepted`
              : undefined
          }
        />
        <Stat
          label="Pending network-wide"
          icon={<Hourglass className="h-4 w-4" aria-hidden />}
          value={statValue(pending, (rows) => rows.length)}
          sublabel={pending.data ? 'Awaiting a receiving hospital decision' : undefined}
          tone={pending.data && pending.data.length > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Avg response (7 days)"
          icon={<Timer className="h-4 w-4" aria-hidden />}
          value={statValue(analytics, (data) =>
            data.avg_response_seconds === null ? 'n/a' : formatSeconds(data.avg_response_seconds),
          )}
          sublabel={
            analytics.data?.median_response_seconds !== null &&
            analytics.data?.median_response_seconds !== undefined
              ? `Median ${formatSeconds(analytics.data.median_response_seconds)}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Lowest readiness compliance, last 7 days"
          description="Hospitals whose departments are missing the most shift updates."
          action={
            <Link
              to="/reports"
              className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              Compliance report
            </Link>
          }
        />
        <CardBody>
          {compliance.isPending ? (
            <LoadingBlock label="Loading compliance" rows={4} />
          ) : compliance.isError ? (
            <ErrorBlock error={compliance.error} onRetry={() => void compliance.refetch()} />
          ) : worst.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title="No compliance data yet"
              description="Once departments start reporting each shift, the weakest facilities are listed here."
            />
          ) : (
            <ul className="space-y-3">
              {worst.map((hospital) => (
                <li key={hospital.hospitalId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      to={`/hospitals/${hospital.hospitalId}`}
                      className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
                    >
                      {hospital.name}
                    </Link>
                    <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {formatPercent(hospital.rate)}
                    </span>
                  </div>
                  <Meter
                    className="mt-1.5"
                    value={hospital.rate}
                    tone={complianceTone(hospital.rate)}
                    label={`${hospital.name} readiness compliance`}
                  />
                  <p className="hint mt-1">
                    {hospital.missedShifts} missed shift{hospital.missedShifts === 1 ? '' : 's'}{' '}
                    across {hospital.departments} department
                    {hospital.departments === 1 ? '' : 's'} - last update{' '}
                    {relativeTime(hospital.lastSubmittedAt, now)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
