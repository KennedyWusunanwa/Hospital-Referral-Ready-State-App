/**
 * Every hospital's readiness on one screen, for the people who run the
 * network rather than one facility. Grouped by hospital, worst first, with the
 * same filters the directory offers so a regional officer can narrow to their
 * own patch in two clicks.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, Search } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  FilterBar,
  FilterBarAdvanced,
  SearchInput,
  Select,
  Stat,
  StatusDot,
} from '@/components/ui'
import { summariseHospitalReadiness } from '@/domain/readiness'
import { CardGridSkeleton } from '@/components/ui/skeletons'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { useHospitals } from '@/features/hospitals/useHospitals'
import {
  DEPARTMENT_TEMPLATES,
  HOSPITAL_LEVEL_LABELS,
  READINESS_LABELS,
  READINESS_STATUSES,
  type ReadinessStatus,
} from '@/lib/constants'
import type { DepartmentReadiness, Hospital, HospitalReadinessSummary } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { cn, formatPercent, relativeTime, unique } from '@/lib/utils'
import { READINESS_COLOR_CLASSES } from '@/domain/readiness'
import { useNetworkDepartmentReadiness, useNowTick } from './useReadiness'

const FILTER_DEFAULTS = { q: '', region: '', status: '', level: '' }

const SEVERITY: Record<ReadinessStatus, number> = { red: 0, yellow: 1, green: 2 }
const STATUS_TONE = { green: 'success', yellow: 'warning', red: 'danger' } as const

interface HospitalGroup {
  hospital: Hospital
  summary: HospitalReadinessSummary
  departments: DepartmentReadiness[]
}

function HospitalGroupCard({ group, now }: { group: HospitalGroup; now: Date }) {
  const { hospital, summary, departments } = group
  const owing = departments
    .filter((d) => d.requires_shift_update && d.status !== 'green')
    .sort(
      (a, b) =>
        SEVERITY[a.status] - SEVERITY[b.status] || b.shifts_since_update - a.shifts_since_update,
    )
  const rate = summary.total > 0 ? (summary.green / summary.total) * 100 : 0

  return (
    <Card className={cn('p-4', READINESS_COLOR_CLASSES[summary.status].border)}>
      <div className="flex items-start gap-3">
        <HospitalLogo hospital={hospital} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/hospitals/${hospital.id}`}
              className="truncate text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100"
            >
              {hospital.name}
            </Link>
            <Badge tone={STATUS_TONE[summary.status]}>{READINESS_LABELS[summary.status]}</Badge>
            {!hospital.accepts_referrals && <Badge tone="danger">Diverting</Badge>}
          </div>
          <p className="mt-0.5 hint">
            {hospital.code} · {HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level}
            {hospital.region ? ` · ${hospital.region}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {summary.green}/{summary.total}
          </p>
          <p className="hint">{formatPercent(rate)} current</p>
        </div>
      </div>

      <div className="mt-3 flex gap-1" aria-hidden>
        {departments
          .filter((d) => d.requires_shift_update)
          .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])
          .map((d) => (
            <span
              key={d.department_id}
              title={`${d.department_name}: ${READINESS_LABELS[d.status]}`}
              className={cn('h-1.5 flex-1 rounded-full', READINESS_COLOR_CLASSES[d.status].dot)}
            />
          ))}
      </div>

      {owing.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {owing.slice(0, 4).map((d) => (
            <li key={d.department_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot status={d.status} />
                <span className="truncate text-slate-800 dark:text-slate-200">
                  {d.department_name}
                </span>
                <span className="hidden truncate text-slate-400 sm:inline">
                  {DEPARTMENT_TEMPLATES[d.template_key]?.label}
                </span>
              </span>
              <span className="shrink-0 text-slate-500 dark:text-slate-400">
                {d.last_submitted_at ? relativeTime(d.last_submitted_at, now) : 'never'}
              </span>
            </li>
          ))}
          {owing.length > 4 && (
            <li className="hint">
              {owing.length - 4} more department{owing.length - 4 === 1 ? '' : 's'} owing
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
          Every reporting department is current.
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <Link
          to={`/hospitals/${hospital.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          Open hospital
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  )
}

export function NetworkReadinessBoard() {
  const now = useNowTick()
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const hospitals = useHospitals({ onlyActive: true })
  const departments = useNetworkDepartmentReadiness()

  const groups = useMemo<HospitalGroup[]>(() => {
    const byHospital = new Map<string, DepartmentReadiness[]>()
    for (const row of departments.data ?? []) {
      const list = byHospital.get(row.hospital_id) ?? []
      list.push(row)
      byHospital.set(row.hospital_id, list)
    }
    return (hospitals.data ?? [])
      .map((hospital) => {
        const rows = byHospital.get(hospital.id) ?? []
        return {
          hospital,
          summary: summariseHospitalReadiness(rows, hospital.id),
          departments: rows,
        }
      })
      .sort(
        (a, b) =>
          SEVERITY[a.summary.status] - SEVERITY[b.summary.status] ||
          a.summary.green / Math.max(1, a.summary.total) -
            b.summary.green / Math.max(1, b.summary.total) ||
          a.hospital.name.localeCompare(b.hospital.name),
      )
  }, [hospitals.data, departments.data])

  const regions = useMemo(
    () =>
      unique(
        (hospitals.data ?? []).map((h) => h.region).filter((r): r is string => Boolean(r)),
      ).sort((a, b) => a.localeCompare(b)),
    [hospitals.data],
  )
  const levels = useMemo(() => unique((hospitals.data ?? []).map((h) => h.level)), [hospitals.data])

  const counts = useMemo(() => {
    const tally: Record<ReadinessStatus, number> = { green: 0, yellow: 0, red: 0 }
    for (const group of groups) tally[group.summary.status] += 1
    return tally
  }, [groups])

  const totals = useMemo(() => {
    let reporting = 0
    let current = 0
    for (const group of groups) {
      reporting += group.summary.total
      current += group.summary.green
    }
    return { reporting, current, rate: reporting > 0 ? (current / reporting) * 100 : 0 }
  }, [groups])

  const visible = useMemo(() => {
    const term = state.q.trim().toLowerCase()
    return groups.filter(({ hospital, summary, departments: rows }) => {
      if (state.region && hospital.region !== state.region) return false
      if (state.level && hospital.level !== state.level) return false
      if (state.status && summary.status !== state.status) return false
      if (!term) return true
      const haystack = [
        hospital.name,
        hospital.code,
        hospital.city ?? '',
        hospital.region ?? '',
        ...rows.map((r) => r.department_name),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [groups, state.q, state.region, state.level, state.status])

  const activeFilters =
    (state.q ? 1 : 0) + (state.region ? 1 : 0) + (state.level ? 1 : 0) + (state.status ? 1 : 0)

  const loading = hospitals.isPending || departments.isPending
  const error = hospitals.error ?? departments.error

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Hospitals" value={groups.length} sublabel="Active on the network" />
        <Stat
          label="Fully current"
          value={counts.green}
          sublabel="Every department reported"
          tone={counts.green > 0 ? 'success' : undefined}
        />
        <Stat
          label="Overdue"
          value={counts.yellow}
          sublabel="At least one department late"
          tone={counts.yellow > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Stale"
          value={counts.red}
          sublabel={`${formatPercent(totals.rate)} of ${totals.reporting} departments current`}
          tone={counts.red > 0 ? 'danger' : undefined}
        />
      </div>

      <FilterBar
        activeCount={activeFilters}
        onClear={reset}
        summary={loading ? undefined : `${visible.length} of ${groups.length} hospitals`}
        gridClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Search" className="sm:col-span-2">
          {({ id }) => (
            <SearchInput
              id={id}
              value={state.q}
              onChange={(value) => update({ q: value })}
              placeholder="Hospital, code, town or department"
            />
          )}
        </Field>
        <FilterBarAdvanced>
          <Field label="Region">
            {({ id }) => (
              <Select
                id={id}
                value={state.region}
                onChange={(e) => update({ region: e.target.value })}
              >
                <option value="">All regions</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Level">
            {({ id }) => (
              <Select
                id={id}
                value={state.level}
                onChange={(e) => update({ level: e.target.value })}
              >
                <option value="">All levels</option>
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {HOSPITAL_LEVEL_LABELS[level] ?? level}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Readiness
            </span>
            {READINESS_STATUSES.map((status) => (
              <Chip
                key={status}
                active={state.status === status}
                onClick={() => update({ status: state.status === status ? '' : status })}
                tone={STATUS_TONE[status]}
                count={counts[status]}
              >
                <StatusDot status={status} />
                {READINESS_LABELS[status]}
              </Chip>
            ))}
          </div>
        </FilterBarAdvanced>
      </FilterBar>

      {loading ? (
        <Card>
          <div className="p-4">
            <CardGridSkeleton count={6} columns="md:grid-cols-2 2xl:grid-cols-3" />
          </div>
        </Card>
      ) : error ? (
        <ErrorBlock
          error={error}
          onRetry={() => {
            void hospitals.refetch()
            void departments.refetch()
          }}
        />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No hospitals yet"
            description="Add facilities from the system console to start tracking readiness."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No hospitals match"
            description="Clear a filter to widen the view."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((group) => (
            <HospitalGroupCard key={group.hospital.id} group={group} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
