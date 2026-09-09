import { useState } from 'react'
import { toast } from 'sonner'
import { Building2, Check, Copy, Pencil, PowerOff, RotateCcw, Users } from 'lucide-react'
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
import { useAdminDepartments, useStaff, useUpdateStaff } from './useAdmin'

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

function InvitePanel({ hospitalId, hospitalName }: { hospitalId: string; hospitalName: string }) {
  const [role, setRole] = useState<UserRole>('shift_in_charge')
  const [copied, setCopied] = useState(false)

  // Role and hospital travel in app_metadata, which GoTrue lets ONLY the service
  // role write. If they came from user_metadata, anyone could self-assign
  // super_admin in the signup request itself, so the invite has to go through
  // the Admin API rather than the dashboard's User Metadata box.
  const payload = JSON.stringify({
    email: 'colleague@hospital.org',
    email_confirm: true,
    user_metadata: { full_name: 'Full Name' },
    app_metadata: { role, hospital_id: hospitalId },
  })

  const command = [
    'curl -X POST "$SUPABASE_URL/auth/v1/admin/users" \\',
    '  -H "apikey: $SERVICE_ROLE_KEY" \\',
    '  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${payload}'`,
  ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toast.success('Command copied')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Your browser blocked the clipboard. Select the text and copy it manually.')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Invite a colleague"
        description={`How a new account for ${hospitalName} is created.`}
      />
      <CardBody className="space-y-4">
        <Alert tone="info" title="This screen cannot create the account itself">
          Creating a user requires a privileged key that must never reach a browser. An
          administrator completes the invite in the Supabase dashboard; the steps below produce a
          profile that is already attached to this hospital.
        </Alert>

        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            Run the command below from a terminal, with{' '}
            <span className="font-mono text-xs">SUPABASE_URL</span> and{' '}
            <span className="font-mono text-xs">SERVICE_ROLE_KEY</span> set from the project&rsquo;s
            API settings. Replace the email and name.
          </li>
          <li>
            The signup trigger reads <span className="font-medium">app_metadata</span> and creates
            the profile already attached to {hospitalName} with the role you picked.
          </li>
          <li>
            Send them a password-reset link so they can set their own password, then confirm they
            appear in the staff list on this page.
          </li>
        </ol>

        <Alert tone="warning" title="Do not paste the role into User metadata">
          The dashboard&rsquo;s <span className="font-medium">User metadata</span> box is writable by
          the account holder, so a role set there would let anyone grant themselves administrator
          rights. Only <span className="font-medium">app_metadata</span>, which the service-role key
          above sets, is trusted. Never run this command anywhere the key could be exposed.
        </Alert>

        <Field label="Role to grant" hint={ROLE_DESCRIPTIONS[role]}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className="sm:max-w-xs"
            >
              {USER_ROLES.filter((option) => option !== 'super_admin').map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="field-label">Admin API invite command</p>
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy command'}
            </Button>
          </div>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
            {command}
          </pre>
        </div>
      </CardBody>
    </Card>
  )
}

export default function StaffManager() {
  const { hospital, profile, role: currentRole, timezone } = useAuth()
  const hospitalId = hospital?.id ?? null
  const staff = useStaff(hospitalId)
  const departments = useAdminDepartments(hospitalId)
  const updateStaff = useUpdateStaff()

  const [editing, setEditing] = useState<Profile | null>(null)
  const [deactivating, setDeactivating] = useState<Profile | null>(null)

  if (!hospital || !hospitalId) {
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
      <Card>
        <CardHeader
          title="Staff"
          description={`People with an account at ${hospital.name}.`}
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

      <InvitePanel hospitalId={hospitalId} hospitalName={hospital.name} />

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
