/**
 * The five numbers a shift lead is asked for on the phone.
 *
 * Response times are derived from the referral rows the page already holds
 * rather than the analytics RPC, so a shift in-charge without `reports:view`
 * still sees them.
 */

import { useMemo, type ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ClipboardList, Timer } from 'lucide-react'
import { ErrorBlock, Skeleton, Stat } from '@/components/ui'
import { complianceRate } from '@/domain/readiness'
import { REFERRAL_RESPONSE_TARGET_MINUTES } from '@/lib/constants'
import { formatPercent, formatSeconds, isReferralOverdue } from '@/lib/utils'
import { useHospitalReadiness } from '@/features/readiness/useReadiness'
import { useReferrals } from '@/features/referrals/useReferrals'
import { weekStartIso } from './dashboardUtils'

const READINESS_TONE = { green: 'success', yellow: 'warning', red: 'danger' } as const

function statValue<T>(query: UseQueryResult<T>, render: (data: T) => ReactNode): ReactNode {
  if (query.data === undefined) {
    return query.isError ? '-' : <Skeleton className="h-7 w-16" />
  }
  return render(query.data)
}

export interface DashboardStatsProps {
  hospitalId: string | null
  now: Date
}

export function DashboardStats({ hospitalId, now }: DashboardStatsProps) {
  const readiness = useHospitalReadiness(hospitalId)
  const pending = useReferrals({ hospitalId, direction: 'all', status: ['pending'] })

  // Snapped to the hour so the key is stable across renders and panels.
  const from = useMemo(() => weekStartIso(), [])
  const week = useReferrals({ hospitalId, direction: 'all', from })

  const split = useMemo(() => {
    let incoming = 0
    let incomingOverdue = 0
    let outgoing = 0
    for (const referral of pending.data ?? []) {
      if (referral.receiving_hospital_id === hospitalId) {
        incoming += 1
        if (isReferralOverdue(referral.requested_at, now)) incomingOverdue += 1
      } else if (referral.requesting_hospital_id === hospitalId) {
        outgoing += 1
      }
    }
    return { incoming, incomingOverdue, outgoing }
  }, [pending.data, hospitalId, now])

  const weekly = useMemo(() => {
    const rows = week.data ?? []
    const responses = rows
      .map((referral) => referral.response_seconds)
      .filter((seconds): seconds is number => typeof seconds === 'number' && seconds >= 0)

    return {
      completed: rows.filter((referral) => referral.status === 'completed').length,
      created: rows.length,
      avgResponseSeconds:
        responses.length === 0
          ? null
          : responses.reduce((total, seconds) => total + seconds, 0) / responses.length,
      responseCount: responses.length,
    }
  }, [week.data])

  if (readiness.isError && pending.isError && week.isError) {
    return (
      <ErrorBlock
        error={readiness.error}
        onRetry={() => {
          void readiness.refetch()
          void pending.refetch()
          void week.refetch()
        }}
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Stat
        label="Departments current"
        icon={<ClipboardList className="h-4 w-4" aria-hidden />}
        value={statValue(readiness, (summary) => `${summary.green}/${summary.total}`)}
        sublabel={
          readiness.data
            ? `${formatPercent(complianceRate(readiness.data))} reported this shift`
            : undefined
        }
        tone={readiness.data ? READINESS_TONE[readiness.data.status] : undefined}
      />

      <Stat
        label="Awaiting our response"
        icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
        value={statValue(pending, () => split.incoming)}
        sublabel={
          pending.data
            ? split.incomingOverdue > 0
              ? `${split.incomingOverdue} past ${REFERRAL_RESPONSE_TARGET_MINUTES} min`
              : 'All within target'
            : undefined
        }
        tone={pending.data ? (split.incomingOverdue > 0 ? 'danger' : 'success') : undefined}
      />

      <Stat
        label="Sent, awaiting reply"
        icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
        value={statValue(pending, () => split.outgoing)}
        sublabel={pending.data ? 'Outgoing referrals still pending' : undefined}
      />

      <Stat
        label="Completed (7 days)"
        icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
        value={statValue(week, () => weekly.completed)}
        sublabel={week.data ? `${weekly.created} referrals raised or received` : undefined}
      />

      <Stat
        label="Avg response (7 days)"
        icon={<Timer className="h-4 w-4" aria-hidden />}
        value={statValue(week, () =>
          weekly.avgResponseSeconds === null ? 'n/a' : formatSeconds(weekly.avgResponseSeconds),
        )}
        sublabel={
          week.data
            ? weekly.responseCount === 0
              ? 'No answered referrals yet'
              : `Across ${weekly.responseCount} answered referral${weekly.responseCount === 1 ? '' : 's'}`
            : undefined
        }
      />
    </div>
  )
}
