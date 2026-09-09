import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Filter, Inbox, Plus, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Gate } from '@/auth/RequireAuth'
import { useAuth, useCurrentHospitalId } from '@/auth/AuthProvider'
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
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

  const [tab, setTab] = useState<DirectionTab>('incoming')
  const [statuses, setStatuses] = useState<ReferralStatus[]>([])
  const [urgency, setUrgency] = useState<UrgencyLevel | 'all'>('all')
  const [emergencyTypeId, setEmergencyTypeId] = useState('all')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const emergencyTypes = useEmergencyTypes()

  // The direction split is done client-side so every tab shows a live count
  // from one fetch; status and date range are cheap enough to push to Postgres.
  const referrals = useReferrals({
    hospitalId,
    direction: 'all',
    status: statuses.length > 0 ? statuses : undefined,
    from: dayStartIso(fromDay),
    to: dayEndIso(toDay),
  })

  const updateStatus = useUpdateReferralStatus()
  const [declining, setDeclining] = useState<ReferralWithRelations | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const directionOf = (referral: ReferralWithRelations): 'incoming' | 'outgoing' =>
    hospitalId && referral.receiving_hospital_id === hospitalId ? 'incoming' : 'outgoing'

  const filtered = useMemo(() => {
    const rows = referrals.data ?? []
    const needle = search.trim().toLowerCase()

    return rows.filter((referral) => {
      if (urgency !== 'all' && referral.urgency !== urgency) return false
      if (emergencyTypeId !== 'all' && referral.emergency_type_id !== emergencyTypeId) return false
      if (needle) {
        const haystack = `${referral.reference_number} ${referral.clinical_summary}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [referrals.data, search, urgency, emergencyTypeId])

  const buckets = useMemo(() => {
    const incoming: ReferralWithRelations[] = []
    const outgoing: ReferralWithRelations[] = []
    for (const referral of filtered) {
      if (directionOf(referral) === 'incoming') incoming.push(referral)
      else outgoing.push(referral)
    }

    // Newest first everywhere, but an unanswered incoming referral is the whole
    // point of the screen, so float the overdue ones above the rest.
    const byRecency = (a: ReferralWithRelations, b: ReferralWithRelations) =>
      new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime()

    const urgencyFirst = (a: ReferralWithRelations, b: ReferralWithRelations) => {
      const aOverdue = a.status === 'pending' && isReferralOverdue(a.requested_at, now)
      const bOverdue = b.status === 'pending' && isReferralOverdue(b.requested_at, now)
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      return byRecency(a, b)
    }

    return {
      incoming: [...incoming].sort(urgencyFirst),
      outgoing: [...outgoing].sort(byRecency),
      all: [...filtered].sort(byRecency),
    }
  }, [filtered, hospitalId, now])

  // A super_admin has no home hospital, so the direction split is meaningless.
  const activeTab: DirectionTab = hospitalId ? tab : 'all'
  const visible = buckets[activeTab]
  const overdueCount = buckets.incoming.filter(
    (referral) => referral.status === 'pending' && isReferralOverdue(referral.requested_at, now),
  ).length

  const hasFilters =
    statuses.length > 0 ||
    urgency !== 'all' ||
    emergencyTypeId !== 'all' ||
    fromDay !== '' ||
    toDay !== '' ||
    search !== ''

  function resetFilters() {
    setStatuses([])
    setUrgency('all')
    setEmergencyTypeId('all')
    setFromDay('')
    setToDay('')
    setSearch('')
  }

  function toggleStatus(status: ReferralStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    )
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
      p_details: { scope: activeTab, rows: rows.length, filters: { statuses, urgency, emergencyTypeId } },
    })
    if (error) toast.error(humanizeSupabaseError(error))
    else toast.success(`Exported ${rows.length} referrals.`)
  }

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              <Filter className="h-4 w-4" aria-hidden />
              Filters
              {hasFilters && (
                <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white">
                  on
                </span>
              )}
            </Button>
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

      {showFilters && (
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search" className="sm:col-span-2" hint="Reference number or summary text">
              {({ id, describedBy }) => (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    className="pl-9"
                    type="search"
                    placeholder="REF-000123 or 'head injury'"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              )}
            </Field>

            <Field label="Urgency">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value as UrgencyLevel | 'all')}
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
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={emergencyTypeId}
                  onChange={(event) => setEmergencyTypeId(event.target.value)}
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

            <Field label="Requested from">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  value={fromDay}
                  max={toDay || undefined}
                  onChange={(event) => setFromDay(event.target.value)}
                />
              )}
            </Field>

            <Field label="Requested to">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  value={toDay}
                  min={fromDay || undefined}
                  onChange={(event) => setToDay(event.target.value)}
                />
              )}
            </Field>

            <fieldset className="sm:col-span-2 lg:col-span-4">
              <legend className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                Status
              </legend>
              <div className="flex flex-wrap gap-2">
                {REFERRAL_STATUSES.map((status) => {
                  const active = statuses.includes(status)
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleStatus(status)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
                      )}
                    >
                      {REFERRAL_STATUS_LABELS[status]}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {hasFilters && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Clear filters
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Tabs
        value={activeTab}
        defaultValue={activeTab}
        onValueChange={(value) => setTab(value as DirectionTab)}
      >
        <TabList>
          {hospitalId && (
            <Tab value="incoming" count={buckets.incoming.length}>
              Incoming
            </Tab>
          )}
          {hospitalId && (
            <Tab value="outgoing" count={buckets.outgoing.length}>
              Outgoing
            </Tab>
          )}
          <Tab value="all" count={buckets.all.length}>
            All
          </Tab>
        </TabList>

        <div className="pt-4">
          {referrals.isLoading ? (
            <LoadingBlock label="Loading referrals" rows={4} />
          ) : referrals.isError ? (
            <ErrorBlock error={referrals.error} onRetry={() => void referrals.refetch()} />
          ) : (
            <TabPanel value={activeTab}>
              {visible.length === 0 ? (
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
                      <Button variant="outline" size="sm" onClick={resetFilters}>
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
                <ul className="space-y-3">
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
            </TabPanel>
          )}
        </div>
      </Tabs>

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
