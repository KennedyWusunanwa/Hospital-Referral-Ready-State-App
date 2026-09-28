/**
 * The dashboard a department-level account lands on.
 *
 * It answers one question -- is my department's update in, and what concerns
 * my department right now -- and nothing about the rest of the building. The
 * hospital-wide numbers live on the hospital-level dashboard; row-level
 * security would hide them from this account anyway, so showing empty
 * hospital panels here would only look broken.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, Plus, Send, ShieldAlert, Timer } from 'lucide-react'
import { Gate } from '@/auth/RequireAuth'
import { Alert, Card, PageHeader, Skeleton, Stat, StatusDot } from '@/components/ui'
import { formatDuration } from '@/domain/geo'
import { READINESS_LABELS, SUPPORT_EMAIL } from '@/lib/constants'
import { canCreateReferral, referralPolicyNotice, type UserScope } from '@/lib/scope'
import type { Hospital } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'
import { RecentSubmissions } from '@/features/readiness/RecentSubmissions'
import { useDepartmentReadiness } from '@/features/readiness/useReadiness'
import { useReferrals } from '@/features/referrals/useReferrals'
import { NeedsAttention } from './NeedsAttention'
import { ReadinessDuty } from './ReadinessDuty'
import { RecentActivity } from './RecentActivity'
import { shiftsOverdueLabel, weekStartIso } from './dashboardUtils'

const READINESS_TONE = { green: 'success', yellow: 'warning', red: 'danger' } as const

function ReferralCta({ scope }: { scope: UserScope }) {
  if (canCreateReferral(scope)) {
    return (
      <Card className="flex flex-col justify-between gap-4 border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/40 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            Need to move a patient?
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Referrals you raise are recorded against your department, and nearby hospitals are
            ranked on resources, distance and readiness.
          </p>
        </div>
        <Link
          to="/referrals/new"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New referral
        </Link>
      </Card>
    )
  }

  const notice = referralPolicyNotice(scope)
  if (!notice) return null
  return (
    <Card className="flex items-start gap-3 p-5">
      <Send className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Moving a patient?
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{notice}</p>
      </div>
    </Card>
  )
}

function DepartmentStats({
  hospitalId,
  departmentIds,
  now,
}: {
  hospitalId: string
  departmentIds: readonly string[]
  now: Date
}) {
  const readiness = useDepartmentReadiness(hospitalId)
  const pending = useReferrals({ hospitalId, direction: 'outgoing', status: ['pending'] })
  const from = useMemo(() => weekStartIso(), [])
  const week = useReferrals({ hospitalId, direction: 'outgoing', from })

  const mine = useMemo(
    () => (readiness.data ?? []).filter((row) => departmentIds.includes(row.department_id)),
    [readiness.data, departmentIds],
  )
  const worst = mine.reduce<(typeof mine)[number] | null>((acc, row) => {
    if (!acc) return row
    const order = { red: 0, yellow: 1, green: 2 }
    return order[row.status] < order[acc.status] ? row : acc
  }, null)
  const latest = mine.reduce<(typeof mine)[number] | null>((acc, row) => {
    if (!row.last_submitted_at) return acc
    if (!acc?.last_submitted_at) return row
    return row.last_submitted_at > acc.last_submitted_at ? row : acc
  }, null)

  const value = (loaded: boolean, render: () => ReactNode) =>
    loaded ? render() : <Skeleton className="h-7 w-16" />

  const completed = (week.data ?? []).filter((referral) => referral.status === 'completed').length

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat
        label={mine.length === 1 ? 'Your department' : 'Your departments'}
        icon={<ClipboardList className="h-4 w-4" aria-hidden />}
        value={value(readiness.data !== undefined, () =>
          worst ? (
            <span className="flex items-center gap-2">
              <StatusDot status={worst.status} pulse={worst.status !== 'green'} />
              {READINESS_LABELS[worst.status]}
            </span>
          ) : (
            '-'
          ),
        )}
        sublabel={worst ? shiftsOverdueLabel(worst.shifts_since_update) : undefined}
        tone={worst ? READINESS_TONE[worst.status] : undefined}
      />
      <Stat
        label="Last reported"
        icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
        value={value(readiness.data !== undefined, () =>
          latest?.last_submitted_at ? relativeTime(latest.last_submitted_at, now) : 'Never',
        )}
        sublabel={
          latest?.last_submitted_by_name ? `by ${latest.last_submitted_by_name}` : undefined
        }
      />
      <Stat
        label="Sent, awaiting reply"
        icon={<Send className="h-4 w-4" aria-hidden />}
        value={value(pending.data !== undefined, () => (pending.data ?? []).length)}
        sublabel="Referrals from your department still pending"
      />
      <Stat
        label="Completed (7 days)"
        icon={<Timer className="h-4 w-4" aria-hidden />}
        value={value(week.data !== undefined, () => completed)}
        sublabel={week.data ? `${week.data.length} raised this week` : undefined}
      />
    </div>
  )
}

export interface DepartmentDashboardProps {
  greeting: string
  roleLabel: string
  shiftChip: ReactNode
  hospital: Hospital | null
  hospitalId: string
  scope: UserScope
  minutesLeft: number
  now: Date
}

export function DepartmentDashboard({
  greeting,
  roleLabel,
  shiftChip,
  hospital,
  hospitalId,
  scope,
  minutesLeft,
  now,
}: DepartmentDashboardProps) {
  const readiness = useDepartmentReadiness(scope.departmentIds.length > 0 ? hospitalId : null)
  const mine = useMemo(
    () => (readiness.data ?? []).filter((row) => scope.departmentIds.includes(row.department_id)),
    [readiness.data, scope.departmentIds],
  )
  const departmentNames = mine.map((row) => row.department_name).join(', ')

  const header = (
    <PageHeader
      title={greeting}
      description={[hospital?.name, departmentNames || null, roleLabel].filter(Boolean).join(' - ')}
      actions={shiftChip}
    />
  )

  if (scope.departmentIds.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning" title="Your account has no department yet">
          <p>
            A department-level account sees and files readiness for its own department only, so
            until one is assigned there is nothing to show here. Ask your hospital administrator to
            set your department, or contact {SUPPORT_EMAIL}.
          </p>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <NeedsAttention hospitalId={hospitalId} departmentIds={scope.departmentIds} now={now} />

      <div className={cn('grid gap-4', 'lg:grid-cols-2')}>
        <ReadinessDuty
          hospitalId={hospitalId}
          departmentIds={scope.departmentIds}
          minutesLeft={minutesLeft}
          now={now}
        />
        <div className="space-y-4">
          <ReferralCta scope={scope} />
          <Card className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            <p className="hint">
              You see your own department only. Hospital-wide readiness, other departments and
              incoming referrals are handled at hospital level.{' '}
              <Link
                to="/readiness"
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
              >
                Open your readiness page
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>

      <DepartmentStats hospitalId={hospitalId} departmentIds={scope.departmentIds} now={now} />

      {scope.departmentIds.map((departmentId) => (
        <RecentSubmissions
          key={departmentId}
          departmentId={departmentId}
          title={
            scope.departmentIds.length > 1
              ? `Recent submissions - ${
                  mine.find((row) => row.department_id === departmentId)?.department_name ??
                  'department'
                }`
              : 'Recent submissions'
          }
        />
      ))}

      <Gate capability="referral:view">
        <RecentActivity hospitalId={hospitalId} now={now} variant="department" />
      </Gate>

      {minutesLeft <= 60 && mine.some((row) => row.status !== 'green') && (
        <Alert tone="warning" title="The shift ends soon">
          {formatDuration(minutesLeft)} left to file this shift&apos;s update before it counts as
          missed.
        </Alert>
      )}
    </div>
  )
}
