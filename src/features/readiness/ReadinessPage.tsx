/**
 * The hospital's readiness board: which departments have reported this shift,
 * which have not, and how long is left to fix that before the shift rolls over.
 */

import { AlertTriangle, CheckCircle2, Clock3, Gauge, XCircle } from 'lucide-react'
import { useAuth, useCurrentHospitalId } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorBlock,
  PageHeader,
  Skeleton,
  Stat,
} from '@/components/ui'
import { SHIFT_WINDOWS } from '@/lib/constants'
import { formatPercent } from '@/lib/utils'
import { complianceRate } from '@/domain/readiness'
import { formatDuration } from '@/domain/geo'
import { getShiftAt, minutesLeftInShift } from '@/domain/shifts'
import { ReadinessBoard } from './ReadinessBoard'
import { useHospitalReadiness, useNowTick } from './useReadiness'

function shiftName(type: string): string {
  const window = SHIFT_WINDOWS.find((candidate) => candidate.type === type)
  const name = window?.type ?? type
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

export default function ReadinessPage() {
  const { hospital, timezone } = useAuth()
  const hospitalId = useCurrentHospitalId()
  const now = useNowTick()
  const summaryQuery = useHospitalReadiness(hospitalId)

  const shift = getShiftAt(now, timezone)
  const remaining = minutesLeftInShift(now, timezone)
  const summary = summaryQuery.data
  const compliance = summary ? complianceRate(summary) : null
  const needsAction = summary ? summary.yellow + summary.red : 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departmental readiness"
        description={
          hospital
            ? `${hospital.name} - shift times shown in ${timezone}`
            : 'Readiness reporting for your hospital'
        }
        actions={
          <Badge tone="brand" className="px-3 py-1 text-sm">
            <Clock3 className="h-4 w-4" aria-hidden />
            {shiftName(shift.shiftType)} shift - {formatDuration(remaining)} remaining
          </Badge>
        }
      />

      {summaryQuery.isError && (
        <ErrorBlock error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />
      )}

      {summaryQuery.isPending && hospitalId ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Reported this shift"
            value={summary ? summary.green : '-'}
            sublabel={summary ? `of ${summary.total} departments` : undefined}
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          <Stat
            label="Overdue"
            value={summary ? summary.yellow : '-'}
            sublabel="Missed the last shift"
            tone={summary && summary.yellow > 0 ? 'warning' : undefined}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
          <Stat
            label="Stale"
            value={summary ? summary.red : '-'}
            sublabel="Three shifts or more"
            tone={summary && summary.red > 0 ? 'danger' : undefined}
            icon={<XCircle className="h-5 w-5" />}
          />
          <Stat
            label="Compliance"
            value={compliance === null ? '-' : formatPercent(compliance)}
            sublabel="Departments current right now"
            icon={<Gauge className="h-5 w-5" />}
          />
        </div>
      )}

      {needsAction > 0 && (
        <Alert tone={summary && summary.red > 0 ? 'danger' : 'warning'} title="Action needed">
          {needsAction} department{needsAction === 1 ? '' : 's'} have not reported for the current
          shift. Referring hospitals see a scoring penalty against every one of them until they do.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Departments"
          description="Overdue and stale departments are listed first."
        />
        <CardBody>
          <ReadinessBoard hospitalId={hospitalId} />
        </CardBody>
      </Card>
    </div>
  )
}
