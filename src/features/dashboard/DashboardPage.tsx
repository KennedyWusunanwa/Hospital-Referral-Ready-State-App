/**
 * The landing dashboard.
 *
 * Every sign-in lands here, so the page is ordered by what the user has to do
 * rather than by what is easiest to render: who is waiting on them first, then
 * the action that resolves it, then context. Each panel owns its own query, so
 * a slow analytics call never delays the referral that is already overdue.
 */

import { Link } from 'react-router-dom'
import { Clock, Plus, ShieldAlert } from 'lucide-react'
import { useAuth, useCurrentHospitalId } from '@/auth/AuthProvider'
import { Gate } from '@/auth/RequireAuth'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Skeleton,
  StatusDot,
} from '@/components/ui'
import { formatDuration } from '@/domain/geo'
import { getShiftAt, minutesLeftInShift } from '@/domain/shifts'
import { READINESS_LABELS, ROLE_LABELS, SUPPORT_EMAIL, type ReadinessStatus } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { ReadinessBoard } from '@/features/readiness/ReadinessBoard'
import { useHospitalReadiness, useNowTick } from '@/features/readiness/useReadiness'
import { DashboardStats } from './DashboardStats'
import { NeedsAttention } from './NeedsAttention'
import { NetworkOverview } from './NetworkOverview'
import { ReadinessDuty } from './ReadinessDuty'
import { RecentActivity } from './RecentActivity'
import { ReferralTrendPanel } from './ReferralTrendPanel'
import { firstNameOf, greetingFor } from './dashboardUtils'

const READINESS_TONE: Record<ReadinessStatus, 'success' | 'warning' | 'danger'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
}

function NewReferralCta() {
  return (
    <Card className="flex flex-col justify-between gap-4 border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/40 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
          Need to move a patient?
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Enter the emergency and we rank nearby hospitals on resources, distance and readiness -
          no patient identifiers required.
        </p>
      </div>
      <Link
        to="/referrals/new"
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New referral
      </Link>
    </Card>
  )
}

export default function DashboardPage() {
  const { profile, hospital, role, timezone, can } = useAuth()
  const hospitalId = useCurrentHospitalId()
  const now = useNowTick()
  const readiness = useHospitalReadiness(hospitalId)

  const shift = getShiftAt(now, timezone)
  const minutesLeft = minutesLeftInShift(now, timezone)
  const shiftName = `${shift.shiftType.charAt(0).toUpperCase()}${shift.shiftType.slice(1)}`

  const greeting = `${greetingFor(now, timezone)}, ${firstNameOf(profile?.full_name)}`
  const roleLabel = role ? ROLE_LABELS[role] : 'Signed in'

  const shiftChip = (
    <Badge tone="neutral">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {shiftName} shift - {formatDuration(minutesLeft)} left
    </Badge>
  )

  const readinessChip = readiness.isPending ? (
    <Skeleton className="h-6 w-40" />
  ) : readiness.isError || !readiness.data ? (
    <Badge tone="neutral">Readiness unavailable</Badge>
  ) : (
    <Badge tone={READINESS_TONE[readiness.data.status]}>
      <StatusDot status={readiness.data.status} pulse={readiness.data.status !== 'green'} />
      {READINESS_LABELS[readiness.data.status]} - {readiness.data.green}/{readiness.data.total}{' '}
      departments
    </Badge>
  )

  const header = (
    <PageHeader
      title={greeting}
      description={hospital ? `${hospital.name} - ${roleLabel}` : `${roleLabel} - network-wide view`}
      actions={
        <>
          {shiftChip}
          {hospitalId && readinessChip}
        </>
      }
    />
  )

  if (!hospitalId) {
    return (
      <div className="space-y-6">
        {header}
        {can('admin:system') ? (
          <>
            <NetworkOverview now={now} />
            <Gate capability="reports:view">
              <ReferralTrendPanel
                hospitalId={null}
                description="Every referral across the network, day by day."
              />
            </Gate>
          </>
        ) : (
          <Alert tone="warning" title="Your account is not linked to a hospital">
            <p>
              Readiness and referral screens need a hospital before they can show anything. Ask your
              administrator to attach your profile, or contact {SUPPORT_EMAIL}.
            </p>
          </Alert>
        )}
      </div>
    )
  }

  const showCta = can('referral:create')
  const showDuty = can('readiness:submit')

  return (
    <div className="space-y-6">
      {header}

      <NeedsAttention hospitalId={hospitalId} now={now} />

      {(showCta || showDuty) && (
        <div className={cn('grid gap-4', showCta && showDuty && 'lg:grid-cols-2')}>
          {showCta && <NewReferralCta />}
          {showDuty && (
            <ReadinessDuty
              hospitalId={hospitalId}
              departmentId={profile?.department_id ?? null}
              minutesLeft={minutesLeft}
              now={now}
            />
          )}
        </div>
      )}

      <DashboardStats hospitalId={hospitalId} now={now} />

      <Gate
        capability="readiness:view"
        fallback={
          <Alert tone="info" title="Readiness board hidden">
            <p>Your role does not include readiness visibility.</p>
          </Alert>
        }
      >
        <Card>
          <CardHeader
            title="Department readiness"
            description="Green means reported for the current shift."
            action={
              <Link
                to="/readiness"
                className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
              >
                Open board
              </Link>
            }
          />
          <CardBody>
            <ReadinessBoard hospitalId={hospitalId} compact />
          </CardBody>
        </Card>
      </Gate>

      <Gate capability="reports:view">
        <ReferralTrendPanel hospitalId={hospitalId} />
      </Gate>

      <Gate
        capability="referral:view"
        fallback={
          <Card>
            <CardBody className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-slate-400" aria-hidden />
              <p className="hint">Referral activity is not visible to your role.</p>
            </CardBody>
          </Card>
        }
      >
        <RecentActivity hospitalId={hospitalId} now={now} />
      </Gate>
    </div>
  )
}
