import {
  Ban,
  Check,
  CircleDot,
  Clock,
  FileText,
  Flag,
  Hourglass,
  Truck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Card, CardBody, CardHeader, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui'
import {
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  type ReferralStatus,
} from '@/lib/constants'
import type { ReferralEvent } from '@/lib/types'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import { useReferralEvents } from '@/features/referrals/useReferrals'

export interface ReferralTimelineProps {
  referralId: string
  /** Hospital id -> display name, so an event can name the facility that acted. */
  hospitalNames?: Record<string, string>
  className?: string
}

const STATUS_ICONS: Record<ReferralStatus, LucideIcon> = {
  pending: Hourglass,
  accepted: Check,
  declined: X,
  in_transit: Truck,
  completed: Flag,
  cancelled: Ban,
  expired: Clock,
}

const STATUS_ACCENTS: Record<ReferralStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  declined: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  in_transit: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  expired: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export function ReferralTimeline({ referralId, hospitalNames, className }: ReferralTimelineProps) {
  const { timezone } = useAuth()
  const { data: events, isLoading, error, refetch } = useReferralEvents(referralId)

  return (
    <Card className={className}>
      <CardHeader title="Activity" description="Every status change, in order." />
      {isLoading ? (
        <LoadingBlock label="Loading activity" rows={3} />
      ) : error ? (
        <CardBody>
          <ErrorBlock error={error} onRetry={() => void refetch()} />
        </CardBody>
      ) : !events || events.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" aria-hidden />}
          title="No activity recorded"
          description="Status changes on this referral will appear here."
        />
      ) : (
        <CardBody>
          <ol className="relative space-y-5 border-l border-slate-200 pl-6 dark:border-slate-800">
            {events.map((event) => (
              <TimelineRow
                key={event.id}
                event={event}
                hospitalNames={hospitalNames}
                timezone={timezone}
              />
            ))}
          </ol>
        </CardBody>
      )}
    </Card>
  )
}

function TimelineRow({
  event,
  hospitalNames,
  timezone,
}: {
  event: ReferralEvent
  hospitalNames?: Record<string, string>
  timezone: string
}) {
  const toStatus = asReferralStatus(event.to_status)
  const fromStatus = asReferralStatus(event.from_status)
  const Icon = toStatus ? STATUS_ICONS[toStatus] : CircleDot
  const accent = toStatus
    ? STATUS_ACCENTS[toStatus]
    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  const actorFacility = event.actor_hospital_id
    ? (hospitalNames?.[event.actor_hospital_id] ?? null)
    : null

  return (
    <li className="relative">
      <span
        className={cn(
          'absolute -left-[2.1rem] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-900',
          accent,
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {toStatus ? REFERRAL_STATUS_LABELS[toStatus] : humanizeEventType(event.event_type)}
      </p>

      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {fromStatus && toStatus && (
          <span className="mr-1">
            {REFERRAL_STATUS_LABELS[fromStatus]} to {REFERRAL_STATUS_LABELS[toStatus]} &middot;
          </span>
        )}
        <span className="tabular-nums">{formatDateTime(event.created_at, timezone)}</span>
        <span className="mx-1">&middot;</span>
        <span>{relativeTime(event.created_at)}</span>
      </p>

      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {actorFacility ? `By ${actorFacility}` : 'By the system'}
      </p>

      {event.notes && (
        <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {event.notes}
        </p>
      )}
    </li>
  )
}

function asReferralStatus(value: string | null): ReferralStatus | null {
  if (!value) return null
  return (REFERRAL_STATUSES as readonly string[]).includes(value)
    ? (value as ReferralStatus)
    : null
}

/** `status_change` -> `Status change`, for event types with no status attached. */
function humanizeEventType(eventType: string): string {
  const text = eventType.replace(/[._]/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
