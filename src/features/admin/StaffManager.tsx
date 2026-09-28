import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  ClipboardCheck,
  Mail,
  Pencil,
  PowerOff,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Input,
  Modal,
  SearchInput,
  SegmentedControl,
  Select,
} from '@/components/ui'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_TIERS,
  ROLE_TIER_DESCRIPTIONS,
  ROLE_TIER_LABELS,
  ROLE_TIER_OF,
  ROLES_BY_TIER,
  SUPPORT_EMAIL,
  type RoleTier,
  type UserRole,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import { useUrlState } from '@/lib/useUrlState'
import { formatDateTime, relativeTime } from '@/lib/utils'
import type { Department, Profile } from '@/lib/types'
import { useHospitals } from '@/features/hospitals/useHospitals'
import { useAdminDepartments, useStaff, useUpdateStaff } from './useAdmin'
import { useCreateInvite, useRevokeInvite, useStaffInvites } from './useAppSettings'

export const ROLE_TONES: Record<UserRole, 'brand' | 'info' | 'success' | 'warning' | 'neutral'> = {
  super_admin: 'warning',
  hospital_admin: 'brand',
  shift_in_charge: 'info',
  department_coordinator: 'info',
  referral_coordinator: 'success',
  viewer: 'neutral',
}

const TIER_ICONS: Record<RoleTier, typeof Users> = {
  system: ShieldCheck,
  hospital: Building2,
  department: ClipboardCheck,
}

const FILTER_DEFAULTS = { q: '', tier: '', role: '', status: 'active', department: '' }

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge tone={ROLE_TONES[role]}>
      <span className="opacity-70">{ROLE_TIER_LABELS[ROLE_TIER_OF[role]]}</span>
      <span aria-hidden>·</span>
      {ROLE_LABELS[role]}
    </Badge>
  )
}

function EditStaffModal({
  member,
  departments,
  hospitalId,
  canGrantSuperAdmin,
  isSelf,
  onClose,
}: {
  member: Profile
  departments: Department[]
  hospitalId: string | null
  canGrantSuperAdmin: boolean
  isSelf: boolean
  onClose: () => void
}) {
  const updateStaff = useUpdateStaff()
  // The call site remounts this per member with a `key`, so seeding local state
  // from props once is correct here.
  const [role, setRole] = useState<UserRole>(member.role)
  const [departmentId, setDepartmentId] = useState<string>(member.department_id ?? '')

  const roleLocked = (member.role === 'super_admin' && !canGrantSuperAdmin) || isSelf
  const roleOptions = (Object.keys(ROLE_LABELS) as UserRole[]).filter(
    (option) => option !== 'super_admin' || canGrantSuperAdmin || member.role === 'super_admin',
  )
  // A department-level account without a department has no scope at all; the
  // database refuses the same change, this keeps the refusal out of a toast.
  const needsDepartment = ROLE_TIER_OF[role] === 'department' && !departmentId

  const save = async () => {
    if (needsDepartment) {
      toast.error('Choose the department this person reports for.')
      return
    }
    try {
      await updateStaff.mutateAsync({
        userId: member.id,
        hospitalId,
        changes: {
          role: roleLocked ? undefined : role,
          department_id: departmentId || null,
        },
      })
      toast.success(`${member.full_name} updated`)
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
          <Button
            loading={updateStaff.isPending}
            disabled={needsDepartment}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Role"
          hint={roleLocked ? undefined : 'Determines what this person can see and do.'}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={role}
              disabled={roleLocked}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {ROLE_TIERS.map((tier) => (
                <optgroup key={tier} label={`${ROLE_TIER_LABELS[tier]} level`}>
                  {ROLES_BY_TIER[tier]
                    .filter((option) => roleOptions.includes(option))
                    .map((option) => (
                      <option key={option} value={option}>
                        {ROLE_LABELS[option]}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>

        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {ROLE_TIER_LABELS[ROLE_TIER_OF[role]]} level.
          </span>{' '}
          {ROLE_DESCRIPTIONS[role]}
        </p>

        {isSelf && (
          <Alert tone="info">
            You cannot change your own role. Ask another administrator, or write to {SUPPORT_EMAIL}.
          </Alert>
        )}
        {!isSelf && member.role === 'super_admin' && !canGrantSuperAdmin && (
          <Alert tone="warning">
            Only a system administrator can change another system administrator&apos;s role.
          </Alert>
        )}

        <Field
          label="Department"
          required={ROLE_TIER_OF[role] === 'department'}
          hint={
            ROLE_TIER_OF[role] === 'department'
              ? 'A department-level account sees and files readiness for this one department only.'
              : 'Optional. Sets which readiness form the person lands on.'
          }
          error={needsDepartment ? 'Required for a department-level role.' : undefined}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">No department</option>
              {departments
                .filter((department) => department.is_active || department.id === departmentId)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.is_active ? '' : ' (retired)'}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  )
}

export function InvitePanel({
  hospitalId,
  hospitalName,
  allowHospitalPick = false,
}: {
  hospitalId: string | null
  hospitalName: string | null
  /** The console lets a system administrator choose the facility per invitation. */
  allowHospitalPick?: boolean
}) {
  const { role: currentRole } = useAuth()
  const isSuperAdmin = currentRole === 'super_admin'
  const hospitals = useHospitals({ onlyActive: true, enabled: allowHospitalPick })

  const [pickedHospitalId, setPickedHospitalId] = useState('')
  const targetHospitalId = allowHospitalPick ? pickedHospitalId || null : hospitalId
  const targetHospitalName = allowHospitalPick
    ? (hospitals.data?.find((item) => item.id === targetHospitalId)?.name ?? null)
    : hospitalName

  const invites = useStaffInvites(hospitalId)
  const departments = useAdminDepartments(targetHospitalId)
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [tier, setTier] = useState<RoleTier>('department')
  const [role, setRole] = useState<UserRole>('shift_in_charge')
  const [departmentId, setDepartmentId] = useState<string>('')

  // Only a system administrator can mint another one; the RLS policy enforces
  // the same rule, this just keeps it out of the menu.
  const tierOptions = ROLE_TIERS.filter((option) => option !== 'system' || isSuperAdmin)

  const pickTier = (next: RoleTier) => {
    setTier(next)
    setRole(ROLES_BY_TIER[next][0])
    if (next === 'system') setDepartmentId('')
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  // Every role except a system administrator is scoped to one facility, so an
  // invite for them is meaningless without a hospital to attach it to.
  const needsHospital = tier !== 'system' && !targetHospitalId
  const needsDepartment = tier === 'department' && !departmentId

  const submit = async () => {
    if (!emailValid) {
      toast.error('Enter a valid email address.')
      return
    }
    if (needsHospital) {
      toast.error('Choose which hospital this person belongs to first.')
      return
    }
    if (needsDepartment) {
      toast.error('A department-level account needs a department to report for.')
      return
    }
    try {
      await createInvite.mutateAsync({
        email: email.trim(),
        full_name: fullName.trim() || null,
        role,
        hospital_id: tier === 'system' ? null : targetHospitalId,
        department_id: departmentId || null,
      })
      toast.success(`${email.trim()} can now sign in as ${ROLE_LABELS[role]}`)
      setEmail('')
      setFullName('')
      setDepartmentId('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the invitation')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Invite a colleague"
        description={
          targetHospitalName
            ? `Give someone access to ${targetHospitalName}.`
            : 'Give someone access to the platform.'
        }
        action={<Mail className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
      />
      <CardBody className="space-y-4">
        <Alert tone="info" title="How this works">
          You record the level and role an email address should get. The person then signs in from
          the login screen using <span className="font-medium">Email code</span> with that same
          address, and their account is created with exactly that access. No password to share, and
          no privileged key in the browser.
        </Alert>

        <div>
          <p className="field-label mb-1.5">Access level</p>
          <SegmentedControl
            ariaLabel="Access level"
            value={tier}
            onChange={pickTier}
            options={tierOptions.map((option) => {
              const Icon = TIER_ICONS[option]
              return {
                value: option,
                label: ROLE_TIER_LABELS[option],
                icon: <Icon className="h-4 w-4" aria-hidden />,
              }
            })}
          />
          <p className="mt-1.5 hint">{ROLE_TIER_DESCRIPTIONS[tier]}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email address" required>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={email}
                placeholder="colleague@hospital.org"
                autoComplete="off"
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label="Full name" hint="Optional. Used until they edit their own profile.">
            {({ id }) => (
              <Input
                id={id}
                value={fullName}
                placeholder="Ama Boateng"
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </Field>

          <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                disabled={ROLES_BY_TIER[tier].length === 1}
              >
                {ROLES_BY_TIER[tier].map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {allowHospitalPick && tier !== 'system' && (
            <Field label="Hospital" required>
              {({ id }) => (
                <Select
                  id={id}
                  value={pickedHospitalId}
                  onChange={(event) => {
                    setPickedHospitalId(event.target.value)
                    setDepartmentId('')
                  }}
                >
                  <option value="">Choose a hospital</option>
                  {(hospitals.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {tier !== 'system' && (
            <Field
              label="Department"
              required={tier === 'department'}
              hint={
                tier === 'department'
                  ? 'The one department this person sees and reports readiness for.'
                  : 'Optional for hospital-level roles.'
              }
            >
              {({ id }) => (
                <Select
                  id={id}
                  value={departmentId}
                  onChange={(event) => setDepartmentId(event.target.value)}
                  disabled={!targetHospitalId}
                >
                  <option value="">
                    {tier === 'department' ? 'Choose a department' : 'No department'}
                  </option>
                  {(departments.data ?? [])
                    .filter((department) => department.is_active)
                    .map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {needsHospital && !allowHospitalPick && (
          <Alert tone="warning" title="Pick a hospital first">
            A {ROLE_LABELS[role]} works at one facility. Choose it above, or invite them as a system
            administrator instead.
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => void submit()}
            loading={createInvite.isPending}
            disabled={!emailValid || needsHospital || needsDepartment}
          >
            <Send className="h-4 w-4" aria-hidden />
            Create invitation
          </Button>
        </div>

        <div>
          <p className="field-label mb-1.5">
            Pending invitations
            {invites.data && invites.data.length > 0 ? ` (${invites.data.length})` : ''}
          </p>
          {invites.isLoading ? (
            <LoadingBlock rows={2} />
          ) : (invites.data ?? []).length === 0 ? (
            <p className="hint">Nobody is waiting to accept an invitation.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {(invites.data ?? []).map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {invite.email}
                      {invite.full_name ? (
                        <span className="font-normal text-slate-500"> · {invite.full_name}</span>
                      ) : null}
                    </p>
                    <p className="hint">
                      {ROLE_LABELS[invite.role as UserRole] ?? invite.role}
                      {allowHospitalPick && invite.hospital_id
                        ? ` · ${hospitals.data?.find((h) => h.id === invite.hospital_id)?.name ?? 'hospital'}`
                        : ''}{' '}
                      &middot; expires {formatDateTime(invite.expires_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      revokeInvite.mutate(
                        { id: invite.id, hospitalId },
                        {
                          onSuccess: () => toast.success('Invitation revoked'),
                          onError: (error) => toast.error(error.message),
                        },
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

export interface StaffManagerProps {
  /** Overrides the signed-in user's hospital -- the system console manages any facility. */
  hospitalId?: string | null
  hospitalName?: string | null
}

export default function StaffManager({
  hospitalId: hospitalIdProp,
  hospitalName: hospitalNameProp,
}: StaffManagerProps = {}) {
  const { hospital, profile, role: currentRole, timezone } = useAuth()
  const isSuperAdmin = currentRole === 'super_admin'

  // A system administrator deliberately belongs to no single facility, so they
  // choose which one they are administering rather than being locked out.
  const hospitals = useHospitals({ onlyActive: false, enabled: isSuperAdmin && !hospital })
  const [pickedHospitalId, setPickedHospitalId] = useState('')

  const hospitalId =
    hospitalIdProp !== undefined
      ? hospitalIdProp
      : (hospital?.id ?? (isSuperAdmin ? pickedHospitalId || null : null))
  const hospitalName =
    hospitalNameProp ??
    hospital?.name ??
    hospitals.data?.find((item) => item.id === hospitalId)?.name ??
    null

  const staff = useStaff(hospitalId)
  const departments = useAdminDepartments(hospitalId)
  const updateStaff = useUpdateStaff()

  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)

  const [editing, setEditing] = useState<Profile | null>(null)
  const [deactivating, setDeactivating] = useState<Profile | null>(null)

  const rows = useMemo(() => staff.data ?? [], [staff.data])

  const visible = useMemo(() => {
    const term = state.q.trim().toLowerCase()
    return rows.filter((member) => {
      if (state.status === 'active' && !member.is_active) return false
      if (state.status === 'deactivated' && member.is_active) return false
      if (state.tier && ROLE_TIER_OF[member.role] !== state.tier) return false
      if (state.role && member.role !== state.role) return false
      if (state.department && member.department_id !== state.department) return false
      if (!term) return true
      return `${member.full_name} ${member.email} ${member.phone ?? ''} ${ROLE_LABELS[member.role]}`
        .toLowerCase()
        .includes(term)
    })
  }, [rows, state.q, state.status, state.tier, state.role, state.department])

  const tierCounts = useMemo(() => {
    const counts: Record<RoleTier, number> = { system: 0, hospital: 0, department: 0 }
    for (const member of rows) if (member.is_active) counts[ROLE_TIER_OF[member.role]] += 1
    return counts
  }, [rows])

  const grouped = useMemo(
    () =>
      ROLE_TIERS.map((tier) => ({
        tier,
        members: visible.filter((member) => ROLE_TIER_OF[member.role] === tier),
      })).filter((group) => group.members.length > 0),
    [visible],
  )

  if (!hospital && !isSuperAdmin && hospitalIdProp === undefined) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No hospital linked to your account"
          description="Staff are managed per facility. Ask a system administrator to attach your profile to one."
        />
      </Card>
    )
  }

  const departmentName = (id: string | null): string => {
    if (!id) return 'No department'
    return (
      departments.data?.find((department) => department.id === id)?.name ?? 'Unknown department'
    )
  }

  const setActive = async (member: Profile, isActive: boolean) => {
    try {
      await updateStaff.mutateAsync({
        userId: member.id,
        hospitalId,
        changes: { is_active: isActive },
      })
      toast.success(
        isActive ? `${member.full_name} reactivated` : `${member.full_name} deactivated`,
      )
      setDeactivating(null)
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.tier ? 1 : 0) +
    (state.role ? 1 : 0) +
    (state.department ? 1 : 0) +
    (state.status !== 'active' ? 1 : 0)

  const roleOptions = state.tier
    ? ROLES_BY_TIER[state.tier as RoleTier]
    : (Object.keys(ROLE_LABELS) as UserRole[])

  return (
    <div className="space-y-5">
      {isSuperAdmin && !hospital && hospitalIdProp === undefined && (
        <Card>
          <CardBody>
            <Field
              label="Hospital"
              hint="You administer the whole network, so pick the facility to manage. Leave blank to list everyone."
            >
              {({ id }) => (
                <Select
                  id={id}
                  value={pickedHospitalId}
                  onChange={(event) => setPickedHospitalId(event.target.value)}
                  className="sm:max-w-sm"
                >
                  <option value="">All hospitals</option>
                  {(hospitals.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Staff"
          description={
            hospitalName
              ? `People with an account at ${hospitalName}.`
              : 'Everyone with an account across the network.'
          }
          action={
            staff.data ? (
              <Badge tone="neutral">
                {rows.filter((member) => member.is_active).length} active
              </Badge>
            ) : undefined
          }
        />

        <CardBody className="space-y-3 border-b border-slate-200 py-3 dark:border-slate-800">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              containerClassName="flex-1"
              value={state.q}
              onChange={(value) => update({ q: value })}
              placeholder="Name, email or phone"
              aria-label="Search staff"
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
            {(departments.data?.length ?? 0) > 0 && (
              <Select
                aria-label="Filter by department"
                className="lg:w-56"
                value={state.department}
                onChange={(event) => update({ department: event.target.value })}
              >
                <option value="">Any department</option>
                {(departments.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Level</span>
            {ROLE_TIERS.map((tier) => {
              const Icon = TIER_ICONS[tier]
              return (
                <Chip
                  key={tier}
                  active={state.tier === tier}
                  onClick={() => update({ tier: state.tier === tier ? '' : tier, role: '' })}
                  count={tierCounts[tier]}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {ROLE_TIER_LABELS[tier]}
                </Chip>
              )
            })}
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => reset()}>
                Clear filters
              </Button>
            )}
          </div>
        </CardBody>

        {staff.isLoading ? (
          <LoadingBlock label="Loading staff" rows={4} />
        ) : staff.isError ? (
          <CardBody>
            <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} />
          </CardBody>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No staff accounts yet"
            description="Invite your first colleague using the steps below."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="Nobody matches these filters"
            description="Deactivated accounts are hidden unless you switch the status filter."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        ) : (
          grouped.map(({ tier, members }) => {
            const Icon = TIER_ICONS[tier]
            return (
              <section key={tier} aria-label={`${ROLE_TIER_LABELS[tier]} level`}>
                <h3 className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {ROLE_TIER_LABELS[tier]} level
                  <span className="font-normal normal-case tracking-normal">
                    · {members.length}
                  </span>
                </h3>
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {members.map((member) => {
                    const isSelf = member.id === profile?.id
                    return (
                      <li
                        key={member.id}
                        className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar name={member.full_name} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {member.full_name}
                              </p>
                              <RoleBadge role={member.role} />
                              {isSelf && <Badge tone="neutral">You</Badge>}
                              {!member.is_active && <Badge tone="danger">Deactivated</Badge>}
                            </div>
                            <p className="mt-0.5 truncate hint">{member.email}</p>
                            <p className="mt-0.5 hint">
                              {departmentName(member.department_id)} - last signed in{' '}
                              <span
                                title={
                                  member.last_login_at
                                    ? formatDateTime(member.last_login_at, timezone)
                                    : undefined
                                }
                              >
                                {member.last_login_at
                                  ? relativeTime(member.last_login_at)
                                  : 'never'}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(member)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Edit
                          </Button>
                          {member.is_active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isSelf}
                              onClick={() => setDeactivating(member)}
                              aria-label={`Deactivate ${member.full_name}`}
                            >
                              <PowerOff className="h-3.5 w-3.5" aria-hidden />
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={updateStaff.isPending}
                              onClick={() => void setActive(member, true)}
                              aria-label={`Reactivate ${member.full_name}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </Card>

      <InvitePanel hospitalId={hospitalId} hospitalName={hospitalName} />

      {editing && (
        <EditStaffModal
          key={editing.id}
          member={editing}
          departments={departments.data ?? []}
          hospitalId={hospitalId}
          canGrantSuperAdmin={currentRole === 'super_admin'}
          isSelf={editing.id === profile?.id}
          onClose={() => setEditing(null)}
        />
      )}

      <Modal
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        title="Deactivate this account?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={updateStaff.isPending}
              onClick={() => deactivating && void setActive(deactivating, false)}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {deactivating?.full_name} will no longer be able to sign in or submit readiness updates.
          Their past submissions and referrals are kept. You can reactivate the account later.
        </p>
      </Modal>
    </div>
  )
}
