import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ClipboardList,
  Flag,
  MapPin,
  Printer,
  Truck,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Meter,
  Modal,
  PageHeader,
  Select,
  StatusDot,
  Textarea,
} from '@/components/ui'
import {
  AGE_BAND_LABELS,
  READINESS_LABELS,
  REFERRAL_OUTCOMES,
  REFERRAL_OUTCOME_LABELS,
  REFERRAL_RESPONSE_TARGET_MINUTES,
  REFERRAL_STATUS_LABELS,
  RESOURCES,
  URGENCY_LABELS,
  type ReferralOutcome,
  type ReferralStatus,
} from '@/lib/constants'
import { formatDistance, formatDuration } from '@/domain/geo'
import { scoreBand, type ScoreSnapshot } from '@/domain/scoring'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { Json, ReferralWithRelations, ResourceScoreDetail } from '@/lib/types'
import { cn, formatDateTime, formatPercent, telHref } from '@/lib/utils'
import { useReferral, useUpdateReferralStatus } from '@/features/referrals/useReferrals'
import { ReferralStatusBadge, UrgencyBadge } from '@/features/referrals/ReferralStatusBadge'
import { CallLink } from '@/features/hospitals/HospitalContactLinks'
import { ReferralTimeline } from '@/features/referrals/ReferralTimeline'
import { MessageThread } from '@/features/messaging/MessageThread'

/** Which side of the transfer the signed-in user is on. */
type Side = 'requesting' | 'receiving' | 'observer'

type TransitionAction = 'accept' | 'decline' | 'in_transit' | 'complete' | 'cancel'

/**
 * Mirrors the `update_referral_status` state machine. A button is only offered
 * for a transition the RPC will actually accept from this viewer.
 */
function availableActions(status: ReferralStatus, side: Side): TransitionAction[] {
  if (side === 'observer') return []

  switch (status) {
    case 'pending':
      return side === 'receiving' ? ['accept', 'decline'] : ['cancel']
    case 'accepted':
      return side === 'requesting' ? ['in_transit', 'cancel'] : ['in_transit']
    case 'in_transit':
      return ['complete']
    default:
      return []
  }
}

export default function ReferralDetailPage() {
  const params = useParams<{ referralId: string }>()
  const referralId = params.referralId ?? null
  const navigate = useNavigate()
  const { profile, can, timezone } = useAuth()
  const { data: referral, isLoading, error, refetch } = useReferral(referralId)
  const updateStatus = useUpdateReferralStatus()

  const [modal, setModal] = useState<null | 'decline' | 'cancel' | 'complete'>(null)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<ReferralOutcome | ''>('')
  const [outcomeNotes, setOutcomeNotes] = useState('')

  useEffect(() => {
    setReason('')
    setOutcome('')
    setOutcomeNotes('')
  }, [modal])

  if (isLoading) {
    return (
      <Card>
        <LoadingBlock label="Loading referral" rows={5} />
      </Card>
    )
  }

  if (error) {
    return <ErrorBlock error={error} onRetry={() => void refetch()} />
  }

  if (!referralId || !referral) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" aria-hidden />}
          title="Referral not found"
          description="It may have been removed, or your hospital may no longer have access to it."
          action={
            <Link to="/referrals">
              <Button variant="outline" size="sm">
                Back to referrals
              </Button>
            </Link>
          }
        />
      </Card>
    )
  }

  const hospitalId = profile?.hospital_id ?? null
  const side: Side =
    hospitalId && referral.receiving_hospital_id === hospitalId
      ? 'receiving'
      : hospitalId && referral.requesting_hospital_id === hospitalId
        ? 'requesting'
        : 'observer'

  const actions = can('referral:respond') ? availableActions(referral.status, side) : []

  // Re-refer after a decline. The ranking already knew who was second, so the
  // coordinator should not have to retype a word of the case under pressure.
  const referElsewhere = () => {
    navigate('/referrals/new', {
      state: {
        prefill: {
          emergencyTypeId: referral.emergency_type_id,
          urgency: referral.urgency,
          patientRef: referral.patient_ref,
          ageBand: referral.patient_age_band,
          sex: referral.patient_sex,
          clinicalSummary: referral.clinical_summary,
          additionalRequired: referral.required_resources,
          excludeHospitalIds: referral.receiving_hospital_id
            ? [referral.receiving_hospital_id]
            : [],
          fromReferral: referral.id,
        },
      },
    })
  }
  const counterpart = side === 'receiving' ? referral.requesting_hospital : referral.receiving_hospital

  const hospitalNames: Record<string, string> = {}
  if (referral.requesting_hospital) {
    hospitalNames[referral.requesting_hospital.id] = referral.requesting_hospital.name
  }
  if (referral.receiving_hospital) {
    hospitalNames[referral.receiving_hospital.id] = referral.receiving_hospital.name
  }

  const runTransition = async (
    status: ReferralStatus,
    options?: { notes?: string; outcome?: ReferralOutcome },
  ) => {
    try {
      await updateStatus.mutateAsync({
        referralId,
        status,
        notes: options?.notes,
        outcome: options?.outcome,
      })
      toast.success(`Referral marked ${REFERRAL_STATUS_LABELS[status].toLowerCase()}.`)
      setModal(null)
    } catch (err) {
      toast.error(humanizeSupabaseError(err))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{referral.reference_number}</span>
            <ReferralStatusBadge status={referral.status} />
            <UrgencyBadge urgency={referral.urgency} />
          </span>
        }
        description={
          referral.emergency_type
            ? `${referral.emergency_type.name} - requested ${formatDateTime(referral.requested_at, timezone)}`
            : `Requested ${formatDateTime(referral.requested_at, timezone)}`
        }
        actions={
          <>
            <Link to="/referrals">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Referrals
              </Button>
            </Link>
            <Link to={`/referrals/${referralId}/form`}>
              <Button variant="outline" size="sm">
                <Printer className="h-4 w-4" aria-hidden />
                Print referral form
              </Button>
            </Link>
          </>
        }
      />

      <DirectionCard referral={referral} side={side} />

      {referral.status === 'pending' && <AwaitingResponse requestedAt={referral.requested_at} />}

      {referral.status === 'declined' && (
        <Alert tone="danger" title="Declined by the receiving facility">
          {referral.decline_reason && <p>{referral.decline_reason}</p>}
          {side === 'requesting' && can('referral:create') && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={referElsewhere}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                Refer to another hospital
              </Button>
              <span className="text-xs opacity-80">
                The case details carry over, and this facility is excluded from the new ranking.
              </span>
            </div>
          )}
        </Alert>
      )}

      {referral.status === 'completed' && referral.outcome && (
        <Alert tone="success" title={REFERRAL_OUTCOME_LABELS[referral.outcome]}>
          {referral.outcome_notes ?? 'Transfer closed.'}
        </Alert>
      )}

      {actions.length > 0 && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-slate-600 dark:text-slate-300">
              {side === 'receiving'
                ? 'You are the receiving facility.'
                : 'You are the referring facility.'}
            </p>

            {actions.includes('accept') && (
              <Button
                variant="success"
                loading={updateStatus.isPending}
                onClick={() => void runTransition('accepted')}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Accept referral
              </Button>
            )}

            {actions.includes('decline') && (
              <Button variant="danger" onClick={() => setModal('decline')}>
                <XCircle className="h-4 w-4" aria-hidden />
                Decline
              </Button>
            )}

            {actions.includes('in_transit') && (
              <Button
                variant="primary"
                loading={updateStatus.isPending}
                onClick={() => void runTransition('in_transit')}
              >
                <Truck className="h-4 w-4" aria-hidden />
                Mark in transit
              </Button>
            )}

            {actions.includes('complete') && (
              <Button variant="success" onClick={() => setModal('complete')}>
                <Flag className="h-4 w-4" aria-hidden />
                Mark completed
              </Button>
            )}

            {actions.includes('cancel') && (
              <Button variant="outline" onClick={() => setModal('cancel')}>
                <Ban className="h-4 w-4" aria-hidden />
                Cancel referral
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <CaseDetailsCard referral={referral} timezone={timezone} />
          <ContactCard referral={referral} side={side} />
          <ScoreSnapshotCard
            snapshot={referral.score_snapshot}
            candidates={referral.candidate_snapshot}
            distanceKm={referral.distance_km}
            etaMinutes={referral.eta_minutes}
            timezone={timezone}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <MessageThread
            referralId={referralId}
            status={referral.status}
            counterpartName={counterpart?.name ?? null}
            counterpartPhone={counterpart?.emergency_phone ?? counterpart?.phone ?? null}
          />
          <ReferralTimeline referralId={referralId} hospitalNames={hospitalNames} />
        </div>
      </div>

      <Modal
        open={modal === 'decline'}
        onClose={() => setModal(null)}
        title="Decline this referral"
        description="The referring team sees this reason immediately, so make it actionable."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Keep pending
            </Button>
            <Button
              variant="danger"
              loading={updateStatus.isPending}
              disabled={reason.trim().length === 0}
              onClick={() => void runTransition('declined', { notes: reason.trim() })}
            >
              Decline referral
            </Button>
          </>
        }
      >
        <Field
          label="Reason for declining"
          required
          hint="For example: no ICU bed until the morning shift; theatre in use."
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why can this facility not receive the patient?"
            />
          )}
        </Field>
      </Modal>

      <Modal
        open={modal === 'cancel'}
        onClose={() => setModal(null)}
        title="Cancel this referral"
        description="The receiving facility is notified and stops holding the resource."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Keep referral
            </Button>
            <Button
              variant="danger"
              loading={updateStatus.isPending}
              onClick={() =>
                void runTransition('cancelled', { notes: reason.trim() || undefined })
              }
            >
              Cancel referral
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: patient stabilised and no longer needs transfer."
            />
          )}
        </Field>
      </Modal>

      <Modal
        open={modal === 'complete'}
        onClose={() => setModal(null)}
        title="Close this transfer"
        description="The outcome is what the reports measure, so record what actually happened."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Not yet
            </Button>
            <Button
              variant="success"
              loading={updateStatus.isPending}
              disabled={outcome === ''}
              onClick={() =>
                void runTransition('completed', {
                  outcome: outcome === '' ? undefined : outcome,
                  notes: outcomeNotes.trim() || undefined,
                })
              }
            >
              Mark completed
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Outcome" required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as ReferralOutcome | '')}
              >
                <option value="">Select an outcome</option>
                {REFERRAL_OUTCOMES.map((value) => (
                  <option key={value} value={value}>
                    {REFERRAL_OUTCOME_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Notes (optional)" hint="No patient identifiers.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                value={outcomeNotes}
                onChange={(event) => setOutcomeNotes(event.target.value)}
                placeholder="Handover time, receiving unit, anything the audit should know."
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function DirectionCard({ referral, side }: { referral: ReferralWithRelations; side: Side }) {
  return (
    <Card>
      <CardBody className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <HospitalBlock
          label="Referring facility"
          hospital={referral.requesting_hospital}
          isYou={side === 'requesting'}
        />
        <div className="flex items-center justify-center">
          <ArrowRight
            className="hidden h-6 w-6 text-slate-300 sm:block dark:text-slate-600"
            aria-hidden
          />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:hidden">
            transfers to
          </span>
        </div>
        <HospitalBlock
          label="Receiving facility"
          hospital={referral.receiving_hospital}
          isYou={side === 'receiving'}
        />
      </CardBody>
    </Card>
  )
}

function HospitalBlock({
  label,
  hospital,
  isYou,
}: {
  label: string
  hospital: ReferralWithRelations['requesting_hospital']
  isYou: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        {hospital?.name ?? 'Not assigned'}
        {isYou && <Badge tone="brand">Your facility</Badge>}
      </p>
      {hospital && (
        <p className="mt-0.5 hint">
          {[hospital.code, hospital.city, hospital.region].filter(Boolean).join(' - ')}
        </p>
      )}
    </div>
  )
}

/** Live "awaiting response" clock, escalating past the response target. */
function AwaitingResponse({ requestedAt }: { requestedAt: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const minutes = Math.max(0, Math.floor((now - new Date(requestedAt).getTime()) / 60000))
  const breached = minutes >= REFERRAL_RESPONSE_TARGET_MINUTES
  const severe = minutes >= REFERRAL_RESPONSE_TARGET_MINUTES * 2

  return (
    <Alert
      tone={severe ? 'danger' : breached ? 'warning' : 'info'}
      title={`Awaiting response for ${minutes} min`}
    >
      <p className="flex items-center gap-1.5">
        {breached && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
        {severe
          ? `Well past the ${REFERRAL_RESPONSE_TARGET_MINUTES} minute target. Call the receiving facility now.`
          : breached
            ? `Past the ${REFERRAL_RESPONSE_TARGET_MINUTES} minute target. Consider calling or picking the next hospital.`
            : `Target response time is ${REFERRAL_RESPONSE_TARGET_MINUTES} minutes.`}
      </p>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Body cards
// ---------------------------------------------------------------------------

function CaseDetailsCard({
  referral,
  timezone,
}: {
  referral: ReferralWithRelations
  timezone: string
}) {
  return (
    <Card>
      <CardHeader
        title="Case details"
        description="Anonymous by design - no patient identifiers are stored."
      />
      <CardBody className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <DetailItem label="Patient reference" value={referral.patient_ref} mono />
          <DetailItem label="Age band" value={AGE_BAND_LABELS[referral.patient_age_band]} />
          <DetailItem label="Sex" value={capitalise(referral.patient_sex)} />
          <DetailItem label="Emergency type" value={referral.emergency_type?.name ?? 'Unknown'} />
          <DetailItem label="Urgency" value={URGENCY_LABELS[referral.urgency]} />
          <DetailItem
            label="Requested by"
            value={referral.requested_by_profile?.full_name ?? 'Unknown'}
            sub={formatDateTime(referral.requested_at, timezone)}
          />
          {referral.responded_at && (
            <DetailItem
              label="Responded by"
              value={referral.responded_by_profile?.full_name ?? 'Unknown'}
              sub={formatDateTime(referral.responded_at, timezone)}
            />
          )}
          <DetailItem
            label="Transport estimate"
            value={
              referral.distance_km !== null
                ? formatDistance(referral.distance_km)
                : 'Distance unknown'
            }
            sub={
              referral.eta_minutes !== null
                ? `Estimated ${formatDuration(referral.eta_minutes)} door to door`
                : undefined
            }
          />
        </dl>

        <Divider />

        <div>
          <p className="field-label">Clinical summary</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
            {referral.clinical_summary}
          </p>
        </div>

        {referral.required_resources.length > 0 && (
          <div>
            <p className="field-label">Resources required</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {referral.required_resources.map((key) => (
                <Badge key={key} tone="brand">
                  {RESOURCES[key]?.label ?? key}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ContactCard({ referral, side }: { referral: ReferralWithRelations; side: Side }) {
  // An observer (a system administrator) is shown the receiving facility, the
  // one that has to be chased when a transfer stalls.
  const hospital = side === 'receiving' ? referral.requesting_hospital : referral.receiving_hospital
  const title = side === 'receiving' ? 'Referring facility contact' : 'Receiving facility contact'

  if (!hospital) {
    return (
      <Card>
        <CardHeader title={title} />
        <EmptyState
          icon={<Building2 className="h-8 w-8" aria-hidden />}
          title="No facility assigned"
          description="This referral has no counterpart hospital recorded."
        />
      </Card>
    )
  }

  const hasPhone = Boolean(telHref(hospital.emergency_phone) || telHref(hospital.phone))

  return (
    <Card>
      <CardHeader title={title} description={hospital.name} />
      <CardBody className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          {[hospital.city, hospital.region].filter(Boolean).join(', ') || 'Location not recorded'}
        </p>

        <div className="flex flex-wrap gap-2">
          <CallLink
            phone={hospital.emergency_phone}
            label={`Emergency ${hospital.emergency_phone ?? ''}`}
            emergency
          />
          <CallLink phone={hospital.phone} label={`Switchboard ${hospital.phone ?? ''}`} />
          {!hasPhone && (
            <p className="hint">No phone number on record. Use the chat thread instead.</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function ScoreSnapshotCard({
  snapshot,
  candidates,
  distanceKm,
  etaMinutes,
  timezone,
}: {
  snapshot: Json
  candidates: Json
  distanceKm: number | null
  etaMinutes: number | null
  timezone: string
}) {
  const parsed = useMemo(() => parseScoreSnapshot(snapshot), [snapshot])
  const alternatives = useMemo(() => parseCandidateSnapshot(candidates), [candidates])

  if (!parsed) {
    return (
      <Card>
        <CardHeader title="Referral score" />
        <CardBody>
          <p className="hint">
            No score was recorded for this referral. Distance was{' '}
            {distanceKm !== null ? formatDistance(distanceKm) : 'not captured'}
            {etaMinutes !== null ? `, estimated ${formatDuration(etaMinutes)}.` : '.'}
          </p>
        </CardBody>
      </Card>
    )
  }

  const selected = parsed.selected
  const band = scoreBand(selected.score)
  const tone = band === 'strong' ? 'success' : band === 'moderate' ? 'warning' : 'danger'

  return (
    <Card>
      <CardHeader
        title="Referral score at the time of request"
        description={`Computed ${formatDateTime(parsed.scored_at, timezone)} - shown as recorded, not recalculated.`}
      />
      <CardBody className="space-y-5">
        <div className="flex items-end gap-4">
          <p className="text-4xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatPercent(selected.score, 1)}
          </p>
          <div className="flex-1 pb-2">
            <Meter value={selected.score} tone={tone} label="Referral score" />
            <p className="mt-1 hint">
              Resources {formatPercent(selected.resource_score, 0)} at{' '}
              {Math.round(parsed.config.resourceWeight * 100)}% - proximity{' '}
              {formatPercent(selected.proximity_score, 0)} at{' '}
              {Math.round(parsed.config.proximityWeight * 100)}%
              {selected.penalty > 0 && ` - readiness penalty -${selected.penalty.toFixed(1)} pts`}
            </p>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <DetailItem
            label="Readiness then"
            value={
              <StatusDot
                status={selected.readiness}
                label={READINESS_LABELS[selected.readiness]}
              />
            }
          />
          <DetailItem label="Distance" value={formatDistance(selected.distance_km)} />
          <DetailItem label="Estimated transfer" value={formatDuration(selected.eta_minutes)} />
        </dl>

        {selected.breakdown.length > 0 && (
          <div>
            <p className="field-label">Resource breakdown</p>
            <ul className="mt-2 space-y-3">
              {selected.breakdown.map((detail) => (
                <BreakdownRow key={detail.key} detail={detail} />
              ))}
            </ul>
          </div>
        )}

        {alternatives.length > 1 && (
          <div>
            <p className="field-label">Alternatives considered</p>
            <ul className="mt-2 divide-y divide-slate-200 text-sm dark:divide-slate-800">
              {alternatives.map((candidate) => (
                <li
                  key={candidate.hospital_id}
                  className="flex items-center justify-between gap-3 py-1.5"
                >
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                    {candidate.rank}. {candidate.name}
                    {!candidate.eligible && (
                      <span className="ml-2 text-xs text-red-600 dark:text-red-400">
                        excluded{candidate.exclusions[0] ? `: ${candidate.exclusions[0]}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                    {formatPercent(candidate.score, 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function BreakdownRow({ detail }: { detail: ResourceScoreDetail }) {
  const percent = Math.round(detail.availability * 100)
  const tone = detail.blocking ? 'danger' : percent >= 70 ? 'success' : percent > 0 ? 'warning' : 'danger'

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 text-slate-700 dark:text-slate-200">
          {detail.label}
          {detail.isCritical && (
            <Badge tone={detail.blocking ? 'danger' : 'neutral'} className="ml-2">
              {detail.blocking ? 'Requirement not met' : 'Critical'}
            </Badge>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
          {describeValue(detail)}
        </span>
      </div>
      <Meter value={percent} tone={tone} className="mt-1.5" label={`${detail.label} availability`} />
    </li>
  )
}

function describeValue(detail: ResourceScoreDetail): string {
  if (typeof detail.value === 'boolean') return detail.value ? 'Available' : 'Not available'
  const unit = RESOURCES[detail.key]?.unit
  if (detail.capacity !== null && detail.capacity !== undefined) {
    return `${detail.value} / ${detail.capacity}${unit ? ` ${unit}` : ''}`
  }
  return unit === '%' ? `${detail.value}%` : `${detail.value}${unit ? ` ${unit}` : ''}`
}

function DetailItem({
  label,
  value,
  sub,
  mono,
}: {
  label: string
  value: ReactNode
  sub?: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-sm text-slate-900 dark:text-slate-100',
          mono && 'font-mono tracking-tight',
        )}
      >
        {value}
      </dd>
      {sub && <p className="hint">{sub}</p>}
    </div>
  )
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ---------------------------------------------------------------------------
// Snapshot readers
// ---------------------------------------------------------------------------

/**
 * The snapshot is written once, by the version of the scoring engine that ran
 * at referral time, so it is read defensively and never re-scored.
 */
export function parseScoreSnapshot(value: Json | null | undefined): ScoreSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const selected = record.selected
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return null
  const selectedRecord = selected as Record<string, unknown>
  if (typeof selectedRecord.score !== 'number') return null
  if (!Array.isArray(selectedRecord.breakdown)) return null
  if (typeof record.scored_at !== 'string') return null
  return value as unknown as ScoreSnapshot
}

export interface CandidateSnapshotEntry {
  hospital_id: string
  name: string
  score: number
  distance_km: number
  eta_minutes: number
  eligible: boolean
  exclusions: string[]
  rank: number
}

export function parseCandidateSnapshot(value: Json | null | undefined): CandidateSnapshotEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.name !== 'string' || typeof record.score !== 'number') return []
    return [
      {
        hospital_id: typeof record.hospital_id === 'string' ? record.hospital_id : record.name,
        name: record.name,
        score: record.score,
        distance_km: typeof record.distance_km === 'number' ? record.distance_km : 0,
        eta_minutes: typeof record.eta_minutes === 'number' ? record.eta_minutes : 0,
        eligible: record.eligible !== false,
        exclusions: Array.isArray(record.exclusions)
          ? record.exclusions.filter((item): item is string => typeof item === 'string')
          : [],
        rank: typeof record.rank === 'number' ? record.rank : 0,
      },
    ]
  })
}
