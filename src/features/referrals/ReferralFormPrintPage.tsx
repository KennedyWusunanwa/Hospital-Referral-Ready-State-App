import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Button, Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui'
import {
  AGE_BAND_LABELS,
  APP_NAME,
  HOSPITAL_LEVEL_LABELS,
  REFERRAL_OUTCOME_LABELS,
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  RESOURCES,
  URGENCY_LABELS,
  type ReferralStatus,
} from '@/lib/constants'
import { formatDistance, formatDuration } from '@/domain/geo'
import type { Hospital, ReferralEvent, ReferralWithRelations } from '@/lib/types'
import { formatDateTime, formatPercent } from '@/lib/utils'
import { parseScoreSnapshot } from '@/features/referrals/ReferralDetailPage'
import { useReferral, useReferralEvents } from '@/features/referrals/useReferrals'
import { useHospital } from '@/features/hospitals/useHospitals'

/**
 * The printed form is a paper record that gets signed and filed, so it is
 * deliberately a fixed white A4 document rather than a themed app surface.
 */
export default function ReferralFormPrintPage() {
  const params = useParams<{ referralId: string }>()
  const referralId = params.referralId ?? null
  const { timezone } = useAuth()

  const { data: referral, isLoading, error, refetch } = useReferral(referralId)
  const { data: events } = useReferralEvents(referralId)
  const { data: referringHospital } = useHospital(referral?.requesting_hospital_id ?? null)
  const { data: receivingHospital } = useHospital(referral?.receiving_hospital_id ?? null)

  const generatedAt = formatDateTime(new Date(), timezone)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <LoadingBlock label="Loading referral form" rows={6} />
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      </div>
    )
  }

  if (!referralId || !referral) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <EmptyState
            title="Referral not found"
            description="This referral is not available to your account."
            action={
              <Link to="/referrals">
                <Button variant="outline" size="sm">
                  Back to referrals
                </Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  const snapshot = parseScoreSnapshot(referral.score_snapshot)

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0 dark:bg-slate-950">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4">
        <Link to={`/referrals/${referralId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to referral
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          Print this form
        </Button>
      </div>

      <article className="mx-auto w-full max-w-[210mm] bg-white p-8 text-slate-900 shadow-sm print:p-0 print:shadow-none">
        <Letterhead
          hospital={referringHospital ?? null}
          fallbackName={referral.requesting_hospital?.name ?? 'Referring facility'}
          referral={referral}
          generatedAt={generatedAt}
        />

        <Section title="Receiving facility" className="print-block">
          <FacilityBlock
            hospital={receivingHospital ?? null}
            fallbackName={referral.receiving_hospital?.name ?? 'Not assigned'}
            fallbackPhone={referral.receiving_hospital?.emergency_phone ?? null}
          />
        </Section>

        <Section title="Patient and case details" className="print-block">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Patient reference" value={referral.patient_ref} />
            <Row label="Age band" value={AGE_BAND_LABELS[referral.patient_age_band]} />
            <Row label="Sex" value={capitalise(referral.patient_sex)} />
            <Row label="Emergency type" value={referral.emergency_type?.name ?? '-'} />
            <Row label="Urgency" value={URGENCY_LABELS[referral.urgency]} />
            <Row
              label="Distance / transfer time"
              value={
                referral.distance_km !== null
                  ? `${formatDistance(referral.distance_km)}${
                      referral.eta_minutes !== null
                        ? ` / ${formatDuration(referral.eta_minutes)}`
                        : ''
                    }`
                  : '-'
              }
            />
          </dl>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Clinical summary
            </p>
            <p className="mt-1 whitespace-pre-wrap border border-slate-300 p-3 text-sm leading-relaxed">
              {referral.clinical_summary}
            </p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Resources required at the receiving facility
            </p>
            <p className="mt-1 text-sm">
              {referral.required_resources.length > 0
                ? referral.required_resources
                    .map((key) => RESOURCES[key]?.label ?? key)
                    .join(', ')
                : 'None specified'}
            </p>
          </div>
        </Section>

        <Section title="Referral assessment" className="print-block">
          {snapshot ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Row label="Referral score" value={formatPercent(snapshot.selected.score, 1)} />
              <Row label="Computed" value={formatDateTime(snapshot.scored_at, timezone)} />
              <Row
                label="Resource availability"
                value={formatPercent(snapshot.selected.resource_score, 0)}
              />
              <Row label="Proximity" value={formatPercent(snapshot.selected.proximity_score, 0)} />
              <Row
                label="Readiness at the time"
                value={capitalise(snapshot.selected.readiness)}
              />
              <Row
                label="Readiness penalty"
                value={
                  snapshot.selected.penalty > 0
                    ? `-${snapshot.selected.penalty.toFixed(1)} points`
                    : 'None'
                }
              />
            </dl>
          ) : (
            <p className="text-sm">No score was recorded for this referral.</p>
          )}
        </Section>

        <Section title="Transfer status" className="print-block">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Current status" value={REFERRAL_STATUS_LABELS[referral.status]} />
            <Row label="Requested" value={formatDateTime(referral.requested_at, timezone)} />
            <Row
              label="Responded"
              value={
                referral.responded_at ? formatDateTime(referral.responded_at, timezone) : 'Awaiting'
              }
            />
            <Row
              label="Outcome"
              value={referral.outcome ? REFERRAL_OUTCOME_LABELS[referral.outcome] : '-'}
            />
          </dl>

          {referral.decline_reason && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Decline reason:</span> {referral.decline_reason}
            </p>
          )}

          <TimelineTable events={events ?? []} timezone={timezone} />
        </Section>

        <Section title="Signatures" className="print-block">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <SignatureLine role="Referring clinician" />
            <SignatureLine role="Transferring officer" />
            <SignatureLine role="Receiving clinician" />
          </div>
        </Section>

        <footer className="mt-8 border-t border-slate-300 pt-3 text-[11px] leading-relaxed text-slate-500">
          <p>
            Generated by {APP_NAME} on {generatedAt}. Reference {referral.reference_number}.
          </p>
          <p>
            This form carries no patient identifiers by design. Attach it to the patient notes and
            file a copy at both facilities.
          </p>
        </footer>
      </article>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Letterhead({
  hospital,
  fallbackName,
  referral,
  generatedAt,
}: {
  hospital: Hospital | null
  fallbackName: string
  referral: ReferralWithRelations
  generatedAt: string
}) {
  return (
    <header className="print-block flex items-start justify-between gap-8 border-b-2 border-slate-900 pb-4">
      <div className="min-w-0">
        <h1 className="text-lg font-bold uppercase tracking-wide">
          {hospital?.name ?? fallbackName}
        </h1>
        {hospital && (
          <p className="mt-0.5 text-xs text-slate-600">
            {HOSPITAL_LEVEL_LABELS[hospital.level]}
            {hospital.code ? ` - ${hospital.code}` : ''}
          </p>
        )}
        <address className="mt-2 space-y-0.5 text-xs not-italic text-slate-700">
          {hospital?.address && <p>{hospital.address}</p>}
          <p>
            {[hospital?.city, hospital?.region, hospital?.country].filter(Boolean).join(', ') ||
              'Address not recorded'}
          </p>
          {hospital?.phone && <p>Tel {hospital.phone}</p>}
          {hospital?.emergency_phone && <p>Emergency {hospital.emergency_phone}</p>}
          {hospital?.email && <p>{hospital.email}</p>}
        </address>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-bold uppercase tracking-wider">Inter-hospital referral</p>
        <p className="mt-1 font-mono text-base font-semibold">{referral.reference_number}</p>
        <p className="mt-1 text-xs text-slate-600">Generated {generatedAt}</p>
        <p className="mt-2 inline-block border border-slate-900 px-2 py-0.5 text-xs font-semibold uppercase">
          {URGENCY_LABELS[referral.urgency]}
        </p>
      </div>
    </header>
  )
}

function FacilityBlock({
  hospital,
  fallbackName,
  fallbackPhone,
}: {
  hospital: Hospital | null
  fallbackName: string
  fallbackPhone: string | null
}) {
  return (
    <div className="text-sm">
      <p className="font-semibold">{hospital?.name ?? fallbackName}</p>
      {hospital && (
        <p className="text-xs text-slate-600">
          {HOSPITAL_LEVEL_LABELS[hospital.level]}
          {hospital.code ? ` - ${hospital.code}` : ''}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-700">
        {[hospital?.address, hospital?.city, hospital?.region].filter(Boolean).join(', ') ||
          'Address not recorded'}
      </p>
      <p className="mt-1 text-xs text-slate-700">
        Tel {hospital?.phone ?? '-'}
        {' | '}
        Emergency {hospital?.emergency_phone ?? fallbackPhone ?? '-'}
      </p>
    </div>
  )
}

function TimelineTable({ events, timezone }: { events: ReferralEvent[]; timezone: string }) {
  if (events.length === 0) {
    return <p className="mt-3 text-sm text-slate-600">No status changes recorded yet.</p>
  }

  return (
    <table className="mt-4 w-full border-collapse text-xs">
      <caption className="sr-only">Referral timeline</caption>
      <thead>
        <tr className="border-b border-slate-400 text-left">
          <th scope="col" className="py-1 pr-3 font-semibold">
            Time
          </th>
          <th scope="col" className="py-1 pr-3 font-semibold">
            Event
          </th>
          <th scope="col" className="py-1 font-semibold">
            Notes
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className="border-b border-slate-200 align-top">
            <td className="py-1 pr-3 tabular-nums">{formatDateTime(event.created_at, timezone)}</td>
            <td className="py-1 pr-3">{describeEvent(event)}</td>
            <td className="py-1">{event.notes ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SignatureLine({ role }: { role: string }) {
  return (
    <div className="text-xs">
      <div className="mt-10 border-t border-slate-900 pt-1">
        <p className="font-semibold">{role}</p>
        <p className="mt-3 text-slate-600">Name: ______________________</p>
        <p className="mt-2 text-slate-600">Date / time: ________________</p>
      </div>
    </div>
  )
}

function Section({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className}>
      <h2 className="mt-6 border-b border-slate-300 pb-1 text-xs font-bold uppercase tracking-widest text-slate-600">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

function describeEvent(event: ReferralEvent): string {
  const to = event.to_status
  if (to && (REFERRAL_STATUSES as readonly string[]).includes(to)) {
    return REFERRAL_STATUS_LABELS[to as ReferralStatus]
  }
  const text = event.event_type.replace(/[._]/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
