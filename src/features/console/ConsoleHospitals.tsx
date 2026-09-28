import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { TableSkeleton } from '@/components/ui/skeletons'
import { Building2, ClipboardList, ExternalLink, Pencil, Plus, Search } from 'lucide-react'
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
  Modal,
  SearchInput,
  SegmentedControl,
  Select,
  StatusDot,
  Table,
  Td,
  Th,
  Toggle,
} from '@/components/ui'
import DepartmentManager from '@/features/admin/DepartmentManager'
import { HospitalForm, type HospitalFormValues } from '@/features/admin/HospitalForm'
import { useUpsertHospital } from '@/features/admin/useAdmin'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { useHospitals } from '@/features/hospitals/useHospitals'
import { useNetworkReadiness } from '@/features/readiness/useReadiness'
import {
  HOSPITAL_LEVELS,
  HOSPITAL_LEVEL_LABELS,
  READINESS_LABELS,
  READINESS_STATUSES,
  type ReadinessStatus,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { Hospital } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { relativeTime, unique } from '@/lib/utils'

const FILTER_DEFAULTS = {
  q: '',
  region: '',
  level: '',
  status: 'active',
  accepting: '',
  readiness: '',
  new: false,
  edit: '',
  departments: '',
}

const STATUS_TONE = { green: 'success', yellow: 'warning', red: 'danger' } as const

function toPayload(values: HospitalFormValues) {
  return {
    name: values.name,
    code: values.code,
    level: values.level,
    address: values.address || null,
    city: values.city || null,
    region: values.region || null,
    country: values.country,
    phone: values.phone || null,
    emergency_phone: values.emergency_phone || null,
    email: values.email || null,
    timezone: values.timezone,
    latitude: values.latitude,
    longitude: values.longitude,
    notes: values.notes || null,
    logo_url: values.logo_url,
    is_active: values.is_active,
    accepts_referrals: values.accepts_referrals,
    referral_policy: values.referral_policy,
  }
}

export default function ConsoleHospitals() {
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const hospitals = useHospitals({ onlyActive: false })
  const readiness = useNetworkReadiness()
  const upsert = useUpsertHospital()
  const [busyId, setBusyId] = useState<string | null>(null)

  const rows = useMemo(() => hospitals.data ?? [], [hospitals.data])
  const editing = rows.find((row) => row.id === state.edit) ?? null
  const managingDepartments = rows.find((row) => row.id === state.departments) ?? null

  const regions = useMemo(
    () =>
      unique(rows.map((row) => row.region).filter((value): value is string => Boolean(value))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [rows],
  )

  const visible = useMemo(() => {
    const term = state.q.trim().toLowerCase()
    return rows.filter((row) => {
      if (state.status === 'active' && !row.is_active) return false
      if (state.status === 'inactive' && row.is_active) return false
      if (state.region && row.region !== state.region) return false
      if (state.level && row.level !== state.level) return false
      if (state.accepting === 'yes' && !row.accepts_referrals) return false
      if (state.accepting === 'no' && row.accepts_referrals) return false
      if (state.readiness) {
        const summary = readiness.data?.[row.id]
        if (!summary || summary.total === 0 || summary.status !== state.readiness) return false
      }
      if (!term) return true
      return `${row.name} ${row.code} ${row.city ?? ''} ${row.region ?? ''} ${row.email ?? ''} ${row.phone ?? ''}`
        .toLowerCase()
        .includes(term)
    })
  }, [rows, state, readiness.data])

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.region ? 1 : 0) +
    (state.level ? 1 : 0) +
    (state.status !== 'active' ? 1 : 0) +
    (state.accepting ? 1 : 0) +
    (state.readiness ? 1 : 0)

  const closeModals = () => update({ new: false, edit: '', departments: '' })

  const save = async (values: HospitalFormValues) => {
    try {
      const saved = await upsert.mutateAsync({ id: editing?.id, ...toPayload(values) })
      toast.success(editing ? `${saved.name} updated` : `${saved.name} added to the network`)
      if (editing) closeModals()
      // A new facility stays open so its logo can be uploaded straight away.
      else update({ new: false, edit: saved.id })
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  const setFlag = async (
    hospital: Hospital,
    patch: { is_active?: boolean; accepts_referrals?: boolean },
  ) => {
    setBusyId(hospital.id)
    try {
      await upsert.mutateAsync({ id: hospital.id, ...patch })
      toast.success(
        patch.is_active !== undefined
          ? `${hospital.name} is now ${patch.is_active ? 'active' : 'inactive'}`
          : `${hospital.name} is ${patch.accepts_referrals ? 'accepting referrals again' : 'no longer accepting referrals'}`,
      )
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={activeFilters}
        onClear={() => reset()}
        summary={hospitals.data ? `${visible.length} of ${rows.length} facilities` : undefined}
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput
            containerClassName="flex-1"
            value={state.q}
            onChange={(value) => update({ q: value })}
            placeholder="Name, code, town, region, phone or email"
            aria-label="Search hospitals"
          />
          <SegmentedControl
            ariaLabel="Active state"
            size="sm"
            value={state.status}
            onChange={(next) => update({ status: next })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Button size="md" onClick={() => update({ new: true })}>
            <Plus className="h-4 w-4" aria-hidden />
            Add hospital
          </Button>
        </div>
        <FilterBarAdvanced>
          <Field label="Region">
            {({ id }) => (
              <Select
                id={id}
                value={state.region}
                onChange={(e) => update({ region: e.target.value })}
              >
                <option value="">All regions</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
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
                onChange={(e) => update({ level: e.target.value })}
              >
                <option value="">All levels</option>
                {HOSPITAL_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {HOSPITAL_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Referrals">
            {({ id }) => (
              <Select
                id={id}
                value={state.accepting}
                onChange={(e) => update({ accepting: e.target.value })}
              >
                <option value="">Accepting or not</option>
                <option value="yes">Accepting</option>
                <option value="no">On diversion</option>
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            {READINESS_STATUSES.map((status: ReadinessStatus) => (
              <Chip
                key={status}
                active={state.readiness === status}
                onClick={() => update({ readiness: state.readiness === status ? '' : status })}
                tone={STATUS_TONE[status]}
              >
                <StatusDot status={status} />
                {READINESS_LABELS[status]}
              </Chip>
            ))}
          </div>
        </FilterBarAdvanced>
      </FilterBar>

      {hospitals.isPending ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : hospitals.isError ? (
        <ErrorBlock error={hospitals.error} onRetry={() => void hospitals.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No hospitals yet"
            description="Add the first facility to start the network."
            action={
              <Button size="sm" onClick={() => update({ new: true })}>
                <Plus className="h-4 w-4" aria-hidden />
                Add hospital
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No hospitals match"
            description="Inactive facilities are hidden unless you change the status filter."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table responsive minWidth="64rem">
            <thead>
              <tr>
                <Th>Hospital</Th>
                <Th>Level</Th>
                <Th>Region</Th>
                <Th>Readiness</Th>
                <Th>Accepting</Th>
                <Th>Active</Th>
                <Th>Updated</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((hospital) => {
                const summary = readiness.data?.[hospital.id]
                const busy = busyId === hospital.id && upsert.isPending
                return (
                  <tr
                    key={hospital.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <Td cell="identity">
                      <div className="flex items-center gap-3">
                        <HospitalLogo hospital={hospital} size="md" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {hospital.name}
                          </p>
                          <p className="hint">
                            {hospital.code}
                            {hospital.city ? ` · ${hospital.city}` : ''}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-300">
                      {HOSPITAL_LEVEL_LABELS[hospital.level] ?? hospital.level}
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-300">{hospital.region ?? '-'}</Td>
                    <Td>
                      {readiness.isPending ? (
                        <span className="hint">…</span>
                      ) : !summary || summary.total === 0 ? (
                        <Badge tone="neutral">No departments</Badge>
                      ) : (
                        <StatusDot
                          status={summary.status}
                          label={`${summary.green}/${summary.total}`}
                          pulse={summary.status !== 'green'}
                        />
                      )}
                    </Td>
                    <Td>
                      <Toggle
                        checked={hospital.accepts_referrals}
                        disabled={busy}
                        onChange={(next) => void setFlag(hospital, { accepts_referrals: next })}
                        label={<span className="sr-only">Accepting referrals</span>}
                      />
                    </Td>
                    <Td>
                      <Toggle
                        checked={hospital.is_active}
                        disabled={busy}
                        onChange={(next) => void setFlag(hospital, { is_active: next })}
                        label={<span className="sr-only">Active</span>}
                      />
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {relativeTime(hospital.updated_at)}
                    </Td>
                    <Td align="right" cell="actions">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => update({ departments: hospital.id })}
                        >
                          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                          Departments
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => update({ edit: hospital.id })}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </Button>
                        <Link
                          to={`/hospitals/${hospital.id}`}
                          className="inline-flex h-8 items-center justify-center rounded-lg px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          aria-label={`Open ${hospital.name}`}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden />
                        </Link>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={state.new || (state.edit !== '' && Boolean(editing))}
        onClose={closeModals}
        size="xl"
        title={editing ? `Edit ${editing.name}` : 'Add a hospital'}
        description={
          editing
            ? 'Changes apply immediately to every referral ranking and printed form.'
            : 'The facility appears in the directory and the rankings as soon as it is saved.'
        }
      >
        <HospitalForm
          key={editing?.id ?? 'new'}
          hospital={editing}
          onSubmit={save}
          submitting={upsert.isPending}
          submitLabel={editing ? 'Save changes' : 'Create hospital'}
          onCancel={closeModals}
          cancelLabel="Close"
          showFlags
        />
      </Modal>

      <Modal
        open={Boolean(managingDepartments)}
        onClose={closeModals}
        size="xl"
        title={managingDepartments ? `Departments at ${managingDepartments.name}` : 'Departments'}
        description="Each department reports its own readiness once per shift."
      >
        {managingDepartments && (
          <DepartmentManager
            hospitalId={managingDepartments.id}
            hospitalName={managingDepartments.name}
          />
        )}
      </Modal>
    </div>
  )
}
