import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Building2, LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { CardGridSkeleton, TableSkeleton } from '@/components/ui/skeletons'
import { Gate } from '@/auth/RequireAuth'
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
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  StatusDot,
  Table,
  Td,
  Th,
  Toggle,
} from '@/components/ui'
import { formatDistance, haversineKm, isValidLatLng } from '@/domain/geo'
import {
  HOSPITAL_LEVELS,
  HOSPITAL_LEVEL_LABELS,
  READINESS_LABELS,
  READINESS_STATUSES,
  type HospitalLevel,
  type ReadinessStatus,
} from '@/lib/constants'
import { useUrlState } from '@/lib/useUrlState'
import { unique } from '@/lib/utils'
import type { Hospital, HospitalReadinessSummary } from '@/lib/types'
import { useNetworkReadiness } from '@/features/readiness/useReadiness'
import { CallLink } from './HospitalContactLinks'
import { HospitalCard } from './HospitalCard'
import { HospitalLogo } from './HospitalLogo'
import { useHospitals } from './useHospitals'

type SortKey = 'distance' | 'name' | 'readiness' | 'region' | 'level'
type ViewMode = 'grid' | 'table'

const FILTER_DEFAULTS = {
  q: '',
  region: '',
  level: '',
  status: '',
  accepting: false,
  sort: 'distance',
  view: 'grid',
}

const SEVERITY: Record<ReadinessStatus, number> = { red: 0, yellow: 1, green: 2 }
const LEVEL_RANK: Record<HospitalLevel, number> = {
  specialist: 0,
  tertiary: 1,
  secondary: 2,
  district: 3,
  primary: 4,
  health_centre: 5,
}

interface DirectoryEntry {
  hospital: Hospital
  distanceKm: number | null
  readiness: HospitalReadinessSummary | null | undefined
}

export default function HospitalListPage() {
  const { hospital: ownHospital } = useAuth()
  const { state, update, reset, dirty } = useUrlState(FILTER_DEFAULTS)

  // The whole active directory is small and filtering happens client-side so a
  // coordinator typing at 3am gets instant feedback instead of a request per key.
  const query = useHospitals({ onlyActive: true })
  const readinessQuery = useNetworkReadiness()
  const hospitals = useMemo(() => query.data ?? [], [query.data])

  const origin = useMemo(
    () =>
      ownHospital && isValidLatLng(ownHospital)
        ? { latitude: ownHospital.latitude, longitude: ownHospital.longitude }
        : null,
    [ownHospital],
  )

  const regions = useMemo(
    () =>
      unique(
        hospitals.map((row) => row.region).filter((value): value is string => Boolean(value)),
      ).sort((a, b) => a.localeCompare(b)),
    [hospitals],
  )

  const sort = (origin ? state.sort : state.sort === 'distance' ? 'name' : state.sort) as SortKey
  const view = state.view as ViewMode

  const all = useMemo<DirectoryEntry[]>(
    () =>
      hospitals.map((hospital) => ({
        hospital,
        distanceKm: origin && isValidLatLng(hospital) ? haversineKm(origin, hospital) : null,
        readiness: readinessQuery.data ? (readinessQuery.data[hospital.id] ?? null) : undefined,
      })),
    [hospitals, origin, readinessQuery.data],
  )

  const statusCounts = useMemo(() => {
    const counts: Record<ReadinessStatus, number> = { green: 0, yellow: 0, red: 0 }
    for (const entry of all) {
      if (entry.readiness && entry.readiness.total > 0) counts[entry.readiness.status] += 1
    }
    return counts
  }, [all])

  const entries = useMemo<DirectoryEntry[]>(() => {
    const term = state.q.trim().toLowerCase()

    const matched = all.filter(({ hospital, readiness }) => {
      if (state.region && hospital.region !== state.region) return false
      if (state.level && hospital.level !== state.level) return false
      if (state.accepting && !hospital.accepts_referrals) return false
      if (state.status) {
        if (!readiness || readiness.total === 0) return false
        if (readiness.status !== state.status) return false
      }
      if (!term) return true
      return [
        hospital.name,
        hospital.code,
        hospital.city ?? '',
        hospital.region ?? '',
        hospital.address ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })

    const byName = (a: DirectoryEntry, b: DirectoryEntry) =>
      a.hospital.name.localeCompare(b.hospital.name)

    matched.sort((a, b) => {
      switch (sort) {
        case 'distance': {
          // Un-geocoded facilities cannot be ranked on proximity, so they trail.
          if (a.distanceKm === null && b.distanceKm !== null) return 1
          if (b.distanceKm === null && a.distanceKm !== null) return -1
          if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
            return a.distanceKm - b.distanceKm
          }
          return byName(a, b)
        }
        case 'readiness': {
          const sa = a.readiness && a.readiness.total > 0 ? SEVERITY[a.readiness.status] : 3
          const sb = b.readiness && b.readiness.total > 0 ? SEVERITY[b.readiness.status] : 3
          return sa - sb || byName(a, b)
        }
        case 'region':
          return (
            (a.hospital.region ?? 'zzz').localeCompare(b.hospital.region ?? 'zzz') || byName(a, b)
          )
        case 'level':
          return LEVEL_RANK[a.hospital.level] - LEVEL_RANK[b.hospital.level] || byName(a, b)
        default:
          return byName(a, b)
      }
    })

    return matched
  }, [all, state.q, state.region, state.level, state.accepting, state.status, sort])

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.region ? 1 : 0) +
    (state.level ? 1 : 0) +
    (state.status ? 1 : 0) +
    (state.accepting ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Hospital directory"
        description={
          origin && ownHospital && sort === 'distance'
            ? `Sorted by distance from ${ownHospital.name}.`
            : origin
              ? 'Every facility on the network.'
              : 'Sorted by name. Add coordinates to your hospital to sort by distance.'
        }
        actions={
          <>
            <SegmentedControl
              ariaLabel="Layout"
              size="sm"
              value={view}
              onChange={(next) => update({ view: next })}
              options={[
                {
                  value: 'grid',
                  label: (
                    <>
                      <LayoutGrid className="h-4 w-4" aria-hidden />
                      <span className="sr-only sm:not-sr-only">Cards</span>
                    </>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <>
                      <List className="h-4 w-4" aria-hidden />
                      <span className="sr-only sm:not-sr-only">Table</span>
                    </>
                  ),
                },
              ]}
            />
            <Gate capability="admin:system">
              <Link to="/console/hospitals?new=1">
                <Button size="sm">
                  <Plus className="h-4 w-4" aria-hidden />
                  Add hospital
                </Button>
              </Link>
            </Gate>
          </>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={reset}
        summary={
          query.data
            ? `${entries.length} of ${hospitals.length} hospitals${dirty ? ' match' : ''}`
            : undefined
        }
        gridClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Field label="Search" className="sm:col-span-2">
          {({ id }) => (
            <SearchInput
              id={id}
              value={state.q}
              onChange={(value) => update({ q: value })}
              placeholder="Name, code, town, region or address"
            />
          )}
        </Field>

        <FilterBarAdvanced>
          <Field label="Region">
            {({ id }) => (
              <Select
                id={id}
                value={state.region}
                onChange={(event) => update({ region: event.target.value })}
              >
                <option value="">All regions</option>
                {regions.map((name) => (
                  <option key={name} value={name}>
                    {name}
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
                onChange={(event) => update({ level: event.target.value })}
              >
                <option value="">All levels</option>
                {HOSPITAL_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {HOSPITAL_LEVEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Sort by">
            {({ id }) => (
              <Select
                id={id}
                value={sort}
                onChange={(event) => update({ sort: event.target.value })}
              >
                {origin && <option value="distance">Distance from you</option>}
                <option value="name">Name</option>
                <option value="readiness">Readiness (worst first)</option>
                <option value="region">Region</option>
                <option value="level">Facility level</option>
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Readiness
            </span>
            {READINESS_STATUSES.map((status) => (
              <Chip
                key={status}
                active={state.status === status}
                onClick={() => update({ status: state.status === status ? '' : status })}
                tone={status === 'green' ? 'success' : status === 'yellow' ? 'warning' : 'danger'}
                count={readinessQuery.data ? statusCounts[status] : undefined}
              >
                <StatusDot status={status} />
                {READINESS_LABELS[status]}
              </Chip>
            ))}
          </div>

          <div className="flex items-end sm:col-span-2">
            <Toggle
              checked={state.accepting}
              onChange={(next) => update({ accepting: next })}
              label="Accepting referrals only"
              description="Hide facilities currently on diversion."
            />
          </div>
        </FilterBarAdvanced>
      </FilterBar>

      {query.isPending ? (
        view === 'table' ? (
          <Card>
            <TableSkeleton />
          </Card>
        ) : (
          <CardGridSkeleton />
        )
      ) : query.isError ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : hospitals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No hospitals in the network yet"
            description="Once an administrator adds facilities they will appear here."
          />
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No hospitals match those filters"
            description="Try a wider search, or clear the filters to see the whole network."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : view === 'table' ? (
        <Card className="overflow-hidden">
          <Table responsive minWidth="56rem">
            <thead>
              <tr>
                <Th>Hospital</Th>
                <Th>Level</Th>
                <Th>Location</Th>
                <Th>Readiness</Th>
                {origin && <Th align="right">Distance</Th>}
                <Th>Status</Th>
                <Th align="right">Contact</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ hospital, distanceKm, readiness }) => (
                <tr
                  key={hospital.id}
                  className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <Td cell="identity">
                    <div className="flex items-center gap-3">
                      <HospitalLogo hospital={hospital} size="sm" />
                      <div className="min-w-0">
                        <Link
                          to={`/hospitals/${hospital.id}`}
                          className="block truncate font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {hospital.name}
                        </Link>
                        <span className="hint">{hospital.code}</span>
                      </div>
                      {hospital.id === ownHospital?.id && <Badge tone="brand">Yours</Badge>}
                    </div>
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-300">
                    {HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level}
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-300">
                    {[hospital.city, hospital.region].filter(Boolean).join(', ') || '-'}
                  </Td>
                  <Td>
                    {readiness === undefined ? (
                      <span className="hint">…</span>
                    ) : readiness === null || readiness.total === 0 ? (
                      <span className="hint">No departments</span>
                    ) : (
                      <StatusDot
                        status={readiness.status}
                        label={`${READINESS_LABELS[readiness.status]} · ${readiness.green}/${readiness.total}`}
                        pulse={readiness.status !== 'green'}
                      />
                    )}
                  </Td>
                  {origin && (
                    <Td align="right" className="tabular-nums text-slate-600 dark:text-slate-300">
                      {distanceKm === null ? '-' : formatDistance(distanceKm)}
                    </Td>
                  )}
                  <Td>
                    {hospital.accepts_referrals ? (
                      <Badge tone="success">Accepting</Badge>
                    ) : (
                      <Badge tone="danger">Diverting</Badge>
                    )}
                  </Td>
                  <Td align="right" cell="actions">
                    <div className="flex justify-end gap-1.5">
                      <CallLink phone={hospital.emergency_phone} label="Emergency" emergency />
                      <CallLink phone={hospital.phone} label="Call" />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <HospitalCard
              key={entry.hospital.id}
              hospital={entry.hospital}
              distanceKm={entry.distanceKm}
              readiness={entry.readiness}
              isOwn={entry.hospital.id === ownHospital?.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
