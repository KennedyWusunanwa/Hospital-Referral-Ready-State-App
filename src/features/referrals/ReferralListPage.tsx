import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Inbox,
  Layers,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { Gate } from '@/auth/RequireAuth'
import { ListSkeleton } from '@/components/ui/skeletons'
import { useAuth, useCurrentHospitalId } from '@/auth/AuthProvider'
import {
  Button,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  FilterBar,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Textarea,
} from '@/components/ui'
import {
  REFERRAL_STATUSES,
  REFERRAL_STATUS_LABELS,
  URGENCY_LABELS,
  URGENCY_LEVELS,
} from '@/lib/constants'
import type { ReferralStatus, UrgencyLevel } from '@/lib/constants'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { ReferralWithRelations } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { cn, downloadCsv, formatDateTime, isReferralOverdue, toCsv } from '@/lib/utils'
import { ReferralCard } from './ReferralCard'
import {
  referralScore,
  useEmergencyTypes,
  useReferrals,
  useReferralRealtime,
  useUpdateReferralStatus,
} from './useReferrals'

type DirectionTab = 'incoming' | 'outgoing' | 'all'
type SortKey = 'newest' | 'oldest' | 'urgency' | 'waiting'

const FILTER_DEFAULTS = {
  q: '',
  tab: 'incoming',
  status: [] as string[],
  urgency: 'all',
  type: 'all',
  hospital: '',
  from: '',
  to: '',
  sort: 'newest',
}

const URGENCY_ORDER: Record<UrgencyLevel, number> = { critical: 0, urgent: 1, routine: 2 }

/** `<input type="date">` gives a local calendar day; widen it to a full day. */
function dayStartIso(day: string): string | undefined {
  if (!day) return undefined
  const date = new Date(`${day}T00:00:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function dayEndIso(day: string): string | undefined {
  if (!day) return undefined
  const date = new Date(`${day}T23:59:59.999`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export default function ReferralListPage() {
  const { can } = useAuth()
  const hospitalId = useCurrentHospitalId()
  useReferralRealtime(hospitalId)

  // Relative times and the overdue threshold are time-dependent; re-render on a
  // slow tick rather than leaving "2 min ago" frozen on a wall-mounted screen.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const [moreOpen, setMoreOpen] = useState(false)

  const statuses = state.status as ReferralStatus[]
  const sort = state.sort as SortKey

  const emergencyTypes = useEmergencyTypes()

  // The direction split is done client-side so every tab shows a live count
  // from one fetch; status and date range are cheap enough to push to Postgres.
  const referrals = useReferrals({
    hospitalId,
    direction: 'all',
    status: statuses.length > 0 ? statuses : undefined,
    from: dayStartIso(state.from),
    to: dayEndIso(state.to),
  })

  const updateStatus = useUpdateReferralStatus()
  const [declining, setDeclining] = useState<ReferralWithRelations | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const directionOf = (referral: ReferralWithRelations): 'incoming' | 'outgoing' =>
    hospitalId && referral.receiving_hospital_id === hospitalId ? 'incoming' : 'outgoing'

  /** Hospitals that appear on the loaded referrals, for the counterpart filter. */
  const counterparts = useMemo(() => {
    const seen = new Map<string, string>()
    for (const referral of referrals.data ?? []) {
      for (const hospital of [referral.requesting_hospital, referral.receiving_hospital]) {
        if (hospital && hospital.id !== hospitalId) seen.set(hospital.id, hospital.name)
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [referrals.data, hospitalId])

  const filtered = useMemo(() => {
    const rows = referrals.data ?? []
    const needle = state.q.trim().toLowerCase()

    return rows.filter((referral) => {
      if (state.urgency !== 'all' && referral.urgency !== state.urgency) return false
      if (state.type !== 'all' && referral.emergency_type_id !== state.type) return false
      if (
        state.hospital &&
        referral.requesting_hospital_id !== state.hospital &&
        referral.receiving_hospital_id !== state.hospital
      ) {
        return false
      }
      if (needle) {
        const haystack = [
          referral.reference_number,
          referral.patient_ref,
          referral.clinical_summary,
          referral.emergency_type?.name ?? '',
          referral.requesting_hospital?.name ?? '',
          referral.receiving_hospital?.name ?? '',
          referral.requested_by_profile?.full_name ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [referrals.data, state.q, state.urgency, state.type, state.hospital])

  const buckets = useMemo(() => {
    const incoming: ReferralWithRelations[] = []
    const outgoing: ReferralWithRelations[] = []
    for (const referral of filtered) {
      if (directionOf(referral) === 'incoming') incoming.push(referral)
      else outgoing.push(referral)
    }

    const requestedAt = (referral: ReferralWithRelations) =>
      new Date(referral.requested_at).getTime()
    const byNewest = (a: ReferralWithRelations, b: ReferralWithRelations) =>
      requestedAt(b) - requestedAt(a)

    const comparator = (a: ReferralWithRelations, b: ReferralWithRelations): number => {
      switch (sort) {
        case 'oldest':
          return requestedAt(a) - requestedAt(b)
        case 'urgency':
          return URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || byNewest(a, b)
        case 'waiting': {
          // Unanswered first, longest wait at the top.
          const aOpen = a.status === 'pending' ? 0 : 1
          const bOpen = b.status === 'pending' ? 0 : 1
          return aOpen - bOpen || requestedAt(a) - requestedAt(b)
        }
        default:
          return byNewest(a, b)
      }
    }

    // Newest first everywhere, but an unanswered incoming referral is the whole
    // point of the screen, so float the overdue ones above the rest.
    const overdueFirst = (a: ReferralWithRelations, b: ReferralWithRelations) => {
      const aOverdue = a.status === 'pending' && isReferralOverdue(a.requested_at, now)
      const bOverdue = b.status === 'pending' && isReferralOverdue(b.requested_at, now)
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      return comparator(a, b)
    }

    return {
      incoming: [...incoming].sort(sort === 'newest' ? overdueFirst : comparator),
      outgoing: [...outgoing].sort(comparator),
      all: [...filtered].sort(comparator),
    }
  }, [filtered, hospitalId, now, sort])

  // A super_admin has no home hospital, so the direction split is meaningless.
  const activeTab: DirectionTab = hospitalId ? (state.tab as DirectionTab) : 'all'
  const visible = buckets[activeTab]
  const overdueCount = buckets.incoming.filter(
    (referral) => referral.status === 'pending' && isReferralOverdue(referral.requested_at, now),
  ).length

  const activeFilters =
    (state.q ? 1 : 0) +
    (statuses.length > 0 ? 1 : 0) +
    (state.urgency !== 'all' ? 1 : 0) +
    (state.type !== 'all' ? 1 : 0) +
    (state.hospital ? 1 : 0) +
    (state.from ? 1 : 0) +
    (state.to ? 1 : 0)
  const hasFilters = activeFilters > 0

  function toggleStatus(status: ReferralStatus) {
    update({
      status: statuses.includes(status)
        ? statuses.filter((value) => value !== status)
        : [...statuses, status],
    })
  }

  function clearFilters() {
    reset(['tab', 'sort'])
  }

  async function respond(
    referral: ReferralWithRelations,
    status: ReferralStatus,
    notes?: string,
  ): Promise<void> {
    setBusyId(referral.id)
    try {
      await updateStatus.mutateAsync({ referralId: referral.id, status, notes })
      toast.success(
        status === 'accepted'
          ? `Referral ${referral.reference_number} accepted.`
          : `Referral ${referral.reference_number} declined.`,
      )
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDecline() {
    if (!declining) return
    const reason = declineReason.trim()
    if (reason.length < 5) {
      toast.error('Please give the referring hospital a reason.')
      return
    }
    const referral = declining
    setDeclining(null)
    setDeclineReason('')
    await respond(referral, 'declined', reason)
  }

  async function exportCsv() {
    if (visible.length === 0) {
      toast.error('There is nothing to export with these filters.')
      return
    }

    const rows = visible.map((referral) => ({
      reference: referral.reference_number,
      direction: directionOf(referral),
      status: REFERRAL_STATUS_LABELS[referral.status],
      urgency: referral.urgency,
      emergency_type: referral.emergency_type?.name ?? '',
      referring_hospital: referral.requesting_hospital?.name ?? '',
      receiving_hospital: referral.receiving_hospital?.name ?? '',
      patient_ref: referral.patient_ref,
      age_band: referral.patient_age_band,
      sex: referral.patient_sex,
      requested_at: formatDateTime(referral.requested_at),
      responded_at: referral.responded_at ? formatDateTime(referral.responded_at) : '',
      response_seconds: referral.response_seconds ?? '',
      distance_km: referral.distance_km ?? '',
      eta_minutes: referral.eta_minutes ?? '',
      match_score: referralScore(referral) ?? '',
      outcome: referral.outcome ?? '',
    }))

    downloadCsv(`fern-referrals-${new Date().toISOString().slice(0, 10)}`, toCsv(rows))

    const { error } = await supabase.rpc('log_audit_event', {
      p_action: 'report.export',
      p_entity_type: 'referrals',
      p_entity_id: null,
      p_details: {
        scope: activeTab,
        rows: rows.length,
        filters: { statuses, urgency: state.urgency, emergencyTypeId: state.type },
      },
    })
    if (error) toast.error(humanizeSupabaseError(error))
    else toast.success(`Exported ${rows.length} referrals.`)
  }

  const summary = referrals.data
    ? `${visible.length} ${visible.length === 1 ? 'referral' : 'referrals'}${
        hasFilters ? ' match' : ''
      }${overdueCount > 0 && activeTab === 'incoming' ? ` · ${overdueCount} overdue` : ''}`
    : undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title="Referrals"
        description={
          overdueCount > 0
            ? `${overdueCount} incoming referral${overdueCount === 1 ? '' : 's'} still awaiting a response.`
            : 'Incoming and outgoing transfer requests.'
        }
        actions={
          <>
            <Gate capability="reports:view">
              <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden />
                Export CSV
              </Button>
            </Gate>
            <Gate capability="referral:create">
              <Link to="/referrals/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" aria-hidden />
                  New referral
                </Button>
              </Link>
            </Gate>
          </>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={clearFilters}
        summary={summary}
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {hospitalId && (
            <SegmentedControl
              ariaLabel="Direction"
              value={activeTab}
              onChange={(next) => update({ tab: next })}
              options={[
                {
                  value: 'incoming',
                  label: 'Incoming',
                  icon: <ArrowDownLeft className="h-4 w-4" aria-hidden />,
                  count: buckets.incoming.length,
                },
                {
                  value: 'outgoing',
                  label: 'Outgoing',
                  icon: <ArrowUpRight className="h-4 w-4" aria-hidden />,
                  count: buckets.outgoing.length,
                },
                {
                  value: 'all',
                  label: 'All',
                  icon: <Layers className="h-4 w-4" aria-hidden />,
                  count: buckets.all.length,
                },
              ]}
            />
          )}
          <SearchInput
            containerClassName="flex-1"
            value={state.q}
            onChange={(value) => update({ q: value })}
            placeholder="Reference, patient code, hospital, emergency or summary text"
            aria-label="Search referrals"
          />
          <div className="flex items-center gap-2">
            <Select
              aria-label="Sort referrals"
              value={sort}
              onChange={(event) => update({ sort: event.target.value })}
              className="sm:w-44"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="urgency">Most urgent first</option>
              <option value="waiting">Longest waiting first</option>
            </Select>
            <Button
              variant="outline"
              size="md"
              className="lg:hidden"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filters
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</span>
          {REFERRAL_STATUSES.map((status) => (
            <Chip
              key={status}
              active={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
              tone={
                status === 'accepted' || status === 'completed'
                  ? 'success'
                  : status === 'declined' || status === 'cancelled' || status === 'expired'
                    ? 'danger'
                    : status === 'in_transit'
                      ? 'warning'
                      : 'brand'
              }
            >
              {REFERRAL_STATUS_LABELS[status]}
            </Chip>
          ))}
        </div>

        <div
          className={cn(
            'grid gap-3 sm:grid-cols-2 lg:grid-cols-5',
            moreOpen ? 'grid' : 'hidden lg:grid',
          )}
        >
          <Field label="Urgency">
            {({ id }) => (
              <Select
                id={id}
                value={state.urgency}
                onChange={(event) => update({ urgency: event.target.value })}
              >
                <option value="all">Any urgency</option>
                {URGENCY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {URGENCY_LABELS[level]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Emergency type">
            {({ id }) => (
              <Select
                id={id}
                value={state.type}
                onChange={(event) => update({ type: event.target.value })}
                disabled={emergencyTypes.isLoading}
              >
                <option value="all">Any emergency type</option>
                {(emergencyTypes.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={hospitalId ? 'Other hospital' : 'Hospital'}>
            {({ id }) => (
              <Select
                id={id}
                value={state.hospital}
                onChange={(event) => update({ hospital: event.target.value })}
              >
                <option value="">Any hospital</option>
                {counterparts.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Requested from">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={state.from}
                max={state.to || undefined}
                onChange={(event) => update({ from: event.target.value })}
              />
            )}
          </Field>

          <Field label="Requested to">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={state.to}
                min={state.from || undefined}
                onChange={(event) => update({ to: event.target.value })}
              />
            )}
          </Field>
        </div>
      </FilterBar>

      {referrals.isLoading ? (
        <ListSkeleton rows={5} />
      ) : referrals.isError ? (
        <ErrorBlock error={referrals.error} onRetry={() => void referrals.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6" aria-hidden />}
          title={hasFilters ? 'No referrals match these filters' : 'No referrals yet'}
          description={
            hasFilters
              ? 'Try widening the date range or clearing the status filter.'
              : activeTab === 'incoming'
                ? 'Referrals sent to your hospital will appear here the moment they are raised.'
                : 'Referrals you raise will be tracked here from request to completion.'
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Gate capability="referral:create">
                <Link to="/referrals/new">
                  <Button size="sm">New referral</Button>
                </Link>
              </Gate>
            )
          }
        />
      ) : (
        <ul className="space-y-3 animate-fade-in">
          {visible.map((referral) => (
            <li key={referral.id}>
              <ReferralCard
                referral={referral}
                direction={directionOf(referral)}
                canRespond={can('referral:respond')}
                busy={busyId === referral.id}
                now={now}
                onAccept={(target) => void respond(target, 'accepted')}
                onDecline={(target) => {
                  setDeclineReason('')
                  setDeclining(target)
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title="Decline this referral"
        description={
          declining
            ? `${declining.reference_number} from ${declining.requesting_hospital?.name ?? 'an unknown hospital'}.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={updateStatus.isPending}
              onClick={() => void confirmDecline()}
            >
              Decline referral
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint="The referring hospital sees this, so say what is unavailable and suggest a next step."
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              maxLength={500}
              value={declineReason}
              placeholder="No ICU bed free this shift; theatre is committed until 18:00."
              onChange={(event) => setDeclineReason(event.target.value)}
            />
          )}
        </Field>
      </Modal>
    </div>
  )
}
