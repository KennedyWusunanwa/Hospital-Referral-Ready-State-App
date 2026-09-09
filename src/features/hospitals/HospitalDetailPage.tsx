import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Clock,
  MapPin,
  Pencil,
  Send,
  Stethoscope,
  Wind,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Stat,
  StatusDot,
} from '@/components/ui'
import { formatDistance, haversineKm, isValidLatLng } from '@/domain/geo'
import { ReadinessBoard } from '@/features/readiness/ReadinessBoard'
import { useHospitalReadiness, useHospitalResources } from '@/features/readiness/useReadiness'
import { HOSPITAL_LEVEL_LABELS, READINESS_LABELS } from '@/lib/constants'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import type { HospitalResources } from '@/lib/types'
import { BloodStockTable } from './BloodStockTable'
import { CallLink, EmailLink } from './HospitalContactLinks'
import { HospitalResourcePanel } from './HospitalResourcePanel'
import { useHospital } from './useHospitals'

const ACTION_LINK =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors'
const ACTION_PRIMARY = 'bg-brand-600 text-white hover:bg-brand-700'
const ACTION_OUTLINE =
  'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'

function capacityStat(available: number | null, total: number | null): string {
  if (available === null) return '-'
  return total && total > 0 ? `${available} / ${total}` : String(available)
}

function CapacityStats({ resources }: { resources: HospitalResources | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat
        label="ICU beds free"
        value={capacityStat(resources?.icu_beds_available ?? null, resources?.icu_beds_total ?? null)}
        sublabel="Available / total"
        icon={<Stethoscope className="h-4 w-4" />}
      />
      <Stat
        label="NICU cots free"
        value={capacityStat(
          resources?.nicu_beds_available ?? null,
          resources?.nicu_beds_total ?? null,
        )}
        sublabel="Available / total"
      />
      <Stat
        label="Ventilators free"
        value={capacityStat(
          resources?.ventilators_available ?? null,
          resources?.ventilators_total ?? null,
        )}
        sublabel="Available / total"
      />
      <Stat
        label="Theatres ready"
        value={capacityStat(
          resources?.operating_rooms_functional ?? null,
          resources?.operating_rooms_total ?? null,
        )}
        sublabel="Functional / total"
      />
      <Stat
        label="Oxygen supply"
        value={resources ? `${Math.round(resources.oxygen_supply_percent)}%` : '-'}
        sublabel="Of normal stock"
        icon={<Wind className="h-4 w-4" />}
      />
    </div>
  )
}

export default function HospitalDetailPage() {
  const { hospitalId } = useParams<{ hospitalId: string }>()
  const { hospital: ownHospital, role, can } = useAuth()

  const hospitalQuery = useHospital(hospitalId ?? null)
  const resourcesQuery = useHospitalResources(hospitalId ?? null)
  const readinessQuery = useHospitalReadiness(hospitalId ?? null)

  const backLink = (
    <Link
      to="/hospitals"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All hospitals
    </Link>
  )

  if (hospitalQuery.isPending) {
    return (
      <div className="space-y-4">
        {backLink}
        <Card>
          <LoadingBlock label="Loading hospital" rows={4} />
        </Card>
      </div>
    )
  }

  if (hospitalQuery.isError) {
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorBlock error={hospitalQuery.error} onRetry={() => void hospitalQuery.refetch()} />
      </div>
    )
  }

  const hospital = hospitalQuery.data
  if (!hospital) {
    return (
      <div className="space-y-4">
        {backLink}
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="Hospital not found"
            description="It may have been removed, or you may not have permission to view it."
          />
        </Card>
      </div>
    )
  }

  const resources = resourcesQuery.data ?? null
  const readiness = readinessQuery.data
  const isOwn = hospital.id === ownHospital?.id
  const levelLabel = HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level
  const place = [hospital.city, hospital.region, hospital.country].filter(Boolean).join(', ')

  const distanceKm =
    !isOwn && ownHospital && isValidLatLng(ownHospital) && isValidLatLng(hospital)
      ? haversineKm(
          { latitude: ownHospital.latitude, longitude: ownHospital.longitude },
          { latitude: hospital.latitude, longitude: hospital.longitude },
        )
      : null

  const canEditThisHospital =
    can('admin:hospital') && (role === 'super_admin' || ownHospital?.id === hospital.id)

  return (
    <div className="space-y-4 sm:space-y-6">
      {backLink}

      <PageHeader
        title={hospital.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-600 dark:text-slate-300">{hospital.code}</span>
            <span aria-hidden>&middot;</span>
            <span>{levelLabel}</span>
            {place && (
              <>
                <span aria-hidden>&middot;</span>
                <span>{place}</span>
              </>
            )}
            {distanceKm !== null && (
              <>
                <span aria-hidden>&middot;</span>
                <span>{formatDistance(distanceKm)} from your hospital</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            {!isOwn && can('referral:create') && (
              <Link to="/referrals/new" className={cn(ACTION_LINK, ACTION_PRIMARY)}>
                <Send className="h-4 w-4" aria-hidden />
                Refer a patient here
              </Link>
            )}
            {canEditThisHospital && (
              <Link to="/admin" className={cn(ACTION_LINK, ACTION_OUTLINE)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
            )}
          </>
        }
      />

      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        {readiness ? (
          <StatusDot
            status={readiness.status}
            label={`Readiness: ${READINESS_LABELS[readiness.status]}`}
            pulse={readiness.status !== 'green'}
          />
        ) : (
          <span className="hint">Readiness unavailable</span>
        )}
        {readiness && readiness.total > 0 && (
          <Badge tone="neutral">{readiness.green}/{readiness.total} departments current</Badge>
        )}
        {isOwn && <Badge tone="brand">Your hospital</Badge>}
        {!hospital.accepts_referrals && <Badge tone="danger">Not accepting referrals</Badge>}
        {resources && !resources.er_open && <Badge tone="danger">Emergency unit closed</Badge>}
        {resources && (
          <span className="ml-auto flex items-center gap-1.5 hint">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Resources updated {relativeTime(resources.updated_at)}
          </span>
        )}
      </Card>

      {resources && !resources.er_open && (
        <Alert tone="danger" title="Emergency unit on diversion">
          {resources.diversion_reason ??
            'This hospital has closed its emergency unit to new arrivals. Call before transferring.'}
        </Alert>
      )}

      {!hospital.accepts_referrals && (
        <Alert tone="warning" title="Not accepting referrals">
          This facility is flagged as unavailable for inbound referrals. It will not be ranked as a
          candidate until that is lifted.
        </Alert>
      )}

      {resourcesQuery.isError ? (
        <ErrorBlock error={resourcesQuery.error} onRetry={() => void resourcesQuery.refetch()} />
      ) : (
        <CapacityStats resources={resources} />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Resource snapshot
        </h2>
        <HospitalResourcePanel hospitalId={hospital.id} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <BloodStockTable hospitalId={hospital.id} />

        <Card className="print-block">
          <CardHeader title="Contact" description="Confirm by phone before every transfer." />
          <CardBody className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span>
                {hospital.address ? `${hospital.address}, ` : ''}
                {place || 'Address not recorded'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <CallLink
                phone={hospital.emergency_phone}
                label={`Emergency ${hospital.emergency_phone ?? ''}`.trim()}
                emergency
              />
              <CallLink phone={hospital.phone} />
              <EmailLink email={hospital.email} />
            </div>

            {!hospital.phone && !hospital.emergency_phone && !hospital.email && (
              <p className="hint">No contact details have been recorded for this hospital.</p>
            )}

            <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              <div>
                <dt className="hint">Timezone</dt>
                <dd className="text-slate-800 dark:text-slate-200">{hospital.timezone}</dd>
              </div>
              <div>
                <dt className="hint">Directory updated</dt>
                <dd className="text-slate-800 dark:text-slate-200">
                  {formatDateTime(hospital.updated_at, hospital.timezone)}
                </dd>
              </div>
            </dl>

            {hospital.notes && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                {hospital.notes}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Department readiness
        </h2>
        <ReadinessBoard hospitalId={hospital.id} />
      </section>
    </div>
  )
}
