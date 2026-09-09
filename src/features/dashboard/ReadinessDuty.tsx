/**
 * The "is my update in?" card, for anyone who can submit readiness.
 *
 * Staff attached to a department see only their own duty, because that is the
 * one thing they can act on. Anyone else who can submit -- a hospital
 * administrator covering the floor, say -- sees the departments still owing an
 * update this shift instead of an empty card.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardList, PencilLine } from 'lucide-react'
import { Card, CardBody, CardHeader, ErrorBlock, LoadingBlock, StatusDot } from '@/components/ui'
import { formatDuration } from '@/domain/geo'
import { READINESS_COLOR_CLASSES } from '@/domain/readiness'
import { READINESS_DESCRIPTIONS, READINESS_LABELS } from '@/lib/constants'
import type { DepartmentReadiness } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'
import { useDepartmentReadiness } from '@/features/readiness/useReadiness'
import { shiftsOverdueLabel } from './dashboardUtils'

/** Enough to act on without turning the dashboard into the readiness page. */
const MAX_OWING = 5

function UpdateLink({
  departmentId,
  label,
  emphasis,
}: {
  departmentId: string
  label: string
  emphasis: boolean
}) {
  return (
    <Link
      to={`/readiness/${departmentId}`}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        emphasis
          ? 'bg-brand-600 text-white hover:bg-brand-700'
          : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      <PencilLine className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  )
}

function MyDepartment({
  department,
  minutesLeft,
  now,
}: {
  department: DepartmentReadiness
  minutesLeft: number
  now: Date
}) {
  const colors = READINESS_COLOR_CLASSES[department.status]
  const current = department.status === 'green'

  return (
    <div className={cn('rounded-xl border p-4', colors.border, colors.bg)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot
          status={department.status}
          label={READINESS_LABELS[department.status]}
          pulse={!current}
        />
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {department.department_name}
        </p>
      </div>

      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
        {READINESS_DESCRIPTIONS[department.status]}
      </p>

      <dl className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex gap-1.5">
          <dt className="font-medium">Last submitted:</dt>
          <dd>
            {relativeTime(department.last_submitted_at, now)}
            {department.last_submitted_by_name ? ` by ${department.last_submitted_by_name}` : ''}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-medium">Shift ends in:</dt>
          <dd>{formatDuration(minutesLeft)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <UpdateLink
          departmentId={department.department_id}
          label={current ? 'Amend this shift' : 'Submit readiness update'}
          emphasis={!current}
        />
        {current && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Reported for this shift
          </span>
        )}
      </div>
    </div>
  )
}

function OwingList({ departments, now }: { departments: DepartmentReadiness[]; now: Date }) {
  const visible = departments.slice(0, MAX_OWING)
  const hidden = departments.length - visible.length

  return (
    <div className="space-y-2">
      {visible.map((department) => {
        const colors = READINESS_COLOR_CLASSES[department.status]
        return (
          <div
            key={department.department_id}
            className={cn(
              'flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between',
              colors.border,
              colors.bg,
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot status={department.status} label={READINESS_LABELS[department.status]} />
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {department.department_name}
                </p>
              </div>
              <p className="hint mt-0.5">
                {shiftsOverdueLabel(department.shifts_since_update)} -{' '}
                {relativeTime(department.last_submitted_at, now)}
              </p>
            </div>
            <UpdateLink departmentId={department.department_id} label="Update" emphasis />
          </div>
        )
      })}

      {hidden > 0 && (
        <p className="hint">
          {hidden} more still owing.{' '}
          <Link
            to="/readiness"
            className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
          >
            Open the readiness board
          </Link>
          .
        </p>
      )}
    </div>
  )
}

export interface ReadinessDutyProps {
  hospitalId: string | null
  /** The signed-in user's own department, when they have one. */
  departmentId: string | null
  minutesLeft: number
  now: Date
}

export function ReadinessDuty({
  hospitalId,
  departmentId,
  minutesLeft,
  now,
}: ReadinessDutyProps) {
  const query = useDepartmentReadiness(hospitalId)

  const mine = useMemo(
    () =>
      departmentId
        ? ((query.data ?? []).find((row) => row.department_id === departmentId) ?? null)
        : null,
    [query.data, departmentId],
  )

  const owing = useMemo(
    () =>
      (query.data ?? [])
        .filter((row) => row.requires_shift_update && row.status !== 'green')
        .sort((a, b) => b.shifts_since_update - a.shifts_since_update),
    [query.data],
  )

  return (
    <Card>
      <CardHeader
        title={mine ? 'Your shift update' : 'Readiness still owing'}
        description={
          mine
            ? 'One update per department, per shift.'
            : 'Departments that have not reported for the current shift.'
        }
      />
      <CardBody>
        {query.isPending ? (
          <LoadingBlock label="Loading your readiness duty" rows={2} />
        ) : query.isError ? (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        ) : mine ? (
          <MyDepartment department={mine} minutesLeft={minutesLeft} now={now} />
        ) : owing.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
            <ClipboardList
              className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Every department has reported
              </p>
              <p className="hint mt-0.5">
                Nothing is owing for this shift. {formatDuration(minutesLeft)} left before the next
                round is due.
              </p>
            </div>
          </div>
        ) : (
          <OwingList departments={owing} now={now} />
        )}
      </CardBody>
    </Card>
  )
}
