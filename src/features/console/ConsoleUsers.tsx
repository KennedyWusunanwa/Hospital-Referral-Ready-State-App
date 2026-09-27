import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Building2, Pencil, PowerOff, RotateCcw, Search, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  FilterBar,
  Input,
  LoadingBlock,
  Modal,
  SearchInput,
  SegmentedControl,
  Select,
  Stat,
  Table,
  Td,
  Th,
  Toggle,
  type SortDirection,
} from '@/components/ui'
import { InvitePanel, RoleBadge } from '@/features/admin/StaffManager'
import { useAllDepartments, useStaff, useUpdateStaff } from '@/features/admin/useAdmin'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { useHospitals } from '@/features/hospitals/useHospitals'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_TIERS,
  ROLE_TIER_LABELS,
  ROLE_TIER_OF,
  ROLES_BY_TIER,
  type RoleTier,
  type UserRole,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { Hospital, Profile } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { formatDateTime, relativeTime } from '@/lib/utils'

const FILTER_DEFAULTS = {
  q: '',
  tier: '',
  role: '',
  hospital: '',
  status: 'active',
  sort: 'name',
  dir: 'asc',
}

type SortKey = 'name' | 'role' | 'hospital' | 'last_login' | 'created'

function EditUserModal({
  member,
  hospitals,
  departments,
  isSelf,
  onClose,
}: {
  member: Profile
  hospitals: Hospital[]
  departments: Array<{ id: string; name: string; hospital_id: string }>
  isSelf: boolean
  onClose: () => void
}) {
  const update = useUpdateStaff()
  const [fullName, setFullName] = useState(member.full_name)
  const [role, setRole] = useState<UserRole>(member.role)
  const [hospitalId, setHospitalId] = useState(member.hospital_id ?? '')
  const [departmentId, setDepartmentId] = useState(member.department_id ?? '')
  const [active, setActive] = useState(member.is_active)

  const tier = ROLE_TIER_OF[role]
  const hospitalDepartments = departments.filter((d) => d.hospital_id === hospitalId)

  const save = async () => {
    if (tier !== 'system' && !hospitalId) {
      toast.error(`A ${ROLE_LABELS[role]} must belong to a hospital.`)
      return
    }
    try {
      await update.mutateAsync({
        userId: member.id,
        hospitalId: null,
        changes: {
          full_name: fullName.trim() || member.full_name,
          role: isSelf ? undefined : role,
          hospital_id: tier === 'system' ? hospitalId || null : hospitalId,
          department_id: hospitalDepartments.some((d) => d.id === departmentId)
            ? departmentId
            : null,
          is_active: isSelf ? undefined : active,
        },
      })
      toast.success(`${fullName || member.full_name} updated`)
      onClose()
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={member.full_name}
      description={member.email}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name">
          {({ id }) => (
            <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          )}
        </Field>

        <Field
          label="Role"
          hint={isSelf ? 'You cannot change your own role.' : ROLE_DESCRIPTIONS[role]}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={role}
              disabled={isSelf}
              onChange={(event) => {
                const next = event.target.value as UserRole
                setRole(next)
                if (ROLE_TIER_OF[next] === 'system') setDepartmentId('')
              }}
            >
              {ROLE_TIERS.map((group) => (
                <optgroup key={group} label={`${ROLE_TIER_LABELS[group]} level`}>
                  {ROLES_BY_TIER[group].map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Hospital"
          required={tier !== 'system'}
          hint={
            tier === 'system'
              ? 'Optional for a system administrator. Attaching one gives them a home dashboard.'
              : 'Moving someone between facilities re-scopes everything they can see.'
          }
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={hospitalId}
              onChange={(event) => {
                setHospitalId(event.target.value)
                setDepartmentId('')
              }}
            >
              <option value="">
                {tier === 'system' ? 'Network-wide (no hospital)' : 'Choose a hospital'}
              </option>
              {hospitals.map((hospital) => (
                <option key={hospital.id} value={hospital.id}>
                  {hospital.name}
                  {hospital.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {tier !== 'system' && (
          <Field
            label="Department"
            required={tier === 'department'}
            hint={
              tier === 'department'
                ? 'The one department this person reports readiness for.'
                : 'Optional.'
            }
          >
            {({ id }) => (
              <Select
                id={id}
                value={departmentId}
                disabled={!hospitalId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">No department</option>
                {hospitalDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Toggle
          checked={active}
          disabled={isSelf}
          onChange={setActive}
          label="Account active"
          description={
            isSelf
              ? 'You cannot deactivate yourself.'
              : 'A deactivated account cannot sign in. History is kept.'
          }
        />
        {!active && !isSelf && (
          <Alert tone="warning">
            {member.full_name} will be signed out at their next request and cannot sign in again
            until reactivated.
          </Alert>
        )}
      </div>
    </Modal>
  )
}

export default function ConsoleUsers() {
  const { profile } = useAuth()
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const staff = useStaff(null)
  const hospitals = useHospitals({ onlyActive: false })
  const departments = useAllDepartments()
  const updateStaff = useUpdateStaff()

  const [editing, setEditing] = useState<Profile | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const rows = useMemo(() => staff.data ?? [], [staff.data])
  const hospitalById = useMemo(
    () => new Map((hospitals.data ?? []).map((hospital) => [hospital.id, hospital])),
    [hospitals.data],
  )
  const departmentById = useMemo(
    () => new Map((departments.data ?? []).map((department) => [department.id, department.name])),
    [departments.data],
  )

  const sort = state.sort as SortKey
  const dir = state.dir as SortDirection

  const visible = useMemo(() => {
    const term = state.q.trim().toLowerCase()
    const filtered = rows.filter((member) => {
      if (state.status === 'active' && !member.is_active) return false
      if (state.status === 'deactivated' && member.is_active) return false
      if (state.tier && ROLE_TIER_OF[member.role] !== state.tier) return false
      if (state.role && member.role !== state.role) return false
      if (state.hospital === 'none' && member.hospital_id) return false
      if (state.hospital && state.hospital !== 'none' && member.hospital_id !== state.hospital)
        return false
      if (!term) return true
      const hospitalName = member.hospital_id
        ? (hospitalById.get(member.hospital_id)?.name ?? '')
        : ''
      return `${member.full_name} ${member.email} ${member.phone ?? ''} ${ROLE_LABELS[member.role]} ${hospitalName}`
        .toLowerCase()
        .includes(term)
    })

    const direction = dir === 'asc' ? 1 : -1
    const hospitalName = (member: Profile) =>
      member.hospital_id ? (hospitalById.get(member.hospital_id)?.name ?? '') : ''
    filtered.sort((a, b) => {
      switch (sort) {
        case 'role':
          return (
            (ROLE_LABELS[a.role].localeCompare(ROLE_LABELS[b.role]) ||
              a.full_name.localeCompare(b.full_name)) * direction
          )
        case 'hospital':
          return (
            (hospitalName(a).localeCompare(hospitalName(b)) ||
              a.full_name.localeCompare(b.full_name)) * direction
          )
        case 'last_login': {
          const at = (m: Profile) => (m.last_login_at ? new Date(m.last_login_at).getTime() : 0)
          return (at(a) - at(b)) * direction
        }
        case 'created':
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction
        default:
          return a.full_name.localeCompare(b.full_name) * direction
      }
    })
    return filtered
  }, [rows, state.q, state.status, state.tier, state.role, state.hospital, sort, dir, hospitalById])

  const tierCounts = useMemo(() => {
    const counts: Record<RoleTier, number> = { system: 0, hospital: 0, department: 0 }
    for (const member of rows) if (member.is_active) counts[ROLE_TIER_OF[member.role]] += 1
    return counts
  }, [rows])

  const neverSignedIn = rows.filter((member) => member.is_active && !member.last_login_at).length
  const unattached = rows.filter(
    (member) => member.is_active && !member.hospital_id && member.role !== 'super_admin',
  ).length

  const toggleSort = (key: SortKey) => {
    if (sort === key) update({ dir: dir === 'asc' ? 'desc' : 'asc' })
    else update({ sort: key, dir: key === 'last_login' || key === 'created' ? 'desc' : 'asc' })
  }

  const setActive = async (member: Profile, isActive: boolean) => {
    setBusyId(member.id)
    try {
      await updateStaff.mutateAsync({
        userId: member.id,
        hospitalId: null,
        changes: { is_active: isActive },
      })
      toast.success(
        isActive ? `${member.full_name} reactivated` : `${member.full_name} deactivated`,
      )
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    } finally {
      setBusyId(null)
    }
  }

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.tier ? 1 : 0) +
    (state.role ? 1 : 0) +
    (state.hospital ? 1 : 0) +
    (state.status !== 'active' ? 1 : 0)

  const roleOptions = state.tier
    ? ROLES_BY_TIER[state.tier as RoleTier]
    : (Object.keys(ROLE_LABELS) as UserRole[])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Active accounts"
          value={rows.filter((m) => m.is_active).length}
          sublabel={`${rows.length} in total`}
        />
        <Stat label="System level" value={tierCounts.system} sublabel="Run the platform" />
        <Stat
          label="Hospital level"
          value={tierCounts.hospital}
          sublabel="Administrators, coordinators, viewers"
        />
        <Stat label="Department level" value={tierCounts.department} sublabel="Shift in-charges" />
        <Stat
          label="Need attention"
          value={neverSignedIn + unattached}
          sublabel={`${neverSignedIn} never signed in · ${unattached} without a hospital`}
          tone={neverSignedIn + unattached > 0 ? 'warning' : undefined}
        />
      </div>

      <FilterBar
        activeCount={activeFilters}
        onClear={() => reset()}
        summary={staff.data ? `${visible.length} of ${rows.length} accounts` : undefined}
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput
            containerClassName="flex-1"
            value={state.q}
            onChange={(value) => update({ q: value })}
            placeholder="Name, email, phone, role or hospital"
            aria-label="Search accounts"
          />
          <SegmentedControl
            ariaLabel="Account status"
            size="sm"
            value={state.status}
            onChange={(next) => update({ status: next })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'deactivated', label: 'Deactivated' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Select
            aria-label="Filter by hospital"
            className="lg:w-64"
            value={state.hospital}
            onChange={(event) => update({ hospital: event.target.value })}
          >
            <option value="">Any hospital</option>
            <option value="none">No hospital (network-wide)</option>
            {(hospitals.data ?? []).map((hospital) => (
              <option key={hospital.id} value={hospital.id}>
                {hospital.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by role"
            className="lg:w-56"
            value={state.role}
            onChange={(event) => update({ role: event.target.value })}
          >
            <option value="">Any role</option>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Level</span>
          {ROLE_TIERS.map((tier) => (
            <Chip
              key={tier}
              active={state.tier === tier}
              onClick={() => update({ tier: state.tier === tier ? '' : tier, role: '' })}
              count={tierCounts[tier]}
            >
              {ROLE_TIER_LABELS[tier]}
            </Chip>
          ))}
        </div>
      </FilterBar>

      {staff.isPending ? (
        <Card>
          <LoadingBlock label="Loading accounts" rows={6} />
        </Card>
      ) : staff.isError ? (
        <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No accounts yet"
            description="Invite the first person below."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Nobody matches"
            description="Deactivated accounts are hidden unless you change the status filter."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table minWidth="64rem">
            <thead>
              <tr>
                <Th
                  sortable
                  active={sort === 'name'}
                  direction={dir}
                  onSort={() => toggleSort('name')}
                >
                  Person
                </Th>
                <Th
                  sortable
                  active={sort === 'role'}
                  direction={dir}
                  onSort={() => toggleSort('role')}
                >
                  Level · role
                </Th>
                <Th
                  sortable
                  active={sort === 'hospital'}
                  direction={dir}
                  onSort={() => toggleSort('hospital')}
                >
                  Hospital
                </Th>
                <Th>Department</Th>
                <Th
                  sortable
                  active={sort === 'last_login'}
                  direction={dir}
                  onSort={() => toggleSort('last_login')}
                >
                  Last sign-in
                </Th>
                <Th
                  sortable
                  active={sort === 'created'}
                  direction={dir}
                  onSort={() => toggleSort('created')}
                >
                  Joined
                </Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => {
                const hospital = member.hospital_id
                  ? hospitalById.get(member.hospital_id)
                  : undefined
                const isSelf = member.id === profile?.id
                const busy = busyId === member.id && updateStaff.isPending
                return (
                  <tr
                    key={member.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={member.full_name} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium text-slate-900 dark:text-slate-100">
                            {member.full_name}
                            {isSelf && <Badge tone="neutral">You</Badge>}
                            {!member.is_active && <Badge tone="danger">Deactivated</Badge>}
                          </p>
                          <p className="truncate hint">{member.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <RoleBadge role={member.role} />
                    </Td>
                    <Td>
                      {hospital ? (
                        <span className="flex items-center gap-2">
                          <HospitalLogo hospital={hospital} size="xs" />
                          <span className="truncate text-slate-700 dark:text-slate-300">
                            {hospital.name}
                          </span>
                        </span>
                      ) : member.role === 'super_admin' ? (
                        <span className="hint">Network-wide</span>
                      ) : (
                        <Badge tone="warning">
                          <Building2 className="h-3 w-3" aria-hidden />
                          Not attached
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-300">
                      {member.department_id
                        ? (departmentById.get(member.department_id) ?? '…')
                        : '-'}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {member.last_login_at ? (
                        <span title={formatDateTime(member.last_login_at)}>
                          {relativeTime(member.last_login_at)}
                        </span>
                      ) : (
                        <span className="hint">never</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
                      <span title={formatDateTime(member.created_at)}>
                        {relativeTime(member.created_at)}
                      </span>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(member)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </Button>
                        {member.is_active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isSelf || busy}
                            onClick={() => void setActive(member, false)}
                            aria-label={`Deactivate ${member.full_name}`}
                          >
                            <PowerOff className="h-3.5 w-3.5" aria-hidden />
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy}
                            onClick={() => void setActive(member, true)}
                            aria-label={`Reactivate ${member.full_name}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <InvitePanel hospitalId={null} hospitalName={null} allowHospitalPick />

      {editing && (
        <EditUserModal
          key={editing.id}
          member={editing}
          hospitals={hospitals.data ?? []}
          departments={departments.data ?? []}
          isSelf={editing.id === profile?.id}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
