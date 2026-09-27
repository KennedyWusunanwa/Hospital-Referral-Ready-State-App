import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, KeyRound, Search } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  FilterBar,
  Input,
  LoadingBlock,
  Pagination,
  SearchInput,
  Select,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui'
import { useStaff } from '@/features/admin/useAdmin'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { useHospitals } from '@/features/hospitals/useHospitals'
import {
  LOGIN_METHODS,
  LOGIN_METHOD_LABELS,
  ROLE_LABELS,
  type LoginMethod,
  type UserRole,
} from '@/lib/constants'
import { useUrlState } from '@/lib/useUrlState'
import { downloadCsv, formatDateTime, relativeTime, toCsv } from '@/lib/utils'
import {
  LOGIN_EXPORT_LIMIT,
  LOGIN_PAGE_SIZE,
  describeUserAgent,
  fetchLoginEventsForExport,
  useLoginEvents,
  type LoginEventFilters,
} from './useConsole'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

const FILTER_DEFAULTS = { q: '', method: '', hospital: '', from: daysAgo(7), to: today(), page: 1 }

const METHOD_TONE: Record<LoginMethod, 'brand' | 'success' | 'warning' | 'neutral'> = {
  password: 'brand',
  otp: 'success',
  recovery: 'warning',
  unknown: 'neutral',
}

export default function ConsoleSignIns() {
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const [exporting, setExporting] = useState(false)

  const filters: LoginEventFilters = {
    q: state.q,
    method: state.method as LoginMethod | '',
    hospitalId: state.hospital || null,
    from: state.from,
    to: state.to,
    page: state.page,
    pageSize: LOGIN_PAGE_SIZE,
  }

  const events = useLoginEvents(filters)
  const hospitals = useHospitals({ onlyActive: false })
  const people = useStaff(null)

  const hospitalById = useMemo(
    () => new Map((hospitals.data ?? []).map((hospital) => [hospital.id, hospital])),
    [hospitals.data],
  )
  const nameById = useMemo(
    () => new Map((people.data ?? []).map((person) => [person.id, person.full_name])),
    [people.data],
  )

  const pageRows = events.data?.rows ?? []
  const uniqueOnPage = new Set(pageRows.map((row) => row.user_id)).size
  const methodCounts = useMemo(() => {
    const tally: Record<LoginMethod, number> = { password: 0, otp: 0, recovery: 0, unknown: 0 }
    for (const row of pageRows) tally[(row.method as LoginMethod) ?? 'unknown'] += 1
    return tally
  }, [pageRows])

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.method ? 1 : 0) +
    (state.hospital ? 1 : 0) +
    (state.from !== FILTER_DEFAULTS.from ? 1 : 0) +
    (state.to !== FILTER_DEFAULTS.to ? 1 : 0)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = await fetchLoginEventsForExport(filters)
      if (rows.length === 0) {
        toast.error('Nothing to export for these filters')
        return
      }
      downloadCsv(
        `sign-ins-${state.from}-to-${state.to}.csv`,
        toCsv(
          rows.map((row) => ({
            timestamp: row.created_at,
            name: row.user_id ? (nameById.get(row.user_id) ?? '') : '',
            email: row.email ?? '',
            role: row.role ?? '',
            hospital: row.hospital_id ? (hospitalById.get(row.hospital_id)?.name ?? '') : '',
            method: row.method,
            device: describeUserAgent(row.user_agent),
            ip_address: row.ip_address ?? '',
            user_agent: row.user_agent ?? '',
          })),
        ),
      )
      toast.success(
        rows.length >= LOGIN_EXPORT_LIMIT
          ? `Exported the most recent ${LOGIN_EXPORT_LIMIT} sign-ins`
          : `Exported ${rows.length} sign-ins`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Sign-ins in range"
          value={events.data ? events.data.total : '…'}
          sublabel={`${state.from} to ${state.to}`}
          icon={<KeyRound className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="People on this page"
          value={events.data ? uniqueOnPage : '…'}
          sublabel="Distinct accounts"
        />
        <Stat
          label="With a password"
          value={events.data ? methodCounts.password : '…'}
          sublabel="On this page"
        />
        <Stat
          label="With an email code"
          value={events.data ? methodCounts.otp : '…'}
          sublabel="On this page"
        />
      </div>

      <FilterBar
        activeCount={activeFilters}
        onClear={reset}
        summary={
          events.data
            ? `${events.data.total} sign-in${events.data.total === 1 ? '' : 's'} match`
            : undefined
        }
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Field label="Email" className="flex-1">
            {({ id }) => (
              <SearchInput
                id={id}
                value={state.q}
                onChange={(value) => update({ q: value, page: 1 })}
                placeholder="Part of an email address"
              />
            )}
          </Field>
          <Field label="Hospital" className="lg:w-64">
            {({ id }) => (
              <Select
                id={id}
                value={state.hospital}
                onChange={(e) => update({ hospital: e.target.value, page: 1 })}
              >
                <option value="">Any hospital</option>
                {(hospitals.data ?? []).map((hospital) => (
                  <option key={hospital.id} value={hospital.id}>
                    {hospital.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From" className="lg:w-40">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={state.from}
                max={state.to}
                onChange={(e) => update({ from: e.target.value, page: 1 })}
              />
            )}
          </Field>
          <Field label="To" className="lg:w-40">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={state.to}
                min={state.from}
                onChange={(e) => update({ to: e.target.value, page: 1 })}
              />
            )}
          </Field>
          <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Method</span>
          {LOGIN_METHODS.map((method) => (
            <Chip
              key={method}
              active={state.method === method}
              onClick={() => update({ method: state.method === method ? '' : method, page: 1 })}
              tone={METHOD_TONE[method]}
            >
              {LOGIN_METHOD_LABELS[method]}
            </Chip>
          ))}
        </div>
      </FilterBar>

      <Card className="overflow-hidden">
        {events.isPending ? (
          <LoadingBlock label="Loading sign-ins" rows={6} />
        ) : events.isError ? (
          <div className="p-5">
            <ErrorBlock error={events.error} onRetry={() => void events.refetch()} />
          </div>
        ) : pageRows.length === 0 ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No sign-ins in this range"
            description="Widen the dates or clear a filter. Sign-ins are recorded from the moment migration 0006 is applied."
            action={
              activeFilters > 0 ? (
                <Button variant="outline" size="sm" onClick={() => reset()}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table minWidth="60rem">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Hospital</Th>
                  <Th>Method</Th>
                  <Th>Device</Th>
                  <Th>Address</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const hospital = row.hospital_id ? hospitalById.get(row.hospital_id) : undefined
                  const name = row.user_id ? nameById.get(row.user_id) : undefined
                  return (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <Td className="whitespace-nowrap">
                        <span
                          className="block text-slate-900 dark:text-slate-100"
                          title={formatDateTime(row.created_at)}
                        >
                          {relativeTime(row.created_at)}
                        </span>
                        <span className="hint tabular-nums">{formatDateTime(row.created_at)}</span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={name ?? row.email} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {name ?? row.email ?? 'Unknown'}
                            </p>
                            {name && <p className="truncate hint">{row.email}</p>}
                          </div>
                        </div>
                      </Td>
                      <Td className="text-slate-600 dark:text-slate-300">
                        {row.role ? (ROLE_LABELS[row.role as UserRole] ?? row.role) : '-'}
                      </Td>
                      <Td>
                        {hospital ? (
                          <span className="flex items-center gap-2">
                            <HospitalLogo hospital={hospital} size="xs" />
                            <span className="truncate text-slate-700 dark:text-slate-300">
                              {hospital.name}
                            </span>
                          </span>
                        ) : (
                          <span className="hint">Network-wide</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={METHOD_TONE[(row.method as LoginMethod) ?? 'unknown']}>
                          {LOGIN_METHOD_LABELS[(row.method as LoginMethod) ?? 'unknown']}
                        </Badge>
                      </Td>
                      <Td className="text-slate-600 dark:text-slate-300">
                        <span title={row.user_agent ?? undefined}>
                          {describeUserAgent(row.user_agent)}
                        </span>
                      </Td>
                      <Td className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {row.ip_address ?? '-'}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
              <Pagination
                page={events.data.page}
                pageCount={events.data.pageCount}
                total={events.data.total}
                pageSize={events.data.pageSize}
                noun="sign-ins"
                busy={events.isFetching}
                onChange={(page) => update({ page })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
