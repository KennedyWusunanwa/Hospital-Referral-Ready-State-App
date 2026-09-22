import { useState } from 'react'
import { toast } from 'sonner'
import { Building2, Mail, Pencil, PowerOff, RotateCcw, Send, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Input,
  Modal,
  Select,
} from '@/components/ui'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SUPPORT_EMAIL,
  USER_ROLES,
  type UserRole,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import { formatDateTime, initials } from '@/lib/utils'
import type { Department, Profile } from '@/lib/types'
import { useHospitals } from '@/features/hospitals/useHospitals'
import { useAdminDepartments, useStaff, useUpdateStaff } from './useAdmin'
import { useCreateInvite, useRevokeInvite, useStaffInvites } from './useAppSettings'

const ROLE_TONES: Record<UserRole, 'brand' | 'info' | 'success' | 'warning' | 'neutral'> = {
  super_admin: 'warning',
  hospital_admin: 'brand',
  shift_in_charge: 'info',
  referral_coordinator: 'success',
  viewer: 'neutral',
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
  const roleOptions = USER_ROLES.filter(
    (option) => option !== 'super_admin' || canGrantSuperAdmin || member.role === 'super_admin',
  )

  const save = async () => {
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
          <Button loading={updateStaff.isPending} onClick={() => void save()}>
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
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
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
          hint="Shift in-charges only see the readiness form for their own department."
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

function InvitePanel({
  hospitalId,
  hospitalName,
}: {
  hospitalId: string | null
  hospitalName: string | null
}) {
  const { role: currentRole } = useAuth()
  const invites = useStaffInvites(hospitalId)
  const departments = useAdminDepartments(hospitalId)
  const createInvite = useCreateInvite()
  const revokeInvite = useRevokeInvite()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('shift_in_charge')
  const [departmentId, setDepartmentId] = useState<string>('')

  // Only a system administrator can mint another one; the RLS policy enforces
  // the same rule, this just keeps it out of the menu.
  const roleOptions = USER_ROLES.filter(
    (option) => option !== 'super_admin' || currentRole === 'super_admin',
  )

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  // Every role except a system administrator is scoped to one facility, so an
  // invite for them is meaningless without a hospital to attach it to.
  const needsHospital = role !== 'super_admin' && !hospitalId

  const submit = async () => {
    if (!emailValid) {
      toast.error('Enter a valid email address.')
      return
    }
    if (needsHospital) {
      toast.error('Choose which hospital this person belongs to first.')
      return
    }
    try {
      await createInvite.mutateAsync({
        email: email.trim(),
        full_name: fullName.trim() || null,
        role,
        hospital_id: hospitalId,
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
          hospitalName ? `Give someone access to ${hospitalName}.` : 'Give someone access.'
        }
        action={<Mail className="h-5 w-5 text-slate-300 dark:text-slate-600" aria-hidden />}
      />
      <CardBody className="space-y-4">
        <Alert tone="info" title="How this works">
          You record the role an email address should get. The person then signs in from the login
          screen using <span className="font-medium">Email code</span> with that same address, and
          their account is created with the role and hospital you chose here. No password to share,
          and no privileged key in the browser.
        </Alert>

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
              >
                {roleOptions.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Department" hint="Required for a shift in-charge to submit readiness.">
            {({ id }) => (
              <Select
                id={id}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">No department</option>
                {(departments.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {needsHospital && (
          <Alert tone="warning" title="Pick a hospital first">
            A {ROLE_LABELS[role]} works at one facility. Choose it above, or invite them as a system
            administrator instead.
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => void submit()}
            loading={createInvite.isPending}
            disabled={!emailValid || needsHospital}
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
                    </p>
                    <p className="hint">
                      {ROLE_LABELS[invite.role as UserRole] ?? invite.role} &middot; expires{' '}
                      {formatDateTime(invite.expires_at)}
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

export default function StaffManager() {
  const { hospital, profile, role: currentRole, timezone } = useAuth()
  const isSuperAdmin = currentRole === 'super_admin'
  // A system administrator deliberately belongs to no single facility, so they
  // choose which one they are administering rather than being locked out.
  const hospitals = useHospitals({ onlyActive: false })
  const [pickedHospitalId, setPickedHospitalId] = useState('')

  const hospitalId = hospital?.id ?? (isSuperAdmin ? pickedHospitalId || null : null)
  const hospitalName =
    hospital?.name ?? hospitals.data?.find((item) => item.id === hospitalId)?.name ?? null

  const staff = useStaff(hospitalId)
  const departments = useAdminDepartments(hospitalId)
  const updateStaff = useUpdateStaff()

  const [editing, setEditing] = useState<Profile | null>(null)
  const [deactivating, setDeactivating] = useState<Profile | null>(null)

  if (!hospital && !isSuperAdmin) {
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
    return departments.data?.find((department) => department.id === id)?.name ?? 'Unknown department'
  }

  const setActive = async (member: Profile, isActive: boolean) => {
    try {
      await updateStaff.mutateAsync({
        userId: member.id,
        hospitalId,
        changes: { is_active: isActive },
      })
      toast.success(isActive ? `${member.full_name} reactivated` : `${member.full_name} deactivated`)
      setDeactivating(null)
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  return (
    <div className="space-y-5">
      {isSuperAdmin && !hospital && (
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
                {staff.data.filter((member) => member.is_active).length} active
              </Badge>
            ) : undefined
          }
        />

        {staff.isLoading ? (
          <LoadingBlock label="Loading staff" rows={4} />
        ) : staff.isError ? (
          <CardBody>
            <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} />
          </CardBody>
        ) : (staff.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No staff accounts yet"
            description="Invite your first colleague using the steps below."
          />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {staff.data?.map((member) => {
              const isSelf = member.id === profile?.id
              return (
                <li
                  key={member.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {initials(member.full_name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {member.full_name}
                        </p>
                        <Badge tone={ROLE_TONES[member.role]}>{ROLE_LABELS[member.role]}</Badge>
                        {isSelf && <Badge tone="neutral">You</Badge>}
                        {!member.is_active && <Badge tone="danger">Deactivated</Badge>}
                      </div>
                      <p className="mt-0.5 truncate hint">{member.email}</p>
                      <p className="mt-0.5 hint">
                        {departmentName(member.department_id)} - last signed in{' '}
                        {member.last_login_at ? formatDateTime(member.last_login_at, timezone) : 'never'}
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
