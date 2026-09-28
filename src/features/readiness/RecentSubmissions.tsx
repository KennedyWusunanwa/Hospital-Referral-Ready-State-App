/**
 * A department's submission history, one row per shift update. Shared by the
 * update form, the department dashboard and the department readiness page.
 */

import { History } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
} from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { shiftLabel } from '@/domain/shifts'
import { useReadinessHistory } from './useReadiness'

export interface RecentSubmissionsProps {
  departmentId: string
  /** How far back to look. */
  days?: number
  title?: string
  description?: string
}

export function RecentSubmissions({
  departmentId,
  days = 7,
  title = 'Recent submissions',
  description,
}: RecentSubmissionsProps) {
  const { timezone } = useAuth()
  const query = useReadinessHistory(departmentId, days)
  const span = days === 7 ? 'seven' : String(days)

  return (
    <Card>
      <CardHeader title={title} description={description ?? `The last ${span} days.`} />
      {query.isPending ? (
        <LoadingBlock label="Loading submissions" rows={3} />
      ) : query.isError ? (
        <CardBody>
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        </CardBody>
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          icon={<History className="h-8 w-8" />}
          title="No submissions yet"
          description={`This department has not reported in the last ${span} days.`}
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {(query.data ?? []).map((update) => (
            <li key={update.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {shiftLabel({ shiftDate: update.shift_date, shiftType: update.shift_type })}
                </span>
                <Badge tone="neutral">{formatDateTime(update.submitted_at, timezone)}</Badge>
              </div>
              {update.notes && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{update.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
