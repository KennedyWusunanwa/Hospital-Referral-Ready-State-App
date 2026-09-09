/**
 * Reports and analytics: referral success rates, response times and readiness
 * compliance. The three tabs share one date range and one hospital scope so a
 * question asked on the overview can be followed straight into the detail.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Download,
  Printer,
  Timer,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Meter,
  PageHeader,
  Select,
  Stat,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { useHospitals } from '@/features/hospitals/useHospitals'
import {
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  URGENCY_LABELS,
  URGENCY_LEVELS,
} from '@/lib/constants'
import type { ComplianceRow, HospitalPerformanceRow } from '@/lib/types'
import {
  cn,
  downloadCsv,
  formatDate,
  formatDateTime,
  formatPercent,
  formatSeconds,
  toCsv,
} from '@/lib/utils'
import {
  clampPercent,
  logReportExport,
  percentScale,
  useComplianceReport,
  useHospitalPerformance,
  useReferralAnalytics,
  type AuditDetail,
  type ReportKind,
} from './useReports'
import {
  ComplianceChart,
  EmergencyTypeChart,
  ReferralTrendChart,
  ResponseTimeChart,
  StatusBreakdownChart,
  UrgencyChart,
  type CompliancePoint,
} from './charts'

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

type PresetKey = 'today' | '7d' | '30d' | '90d' | 'custom'

const PRESETS: Array<{ key: Exclude<PresetKey, 'custom'>; label: string; days: number }> = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

/** Local calendar day, not UTC -- a shift that ends at 23:00 belongs to today. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function presetRange(days: number): { from: string; to: string } {
  return { from: isoDay(daysAgo(days - 1)), to: isoDay(new Date()) }
}

interface RangeState {
  preset: PresetKey
  from: string
  to: string
}

function rangeDays(range: RangeState): number {
  const from = new Date(`${range.from}T00:00:00`).getTime()
  const to = new Date(`${range.to}T00:00:00`).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1
  return Math.min(365, Math.round((to - from) / 86_400_000) + 1)
}

function rangeTimestamps(range: RangeState): { from: string; to: string } {
  return {
    from: new Date(`${range.from}T00:00:00`).toISOString(),
    to: new Date(`${range.to}T23:59:59.999`).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const COMPLIANCE_TARGET = 80

/** Text colour for a 0-100 rate. Always rendered next to the number itself. */
function rateClass(rate: number): string {
  if (rate >= 85) return 'text-emerald-700 dark:text-emerald-400'
  if (rate >= 60) return 'text-amber-700 dark:text-amber-400'
  return 'text-red-700 dark:text-red-400'
}

function meterTone(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 85) return 'success'
  if (rate >= 60) return 'warning'
  return 'danger'
}

async function exportRows(
  kind: ReportKind,
  filename: string,
  rows: Array<Record<string, unknown>>,
  details: AuditDetail,
): Promise<void> {
  if (rows.length === 0) {
    toast.error('There is nothing to export for this period.')
    return
  }
  downloadCsv(filename, toCsv(rows))
  const logged = await logReportExport(kind, { ...details, rows: rows.length })
  if (logged) toast.success(`${rows.length} rows exported.`)
  else toast.success(`${rows.length} rows exported. The audit trail could not be written.`)
}

function ExportButton({ onExport, label }: { onExport: () => void; label: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onExport} className="no-print">
      <Download className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  )
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">{children}</table>
    </div>
  )
}

const TH_BASE =
  'border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400'
const TD_BASE = 'border-b border-slate-100 px-3 py-2 dark:border-slate-800/70'

// ---------------------------------------------------------------------------
// Hospital picker (mounted only for reports:view_all, so the extra fetch is
// never paid by a shift in-charge who can only see their own hospital)
// ---------------------------------------------------------------------------

function HospitalPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { data: hospitals, isPending, isError } = useHospitals({ onlyActive: true })

  return (
    <Field
      label="Hospital"
      className="min-w-[14rem]"
      hint={isError ? 'Could not load hospitals' : undefined}
    >
      {({ id, describedBy }) => (
        <Select
          id={id}
          aria-describedby={describedBy}
          value={value}
          disabled={isPending}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="all">All hospitals</option>
          {(hospitals ?? []).map((hospital) => (
            <option key={hospital.id} value={hospital.id}>
              {hospital.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  hospitalId,
  from,
  to,
  scopeLabel,
  rangeLabel,
}: {
  hospitalId: string | null
  from: string
  to: string
  scopeLabel: string
  rangeLabel: string
}) {
  const query = useReferralAnalytics({ hospitalId, from, to })

  const analytics = query.data
  const statusSlices = useMemo(
    () =>
      REFERRAL_STATUSES.map((status) => ({
        key: status,
        label: REFERRAL_STATUS_LABELS[status],
        count: analytics?.by_status[status] ?? 0,
      })),
    [analytics],
  )
  const urgencySlices = useMemo(
    () =>
      URGENCY_LEVELS.map((level) => ({
        key: level,
        label: URGENCY_LABELS[level].split(' - ')[0],
        count: analytics?.by_urgency[level] ?? 0,
      })),
    [analytics],
  )

  const handleExport = useCallback(() => {
    if (!analytics) return
    const rows = analytics.daily.map((point) => ({
      Day: point.day,
      Created: point.created,
      Accepted: point.accepted,
      Completed: point.completed,
    }))
    void exportRows('overview', `fern-referrals-${from.slice(0, 10)}-to-${to.slice(0, 10)}`, rows, {
      hospital_id: hospitalId,
      from,
      to,
    })
  }, [analytics, from, hospitalId, to])

  if (query.isPending) return <LoadingBlock label="Loading referral analytics" rows={4} />
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
  if (!analytics) return <ErrorBlock error="No analytics returned." />

  const acceptanceScale = percentScale([analytics.acceptance_rate])
  const acceptance = clampPercent(analytics.acceptance_rate, acceptanceScale)
  const completed = analytics.by_status.completed ?? 0

  if (analytics.total === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <ExportButton onExport={handleExport} label="Export CSV" />
        </div>
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-8 w-8" aria-hidden />}
            title="No referrals in this period"
            description={`${scopeLabel} recorded no referrals ${rangeLabel}. Widen the date range to see historical activity.`}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hint">
          {scopeLabel} · {rangeLabel}
        </p>
        <ExportButton onExport={handleExport} label="Export daily CSV" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Referrals"
          value={analytics.total}
          sublabel="created in period"
          icon={<Activity className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Acceptance rate"
          value={formatPercent(acceptance, 1)}
          sublabel={acceptance >= 80 ? 'On target' : 'Below 80% target'}
          tone={acceptance >= 80 ? 'success' : 'warning'}
        />
        <Stat
          label="Median response"
          value={formatSeconds(analytics.median_response_seconds)}
          sublabel="request to first answer"
          icon={<Clock className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Average response"
          value={formatSeconds(analytics.avg_response_seconds)}
          sublabel="request to first answer"
          icon={<Timer className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Completed transfers"
          value={completed}
          sublabel={`${formatPercent(analytics.total > 0 ? (completed / analytics.total) * 100 : 0, 1)} of referrals`}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Avg time to completion"
          value={
            analytics.avg_completion_minutes === null
              ? '-'
              : formatSeconds(analytics.avg_completion_minutes * 60)
          }
          sublabel="acceptance to arrival"
        />
      </div>

      <Card className="print-block">
        <CardHeader
          title="Referral activity"
          description="Referrals created, accepted and completed each day."
        />
        <CardBody>
          <ReferralTrendChart data={analytics.daily} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="print-block">
          <CardHeader title="By status" description="Where referrals in this period ended up." />
          <CardBody>
            <StatusBreakdownChart data={statusSlices} />
          </CardBody>
        </Card>

        <Card className="print-block">
          <CardHeader title="By urgency" description="Case mix across urgency levels." />
          <CardBody>
            <UrgencyChart data={urgencySlices} />
          </CardBody>
        </Card>
      </div>

      <Card className="print-block">
        <CardHeader
          title="Top emergency types"
          description="The conditions driving referrals in this period."
        />
        <CardBody>
          <EmergencyTypeChart data={analytics.by_emergency_type} />
        </CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hospitals tab
// ---------------------------------------------------------------------------

type PerfSortKey = keyof HospitalPerformanceRow

interface SortState<K> {
  key: K
  dir: 'asc' | 'desc'
}

function compareValues(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const factor = dir === 'asc' ? 1 : -1
  // Nulls are "no data", not "zero", so they always sink to the bottom.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
  return String(a).localeCompare(String(b)) * factor
}

function SortHeader<K extends string>({
  label,
  columnKey,
  sort,
  onSort,
  numeric,
}: {
  label: string
  columnKey: K
  sort: SortState<K>
  onSort: (key: K) => void
  numeric?: boolean
}) {
  const active = sort.key === columnKey
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(TH_BASE, numeric ? 'text-right' : 'text-left')}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-slate-200',
          active && 'text-slate-800 dark:text-slate-200',
        )}
      >
        <span>{label}</span>
        {active ? (
          sort.dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  )
}

function HospitalsTab({
  hospitalId,
  from,
  to,
  scopeLabel,
  rangeLabel,
}: {
  hospitalId: string | null
  from: string
  to: string
  scopeLabel: string
  rangeLabel: string
}) {
  const query = useHospitalPerformance({ hospitalId, from, to })
  const [sort, setSort] = useState<SortState<PerfSortKey>>({
    key: 'referrals_received',
    dir: 'desc',
  })

  const rows = useMemo(() => query.data ?? [], [query.data])
  const acceptanceScale = useMemo(
    () => percentScale(rows.map((row) => row.acceptance_rate)),
    [rows],
  )
  const complianceScale = useMemo(
    () => percentScale(rows.map((row) => row.compliance_rate)),
    [rows],
  )

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.dir)),
    [rows, sort],
  )

  const responsePoints = useMemo(
    () =>
      rows.map((row) => ({
        hospital: row.hospital_name,
        avgResponseMinutes:
          row.avg_response_seconds === null ? null : row.avg_response_seconds / 60,
        avgCompletionMinutes: row.avg_completion_minutes,
      })),
    [rows],
  )

  const handleSort = useCallback((key: PerfSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'hospital_name' ? 'asc' : 'desc' },
    )
  }, [])

  const handleExport = useCallback(() => {
    const csvRows = sorted.map((row) => ({
      Hospital: row.hospital_name,
      Sent: row.referrals_sent,
      Received: row.referrals_received,
      Accepted: row.referrals_accepted,
      Declined: row.referrals_declined,
      Completed: row.referrals_completed,
      'Acceptance rate (%)': clampPercent(row.acceptance_rate, acceptanceScale).toFixed(1),
      'Avg response': formatSeconds(row.avg_response_seconds),
      'Avg completion':
        row.avg_completion_minutes === null
          ? '-'
          : formatSeconds(row.avg_completion_minutes * 60),
      'Compliance rate (%)': clampPercent(row.compliance_rate, complianceScale).toFixed(1),
    }))
    void exportRows(
      'hospitals',
      `fern-hospital-performance-${from.slice(0, 10)}-to-${to.slice(0, 10)}`,
      csvRows,
      { hospital_id: hospitalId, from, to },
    )
  }, [acceptanceScale, complianceScale, from, hospitalId, sorted, to])

  if (query.isPending) return <LoadingBlock label="Loading hospital performance" rows={4} />
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 className="h-8 w-8" aria-hidden />}
          title="No hospital activity"
          description={`${scopeLabel} has no referral activity ${rangeLabel}.`}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hint">
          {scopeLabel} · {rangeLabel} · {rows.length} hospital{rows.length === 1 ? '' : 's'}
        </p>
        <ExportButton onExport={handleExport} label="Export CSV" />
      </div>

      <Card className="print-block">
        <CardHeader
          title="Response and completion times"
          description="Average minutes from request to answer, and from acceptance to arrival."
        />
        <CardBody>
          <ResponseTimeChart data={responsePoints} />
        </CardBody>
      </Card>

      <Card className="print-block">
        <CardHeader title="Hospital performance" description="Sort any column to compare." />
        <TableShell>
          <thead>
            <tr>
              <SortHeader
                label="Hospital"
                columnKey="hospital_name"
                sort={sort}
                onSort={handleSort}
              />
              <SortHeader
                label="Sent"
                columnKey="referrals_sent"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Received"
                columnKey="referrals_received"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Accepted"
                columnKey="referrals_accepted"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Declined"
                columnKey="referrals_declined"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Completed"
                columnKey="referrals_completed"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Acceptance"
                columnKey="acceptance_rate"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Avg response"
                columnKey="avg_response_seconds"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Avg completion"
                columnKey="avg_completion_minutes"
                sort={sort}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label="Compliance"
                columnKey="compliance_rate"
                sort={sort}
                onSort={handleSort}
                numeric
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const acceptance = clampPercent(row.acceptance_rate, acceptanceScale)
              const compliance = clampPercent(row.compliance_rate, complianceScale)
              return (
                <tr key={row.hospital_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={cn(TD_BASE, 'font-medium text-slate-900 dark:text-slate-100')}>
                    {row.hospital_name}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>{row.referrals_sent}</td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.referrals_received}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.referrals_accepted}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.referrals_declined}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.referrals_completed}
                  </td>
                  <td
                    className={cn(
                      TD_BASE,
                      'text-right font-medium tabular-nums',
                      rateClass(acceptance),
                    )}
                  >
                    {formatPercent(acceptance, 1)}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {formatSeconds(row.avg_response_seconds)}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.avg_completion_minutes === null
                      ? '-'
                      : formatSeconds(row.avg_completion_minutes * 60)}
                  </td>
                  <td
                    className={cn(
                      TD_BASE,
                      'text-right font-medium tabular-nums',
                      rateClass(compliance),
                    )}
                  >
                    {formatPercent(compliance, 1)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableShell>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compliance tab
// ---------------------------------------------------------------------------

function ComplianceTab({
  hospitalId,
  days,
  scopeLabel,
  showHospital,
  timezone,
}: {
  hospitalId: string | null
  days: number
  scopeLabel: string
  showHospital: boolean
  timezone: string
}) {
  const query = useComplianceReport({ hospitalId, days })
  const rows = useMemo(() => query.data ?? [], [query.data])

  const scale = useMemo(() => percentScale(rows.map((row) => row.compliance_rate)), [rows])

  // Worst-first: the point of this tab is finding who is not reporting.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const delta = clampPercent(a.compliance_rate, scale) - clampPercent(b.compliance_rate, scale)
        if (delta !== 0) return delta
        return b.missed_shifts - a.missed_shifts
      }),
    [rows, scale],
  )

  const below = sorted.filter(
    (row) => clampPercent(row.compliance_rate, scale) < COMPLIANCE_TARGET,
  ).length

  const chartPoints: CompliancePoint[] = useMemo(
    () =>
      sorted.map((row) => ({
        id: row.department_id,
        department: row.department_name,
        hospital: row.hospital_name,
        complianceRate: clampPercent(row.compliance_rate, scale),
      })),
    [scale, sorted],
  )

  const handleExport = useCallback(() => {
    const csvRows: Array<Record<string, unknown>> = sorted.map((row: ComplianceRow) => ({
      Hospital: row.hospital_name,
      Department: row.department_name,
      'Expected updates': row.expected_updates,
      'Actual updates': row.actual_updates,
      'Compliance rate (%)': clampPercent(row.compliance_rate, scale).toFixed(1),
      'Missed shifts': row.missed_shifts,
      'Last submission': row.last_submitted_at
        ? formatDateTime(row.last_submitted_at, timezone)
        : 'Never',
    }))
    void exportRows('compliance', `fern-compliance-last-${days}-days`, csvRows, {
      hospital_id: hospitalId,
      days,
    })
  }, [days, hospitalId, scale, sorted, timezone])

  if (query.isPending) return <LoadingBlock label="Loading compliance report" rows={4} />
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />

  if (sorted.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" aria-hidden />}
          title="No departments to report on"
          description={`${scopeLabel} has no departments that require shift updates.`}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hint">
          {scopeLabel} · last {days} day{days === 1 ? '' : 's'}
        </p>
        <ExportButton onExport={handleExport} label="Export CSV" />
      </div>

      <Alert
        tone={below > 0 ? 'warning' : 'success'}
        title={`${below} of ${sorted.length} department${sorted.length === 1 ? '' : 's'} below ${COMPLIANCE_TARGET}% compliance`}
      >
        <p>
          Measured over the last {days} day{days === 1 ? '' : 's'} of shifts.{' '}
          {below > 0
            ? 'Departments below target are listed first -- they are the ones missing shift updates.'
            : 'Every department is meeting the readiness update target.'}
        </p>
      </Alert>

      <Card className="print-block">
        <CardHeader
          title="Compliance by department"
          description={`Share of expected shift updates actually submitted. Target ${COMPLIANCE_TARGET}%.`}
        />
        <CardBody>
          <ComplianceChart data={chartPoints} target={COMPLIANCE_TARGET} />
        </CardBody>
      </Card>

      <Card className="print-block">
        <CardHeader title="Department detail" description="Worst compliance first." />
        <TableShell>
          <thead>
            <tr>
              {showHospital && (
                <th scope="col" className={cn(TH_BASE, 'text-left')}>
                  Hospital
                </th>
              )}
              <th scope="col" className={cn(TH_BASE, 'text-left')}>
                Department
              </th>
              <th scope="col" className={cn(TH_BASE, 'text-right')}>
                Expected
              </th>
              <th scope="col" className={cn(TH_BASE, 'text-right')}>
                Actual
              </th>
              <th scope="col" className={cn(TH_BASE, 'text-left')}>
                Compliance
              </th>
              <th scope="col" className={cn(TH_BASE, 'text-right')}>
                Missed shifts
              </th>
              <th scope="col" className={cn(TH_BASE, 'text-left')}>
                Last submission
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const rate = clampPercent(row.compliance_rate, scale)
              return (
                <tr
                  key={row.department_id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  {showHospital && (
                    <td className={cn(TD_BASE, 'text-slate-600 dark:text-slate-400')}>
                      {row.hospital_name}
                    </td>
                  )}
                  <td className={cn(TD_BASE, 'font-medium text-slate-900 dark:text-slate-100')}>
                    {row.department_name}
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>{row.expected_updates}</td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>{row.actual_updates}</td>
                  <td className={TD_BASE}>
                    <div className="flex min-w-[9rem] items-center gap-2">
                      <Meter
                        value={rate}
                        tone={meterTone(rate)}
                        label={`${row.department_name} compliance`}
                        className="flex-1"
                      />
                      <span className={cn('w-14 text-right tabular-nums', rateClass(rate))}>
                        {formatPercent(rate, 1)}
                      </span>
                    </div>
                  </td>
                  <td className={cn(TD_BASE, 'text-right tabular-nums')}>
                    {row.missed_shifts > 0 ? (
                      <Badge tone={row.missed_shifts >= 3 ? 'danger' : 'warning'}>
                        {row.missed_shifts}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td
                    className={cn(TD_BASE, 'whitespace-nowrap text-slate-600 dark:text-slate-400')}
                  >
                    {row.last_submitted_at
                      ? formatDateTime(row.last_submitted_at, timezone)
                      : 'Never'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableShell>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const { profile, hospital, can, timezone } = useAuth()
  const viewAll = can('reports:view_all')

  const [selectedHospital, setSelectedHospital] = useState('all')
  const [range, setRange] = useState<RangeState>(() => ({ preset: '7d', ...presetRange(7) }))
  const [tab, setTab] = useState('overview')

  const hospitalId = viewAll
    ? selectedHospital === 'all'
      ? null
      : selectedHospital
    : (profile?.hospital_id ?? null)

  const { from, to } = useMemo(() => rangeTimestamps(range), [range])
  const days = useMemo(() => rangeDays(range), [range])

  // Resolve the name from the directory, not from useAuth().hospital: a
  // super_admin has no home hospital, so reading their own would label every
  // export "Selected hospital" whichever facility they actually picked.
  const { data: allHospitals } = useHospitals({ onlyActive: true })
  const scopeLabel =
    hospitalId === null
      ? 'All hospitals'
      : (allHospitals?.find((h) => h.id === hospitalId)?.name ??
        hospital?.name ??
        'Selected hospital')
  const rangeLabel =
    range.from === range.to
      ? `on ${formatDate(`${range.from}T12:00:00`, timezone)}`
      : `between ${formatDate(`${range.from}T12:00:00`, timezone)} and ${formatDate(`${range.to}T12:00:00`, timezone)}`

  const applyPreset = (key: Exclude<PresetKey, 'custom'>, presetDays: number) => {
    setRange({ preset: key, ...presetRange(presetDays) })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & analytics"
        description="Referral success rates, response times and readiness compliance."
        actions={
          <Button variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
        }
      />

      <Card className="no-print">
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="field-label">Period</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Quick date ranges">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.key}
                    size="sm"
                    variant={range.preset === preset.key ? 'primary' : 'outline'}
                    aria-pressed={range.preset === preset.key}
                    onClick={() => applyPreset(preset.key, preset.days)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <Field label="From" className="w-40">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(event) =>
                    setRange((current) => ({
                      ...current,
                      preset: 'custom',
                      from: event.target.value || current.from,
                    }))
                  }
                />
              )}
            </Field>

            <Field label="To" className="w-40">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  value={range.to}
                  min={range.from}
                  onChange={(event) =>
                    setRange((current) => ({
                      ...current,
                      preset: 'custom',
                      to: event.target.value || current.to,
                    }))
                  }
                />
              )}
            </Field>

            {viewAll && (
              <HospitalPicker value={selectedHospital} onChange={setSelectedHospital} />
            )}
          </div>

          <p className="hint">
            {scopeLabel} · {rangeLabel} · compliance measured over the last {days} day
            {days === 1 ? '' : 's'}.
          </p>
        </CardBody>
      </Card>

      <Tabs defaultValue="overview" value={tab} onValueChange={setTab}>
        <TabList className="no-print">
          <Tab value="overview">Overview</Tab>
          <Tab value="hospitals">Hospitals</Tab>
          <Tab value="compliance">Compliance</Tab>
        </TabList>

        <div className="pt-4">
          <TabPanel value="overview">
            <OverviewTab
              hospitalId={hospitalId}
              from={from}
              to={to}
              scopeLabel={scopeLabel}
              rangeLabel={rangeLabel}
            />
          </TabPanel>

          <TabPanel value="hospitals">
            <HospitalsTab
              hospitalId={hospitalId}
              from={from}
              to={to}
              scopeLabel={scopeLabel}
              rangeLabel={rangeLabel}
            />
          </TabPanel>

          <TabPanel value="compliance">
            <ComplianceTab
              hospitalId={hospitalId}
              days={days}
              scopeLabel={scopeLabel}
              showHospital={hospitalId === null}
              timezone={timezone}
            />
          </TabPanel>
        </div>
      </Tabs>
    </div>
  )
}
