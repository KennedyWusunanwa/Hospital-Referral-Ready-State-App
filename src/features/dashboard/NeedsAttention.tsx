/**
 * The triage band at the top of the dashboard.
 *
 * The single question this answers is "what needs me right now?", so it is
 * ordered by how much damage waiting does: an unanswered incoming referral past
 * the response target outranks everything, a department that has not reported
 * in three shifts outranks a referral we are merely waiting on. When nothing is
 * outstanding the band renders nothing at all rather than an empty card.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardX, Clock } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, Card, ErrorBlock, Skeleton } from '@/components/ui'
import { formatDuration } from '@/domain/geo'
import {
  REFERRAL_RESPONSE_TARGET_MINUTES,
  URGENCY_LABELS,
  type UrgencyLevel,
} from '@/lib/constants'
import type { DepartmentReadiness, ReferralWithRelations } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useDepartmentReadiness } from '@/features/readiness/useReadiness'
import { useReferrals } from '@/features/referrals/useReferrals'
import { shiftsOverdueLabel, waitingMinutes } from './dashboardUtils'

/** Beyond this the band stops being a triage list and becomes a page. */
const MAX_ITEMS = 6

const URGENCY_ORDER: Record<UrgencyLevel, number> = { critical: 0, urgent: 1, routine: 2 }

type Tone = 'danger' | 'warning'

const TONES: Record<Tone, { row: string; icon: string; action: string }> = {
  danger: {
    row: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
    icon: 'text-red-600 dark:text-red-400',
    action: 'bg-red-600 text-white hover:bg-red-700',
  },
  warning: {
    row: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
    icon: 'text-amber-600 dark:text-amber-400',
    action: 'bg-amber-600 text-white hover:bg-amber-700',
  },
}

interface AttentionItem {
  id: string
  /** Sort key: lower is more urgent. */
  rank: number
  /** Secondary sort within a rank -- longest wait or staleness first. */
  weight: number
  tone: Tone
  icon: ReactNode
  title: string
  detail: string
  to: string
  actionLabel: string
}

function incomingItem(referral: ReferralWithRelations, now: Date): AttentionItem {
  const waited = waitingMinutes(referral.requested_at, now)
  const overdue = waited > REFERRAL_RESPONSE_TARGET_MINUTES
  const from = referral.requesting_hospital?.name ?? 'an unnamed facility'

  return {
    id: `referral-in-${referral.id}`,
    rank: overdue ? 0 : 1,
    weight: URGENCY_ORDER[referral.urgency] * 10_000 - waited,
    tone: overdue || referral.urgency === 'critical' ? 'danger' : 'warning',
    icon: <ArrowDownLeft className="h-5 w-5" aria-hidden />,
    title: `Incoming referral ${referral.reference_number} needs a response`,
    detail: overdue
      ? `${URGENCY_LABELS[referral.urgency]} from ${from} - waiting ${formatDuration(waited)}, past the ${REFERRAL_RESPONSE_TARGET_MINUTES} minute target`
      : `${URGENCY_LABELS[referral.urgency]} from ${from} - waiting ${formatDuration(waited)}`,
    to: `/referrals/${referral.id}`,
    actionLabel: 'Respond',
  }
}

function outgoingItem(referral: ReferralWithRelations, now: Date): AttentionItem {
  const waited = waitingMinutes(referral.requested_at, now)
  const overdue = waited > REFERRAL_RESPONSE_TARGET_MINUTES
  const to = referral.receiving_hospital?.name ?? 'the receiving hospital'

  return {
    id: `referral-out-${referral.id}`,
    rank: overdue ? 3 : 5,
    weight: -waited,
    tone: 'warning',
    icon: <ArrowUpRight className="h-5 w-5" aria-hidden />,
    title: `${referral.reference_number} is still unanswered`,
    detail: overdue
      ? `Sent to ${to} ${formatDuration(waited)} ago - chase it or pick another hospital`
      : `Sent to ${to} - waiting ${formatDuration(waited)} for a decision`,
    to: `/referrals/${referral.id}`,
    actionLabel: 'Open',
  }
}

function departmentItem(
  department: DepartmentReadiness,
  canSubmit: boolean,
): AttentionItem {
  const stale = department.status === 'red'
  return {
    id: `department-${department.department_id}`,
    rank: stale ? 2 : 4,
    weight: -(Number.isFinite(department.shifts_since_update)
      ? department.shifts_since_update
      : 999),
    tone: stale ? 'danger' : 'warning',
    icon: stale ? (
      <ClipboardX className="h-5 w-5" aria-hidden />
    ) : (
      <Clock className="h-5 w-5" aria-hidden />
    ),
    title: `${department.department_name} readiness is ${stale ? 'stale' : 'overdue'}`,
    detail: shiftsOverdueLabel(department.shifts_since_update),
    to: canSubmit ? `/readiness/${department.department_id}` : '/readiness',
    actionLabel: canSubmit ? 'Update' : 'View',
  }
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const tone = TONES[item.tone]
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between',
        tone.row,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn('mt-0.5 shrink-0', tone.icon)}>{item.icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
          <p className="hint mt-0.5">{item.detail}</p>
        </div>
      </div>
      <Link
        to={item.to}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
          tone.action,
        )}
      >
        {item.actionLabel}
      </Link>
    </li>
  )
}

export interface NeedsAttentionProps {
  hospitalId: string | null
  now: Date
}

export function NeedsAttention({ hospitalId, now }: NeedsAttentionProps) {
  const { can } = useAuth()
  const canSubmit = can('readiness:submit')

  // Same filter shape as the referral list page, so the two share one fetch.
  const pending = useReferrals({ hospitalId, direction: 'all', status: ['pending'] })
  const readiness = useDepartmentReadiness(hospitalId)

  const items = useMemo(() => {
    const collected: AttentionItem[] = []

    for (const referral of pending.data ?? []) {
      if (referral.receiving_hospital_id === hospitalId) {
        collected.push(incomingItem(referral, now))
      } else if (referral.requesting_hospital_id === hospitalId) {
        collected.push(outgoingItem(referral, now))
      }
    }

    for (const department of readiness.data ?? []) {
      if (!department.requires_shift_update) continue
      if (department.status === 'green') continue
      collected.push(departmentItem(department, canSubmit))
    }

    return collected.sort((a, b) => a.rank - b.rank || a.weight - b.weight)
  }, [pending.data, readiness.data, hospitalId, now, canSubmit])

  if (!hospitalId) return null

  const loading = pending.isPending || readiness.isPending
  if (loading && items.length === 0) {
    return (
      <Card className="p-4" aria-busy="true" aria-label="Checking for outstanding work">
        <Skeleton className="h-4 w-40" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Card>
    )
  }

  const errored = [pending, readiness].filter((query) => query.isError)
  if (errored.length === 2) {
    return (
      <ErrorBlock
        error={pending.error ?? readiness.error}
        onRetry={() => {
          void pending.refetch()
          void readiness.refetch()
        }}
      />
    )
  }

  if (items.length === 0) return null

  const visible = items.slice(0, MAX_ITEMS)
  const hidden = items.length - visible.length

  return (
    <section aria-labelledby="needs-attention-heading">
      <Card className="border-slate-300 p-4 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          <h2
            id="needs-attention-heading"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Needs attention
          </h2>
          <span className="hint">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </div>

        {errored.length === 1 && (
          <Alert tone="warning" className="mt-3">
            Part of this list could not be loaded, so something may be missing.
          </Alert>
        )}

        <ul className="mt-3 space-y-2">
          {visible.map((item) => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </ul>

        {hidden > 0 && (
          <p className="hint mt-3">
            {hidden} more outstanding.{' '}
            <Link
              to="/referrals"
              className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              Open the referral list
            </Link>
            .
          </p>
        )}
      </Card>
    </section>
  )
}
