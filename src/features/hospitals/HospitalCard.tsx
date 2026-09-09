import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Navigation } from 'lucide-react'
import { Badge, Card, Skeleton, StatusDot } from '@/components/ui'
import { formatDistance } from '@/domain/geo'
import { useHospitalReadiness } from '@/features/readiness/useReadiness'
import { HOSPITAL_LEVEL_LABELS, READINESS_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Hospital } from '@/lib/types'
import { CallLink } from './HospitalContactLinks'

export interface HospitalCardProps {
  hospital: Hospital
  /** Straight-line distance from the viewer's own hospital, when both are geocoded. */
  distanceKm: number | null
  isOwn: boolean
}

/** The rolled-up traffic light, always paired with words rather than colour alone. */
function ReadinessLine({ hospitalId }: { hospitalId: string }) {
  const readiness = useHospitalReadiness(hospitalId)

  if (readiness.isPending) return <Skeleton className="h-4 w-28" />

  if (readiness.isError || !readiness.data) {
    return <span className="hint">Readiness unavailable</span>
  }

  const { status, green, total } = readiness.data
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot status={status} label={READINESS_LABELS[status]} pulse={status !== 'green'} />
      <span className="hint">
        {total > 0 ? `${green}/${total} departments current` : 'No reporting departments'}
      </span>
    </span>
  )
}

export function HospitalCard({ hospital, distanceKm, isOwn }: HospitalCardProps) {
  const place = [hospital.city, hospital.region].filter(Boolean).join(', ')
  const levelLabel = HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level

  return (
    <Card
      className={cn(
        'flex flex-col p-4',
        isOwn && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Link
              to={`/hospitals/${hospital.id}`}
              className="hover:text-brand-700 hover:underline dark:hover:text-brand-400"
            >
              {hospital.name}
            </Link>
          </h3>
          <p className="mt-0.5 hint">
            {hospital.code} &middot; {levelLabel}
          </p>
        </div>
        {isOwn && (
          <Badge tone="brand" className="shrink-0">
            Your hospital
          </Badge>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <ReadinessLine hospitalId={hospital.id} />
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
