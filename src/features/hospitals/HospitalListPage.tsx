import { useMemo, useState } from 'react'
import { Building2, Search, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Toggle,
} from '@/components/ui'
import { haversineKm, isValidLatLng } from '@/domain/geo'
import { HOSPITAL_LEVELS, HOSPITAL_LEVEL_LABELS, type HospitalLevel } from '@/lib/constants'
import { unique } from '@/lib/utils'
import type { Hospital } from '@/lib/types'
import { HospitalCard } from './HospitalCard'
import { useHospitals } from './useHospitals'

interface DirectoryEntry {
  hospital: Hospital
  distanceKm: number | null
}

export default function HospitalListPage() {
  const { hospital: ownHospital } = useAuth()

  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('')
  const [level, setLevel] = useState('')
  const [acceptingOnly, setAcceptingOnly] = useState(false)

  // The whole active directory is small and filtering happens client-side so a
  // coordinator typing at 3am gets instant feedback instead of a request per key.
  const query = useHospitals({ onlyActive: true })
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
      unique(hospitals.map((hospital) => hospital.region).filter((value): value is string => !!value)).sort(
        (a, b) => a.localeCompare(b),
      ),
    [hospitals],
  )

  const entries = useMemo<DirectoryEntry[]>(() => {
    const term = search.trim().toLowerCase()

    const matched = hospitals.filter((hospital) => {
      if (region && hospital.region !== region) return false
      if (level && hospital.level !== level) return false
      if (acceptingOnly && !hospital.accepts_referrals) return false
      if (!term) return true
      return [hospital.name, hospital.code, hospital.city ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term)
    })

    const withDistance = matched.map<DirectoryEntry>((hospital) => ({
      hospital,
      distanceKm: origin && isValidLatLng(hospital) ? haversineKm(origin, hospital) : null,
    }))

    withDistance.sort((a, b) => {
      if (origin) {
        // Un-geocoded facilities cannot be ranked on proximity, so they trail.
        if (a.distanceKm === null && b.distanceKm !== null) return 1
        if (b.distanceKm === null && a.distanceKm !== null) return -1
        if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
          return a.distanceKm - b.distanceKm
        }
      }
      return a.hospital.name.localeCompare(b.hospital.name)
    })

    return withDistance
  }, [hospitals, search, region, level, acceptingOnly, origin])

  const filtersActive = Boolean(search || region || level || acceptingOnly)
  const clearFilters = () => {
    setSearch('')
    setRegion('')
    setLevel('')
    setAcceptingOnly(false)
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Hospital directory"
        description={
          origin && ownHospital
            ? `Sorted by distance from ${ownHospital.name}.`
            : 'Sorted by name. Add coordinates to your hospital to sort by distance.'
        }
      />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" className="sm:col-span-2 lg:col-span-1">
            {({ id, describedBy }) => (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="search"
                  className="pl-9"
                  placeholder="Name, code or city"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            )}
          </Field>

          <Field label="Region">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={region}
                onChange={(event) => setRegion(event.target.value)}
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
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              >
                <option value="">All levels</option>
                {HOSPITAL_LEVELS.map((value: HospitalLevel) => (
                  <option key={value} value={value}>
                    {HOSPITAL_LEVEL_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex items-end">
            <Toggle
              checked={acceptingOnly}
              onChange={setAcceptingOnly}
              label="Accepting referrals only"
              description="Hide facilities currently on diversion."
            />
          </div>
        </CardBody>
      </Card>

      {query.isPending ? (
        <Card>
          <LoadingBlock label="Loading hospitals" rows={5} />
        </Card>
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
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" aria-hidden />
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
              {entries.length} of {hospitals.length} hospitals
            </p>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" aria-hidden />
                Clear filters
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => (
              <HospitalCard
                key={entry.hospital.id}
                hospital={entry.hospital}
                distanceKm={entry.distanceKm}
                isOwn={entry.hospital.id === ownHospital?.id}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
