/**
 * The per-department traffic-light grid.
 *
 * Shared by the readiness page, the dashboard and the hospital detail page, so
 * it owns its own filtering and never assumes it is the only thing on screen.
 * Departments that need action sort to the top: at 3am nobody should have to
 * scan a list to find the red one.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, PencilLine, Search, ShieldAlert } from 'lucide-react'
import { Gate } from '@/auth/RequireAuth'
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Select,
  StatusDot,
} from '@/components/ui'
import {
  DEPARTMENT_TEMPLATES,
  READINESS_LABELS,
  READINESS_STATUSES,
  type ReadinessStatus,
} from '@/lib/constants'
import type { DepartmentReadiness } from '@/lib/types'
import { cn, relativeTime } from '@/lib/utils'
import { READINESS_COLOR_CLASSES } from '@/domain/readiness'
import { shiftLabel } from '@/domain/shifts'
import { useDepartmentReadiness, useNowTick } from './useReadiness'

/** Above this many departments a search box earns its place. */
const FILTER_THRESHOLD = 6

const SEVERITY_ORDER: Record<ReadinessStatus, number> = { red: 0, yellow: 1, green: 2 }

function staleness(department: DepartmentReadiness): string {
  if (!department.last_submitted_at) return 'Never submitted'
  const shifts = department.shifts_since_update
  if (shifts === 0) return 'Reported this shift'
  return `${shifts} shift${shifts === 1 ? '' : 's'} overdue`
}

function lastShiftLabel(department: DepartmentReadiness): string | null {
  if (!department.last_shift_date || !department.last_shift_type) return null
  return shiftLabel({
    shiftDate: department.last_shift_date,
    shiftType: department.last_shift_type,
  })
}

function DepartmentRow({
  department,
  now,
  compact,
}: {
  department: DepartmentReadiness
  now: Date
  compact: boolean
}) {
  const colors = READINESS_COLOR_CLASSES[department.status]
  const template = DEPARTMENT_TEMPLATES[department.template_key]
  const shift = lastShiftLabel(department)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between',
        colors.border,
        colors.bg,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={department.status} pulse={department.status !== 'green'} />
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {department.department_name}
          </p>
          <Badge
            tone={
              department.status === 'green'
                ? 'success'
                : department.status === 'yellow'
                  ? 'warning'
                  : 'danger'
            }
          >
            {READINESS_LABELS[department.status]}
          </Badge>
          {!department.requires_shift_update && <Badge tone="neutral">Not on shift rota</Badge>}
        </div>

        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {staleness(department)}
          {department.last_submitted_at && (
            <>
              {' · '}
              {department.last_submitted_by_name ?? 'Unknown staff'}
              {', '}
              {relativeTime(department.last_submitted_at, now)}
            </>
          )}
        </p>

        {!compact && (
          <p className="mt-0.5 hint">
            {template?.label ?? department.template_key}
            {shift && ` · last reported ${shift}`}
          </p>
        )}
      </div>

      <Gate capability="readiness:submit">
        <div className="shrink-0">
          <Link
            to={`/readiness/${department.department_id}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              department.status === 'green'
                ? 'border border-slate-300 text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                : 'bg-brand-600 text-white hover:bg-brand-700',
            )}
          >
            <PencilLine className="h-4 w-4" aria-hidden />
            Update now
            <span className="sr-only">for {department.department_name}</span>
          </Link>
        </div>
      </Gate>
    </div>
  )
}

export interface ReadinessBoardProps {
  hospitalId: string | null
  /** Dense layout for dashboard cards: no filters, no secondary detail. */
  compact?: boolean
  className?: string
}

export function ReadinessBoard({ hospitalId, compact = false, className }: ReadinessBoardProps) {
  const query = useDepartmentReadiness(hospitalId)
  const now = useNowTick()
  const [status, setStatus] = useState<ReadinessStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const departments = useMemo(() => query.data ?? [], [query.data])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return departments
      .filter((department) => status === 'all' || department.status === status)
      .filter(
        (department) => term === '' || department.department_name.toLowerCase().includes(term),
      )
      .sort((a, b) => {
        // Departments off the rota can never be actioned, so they sink.
        if (a.requires_shift_update !== b.requires_shift_update) {
          return a.requires_shift_update ? -1 : 1
        }
        const severity = SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status]
        if (severity !== 0) return severity
        if (a.shifts_since_update !== b.shifts_since_update) {
          return b.shifts_since_update - a.shifts_since_update
        }
        return a.department_name.localeCompare(b.department_name)
      })
  }, [departments, search, status])

  if (!hospitalId) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-8 w-8" />}
        title="No hospital selected"
        description="Your account is not attached to a hospital, so there is no readiness board to show."
      />
    )
  }

  if (query.isPending) return <LoadingBlock label="Loading departments" rows={compact ? 3 : 5} />
  if (query.isError) {
    return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
  }

  if (departments.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="h-8 w-8" />}
        title="No departments configured"
        description="Ask your hospital administrator to add the departments that report readiness each shift."
      />
    )
  }

  const showFilters = !compact && departments.length > FILTER_THRESHOLD

  return (
    <div className={cn('space-y-3', className)}>
      {showFilters && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              type="search"
              className="pl-9"
              placeholder="Search departments"
              aria-label="Search departments"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            className="sm:w-52"
            aria-label="Filter by readiness status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ReadinessStatus | 'all')}
          >
            <option value="all">All statuses</option>
            {READINESS_STATUSES.map((value) => (
              <option key={value} value={value}>
                {READINESS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="No departments match"
          description="Clear the search or choose a different status."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setStatus('all')
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className={cn('grid gap-3', !compact && 'xl:grid-cols-2')}>
          {visible.map((department) => (
            <DepartmentRow
              key={department.department_id}
              department={department}
              now={now}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  )
}
