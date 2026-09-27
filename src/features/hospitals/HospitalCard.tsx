import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Navigation } from 'lucide-react'
import { Badge, Card, Skeleton, StatusDot } from '@/components/ui'
import { formatDistance } from '@/domain/geo'
import { HOSPITAL_LEVEL_LABELS, READINESS_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Hospital, HospitalReadinessSummary } from '@/lib/types'
import { CallLink } from './HospitalContactLinks'
import { HospitalLogo } from './HospitalLogo'

export interface HospitalCardProps {
  hospital: Hospital
  /** Straight-line distance from the viewer's own hospital, when both are geocoded. */
  distanceKm: number | null
  isOwn: boolean
  /**
   * The roll-up from `useNetworkReadiness`. `undefined` while loading; `null`
   * when the hospital has no departments configured.
   */
  readiness?: HospitalReadinessSummary | null
}

/** The rolled-up traffic light, always paired with words rather than colour alone. */
function ReadinessLine({ readiness }: { readiness: HospitalReadinessSummary | null | undefined }) {
  if (readiness === undefined) return <Skeleton className="h-4 w-28" />

  if (readiness === null || readiness.total === 0) {
    return <span className="hint">No reporting departments</span>
  }

  const { status, green, total } = readiness
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot status={status} label={READINESS_LABELS[status]} pulse={status !== 'green'} />
      <span className="hint">
        {green}/{total} departments current
      </span>
    </span>
  )
}

export function HospitalCard({ hospital, distanceKm, isOwn, readiness }: HospitalCardProps) {
  const place = [hospital.city, hospital.region].filter(Boolean).join(', ')
  const levelLabel = HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level

  return (
    <Card
      className={cn(
        'flex flex-col p-4 transition-shadow hover:shadow-md',
        isOwn &&
          'ring-2 ring-brand-500 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950',
      )}
    >
      <div className="flex items-start gap-3">
        <HospitalLogo hospital={hospital} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Link
                to={`/hospitals/${hospital.id}`}
                className="hover:text-brand-700 hover:underline dark:hover:text-brand-400"
              >
                {hospital.name}
              </Link>
            </h3>
            {isOwn && (
              <Badge tone="brand" className="shrink-0">
                Yours
              </Badge>
            )}
          </div>
          <p className="mt-0.5 hint">
            {hospital.code} &middot; {levelLabel}
          </p>
          {!hospital.is_active && (
            <Badge tone="neutral" className="mt-1">
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <ReadinessLine readiness={readiness} />
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{place || 'Location not recorded'}</span>
        </p>
        {distanceKm !== null && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {isOwn ? 'Where you are' : `${formatDistance(distanceKm)} away`}
          </p>
        )}
      </div>

      {!hospital.accepts_referrals && (
        <div className="mt-3">
          <Badge tone="danger">On diversion &ndash; not accepting referrals</Badge>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <CallLink phone={hospital.emergency_phone} label="Emergency" emergency />
        <CallLink phone={hospital.phone} label="Switchboard" />
        <Link
          to={`/hospitals/${hospital.id}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          Details
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  )
}
