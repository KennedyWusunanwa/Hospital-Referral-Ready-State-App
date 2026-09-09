import { ArrowDownLeft, ArrowUpRight, Clock, MapPin, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card } from '@/components/ui'
import { formatDistance, formatDuration } from '@/domain/geo'
import { scoreBand } from '@/domain/scoring'
import { REFERRAL_RESPONSE_TARGET_MINUTES } from '@/lib/constants'
import type { ReferralWithRelations } from '@/lib/types'
import { cn, formatDateTime, isReferralOverdue, relativeTime } from '@/lib/utils'
import { referralScore } from './useReferrals'
import { ReferralStatusBadge, UrgencyBadge } from './ReferralStatusBadge'

const SCORE_TONES = {
  strong: 'success',
  moderate: 'warning',
  weak: 'danger',
} as const

export interface ReferralCardProps {
  referral: ReferralWithRelations
  /** Perspective of the hospital viewing the list. */
  direction: 'incoming' | 'outgoing'
  /** Renders the inline respond controls; the page decides on capability. */
  canRespond?: boolean
  onAccept?: (referral: ReferralWithRelations) => void
  onDecline?: (referral: ReferralWithRelations) => void
  /** True while a status mutation for this referral is in flight. */
  busy?: boolean
  now?: Date
}

export function ReferralCard({
  referral,
  direction,
  canRespond = false,
  onAccept,
  onDecline,
  busy = false,
  now = new Date(),
}: ReferralCardProps) {
  const counterpart =
    direction === 'incoming' ? referral.requesting_hospital : referral.receiving_hospital
  const counterpartName = counterpart?.name ?? 'Unassigned hospital'
  const DirectionIcon = direction === 'incoming' ? ArrowDownLeft : ArrowUpRight
  const directionLabel = direction === 'incoming' ? 'From' : 'To'

  const score = referralScore(referral)
  const overdue = referral.status === 'pending' && isReferralOverdue(referral.requested_at, now)
  const waitingMinutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(referral.requested_at).getTime()) / 60000),
  )
  const showRespond = canRespond && direction === 'incoming' && referral.status === 'pending'

  return (
    <Card
      className={cn(
        'p-4 transition-colors',
        overdue && 'border-amber-300 dark:border-amber-800/70',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/referrals/${referral.id}`}
              className="font-mono text-sm font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              {referral.reference_number}
            </Link>
            <ReferralStatusBadge status={referral.status} />
            <UrgencyBadge urgency={referral.urgency} />
            {score !== null && (
              <Badge tone={SCORE_TONES[scoreBand(score)]}>{Math.round(score)}% match</Badge>
            )}
          </div>

          <p className="flex items-center gap-1.5 text-sm text-slate-900 dark:text-slate-100">
            <DirectionIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span className="sr-only">{directionLabel} </span>
            <span className="truncate font-medium">{counterpartName}</span>
            {counterpart?.city && (
              <span className="hidden shrink-0 items-center gap-1 text-xs text-slate-500 sm:inline-flex dark:text-slate-400">
                <MapPin className="h-3 w-3" aria-hidden />
                {counterpart.city}
              </span>
            )}
          </p>

          <p className="text-sm text-slate-600 dark:text-slate-300">
            {referral.emergency_type?.name ?? 'Unspecified emergency'}
            <span className="text-slate-400 dark:text-slate-500"> &middot; </span>
            <span className="font-mono text-xs">{referral.patient_ref}</span>
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1" title={formatDateTime(referral.requested_at)}>
              <Clock className="h-3 w-3" aria-hidden />
              {relativeTime(referral.requested_at, now)}
            </span>
            {referral.distance_km !== null && (
              <span>{formatDistance(referral.distance_km)}</span>
            )}
            {referral.eta_minutes !== null && (
              <span className="inline-flex items-center gap-1">
                <Timer className="h-3 w-3" aria-hidden />
                ETA {formatDuration(referral.eta_minutes)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {showRespond && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="success"
                loading={busy}
                onClick={() => onAccept?.(referral)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDecline?.(referral)}
              >
                Decline
              </Button>
            </div>
          )}
          <Link
            to={`/referrals/${referral.id}`}
            className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
          >
            View details
          </Link>
        </div>
      </div>

      {overdue && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Awaiting response - {waitingMinutes} min (target{' '}
          {REFERRAL_RESPONSE_TARGET_MINUTES} min)
        </p>
      )}
    </Card>
  )
}
