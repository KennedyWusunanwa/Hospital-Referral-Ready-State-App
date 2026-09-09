import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Building2, ClipboardList, Pencil, Plus, PowerOff, RotateCcw } from 'lucide-react'
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
  Input,
  LoadingBlock,
  Modal,
  Select,
  Toggle,
} from '@/components/ui'
import {
  DEPARTMENT_TEMPLATES,
  DEPARTMENT_TEMPLATE_KEYS,
  RESOURCES,
  type DepartmentTemplateKey,
} from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { Department } from '@/lib/types'
import {
  useAdminDepartments,
  useDeleteDepartment,
  useDepartmentHistoryCount,
  useUpsertDepartment,
} from './useAdmin'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a department name').max(120),
  template_key: z.enum(DEPARTMENT_TEMPLATE_KEYS),
  contact_phone: z.string().trim().max(40),
  requires_shift_update: z.boolean(),
})

type FormValues = z.infer<typeof schema>

/** Shows exactly which readiness fields a template makes the department own. */
function TemplateSummary({ templateKey }: { templateKey: DepartmentTemplateKey }) {
  const template = DEPARTMENT_TEMPLATES[templateKey]
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Reports each shift
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {template.resources.map((key) => (
          <li key={key}>
            <Badge tone="neutral">{RESOURCES[key].label}</Badge>
          </li>
        ))}
      </ul>
      {(template.collectsBloodStock || template.controlsErStatus) && (
        <ul className="mt-2 space-y-1 hint">
          {template.collectsBloodStock && <li>Also records blood units by group.</li>}
          {template.controlsErStatus && (
            <li>Also sets the hospital-wide emergency room open / on-diversion flag.</li>
          )}
        </ul>
      )}
    </div>
  )
}

function DepartmentFormModal({
  open,
  onClose,
  hospitalId,
  department,
}: {
  open: boolean
  onClose: () => void
  hospitalId: string
  department: Department | null
}) {
  const upsertDepartment = useUpsertDepartment()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: department?.name ?? '',
      template_key: department?.template_key ?? 'general',
      contact_phone: department?.contact_phone ?? '',
      requires_shift_update: department?.requires_shift_update ?? true,
    },
  })

  const templateKey = form.watch('template_key')
  const requiresShiftUpdate = form.watch('requires_shift_update')

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await upsertDepartment.mutateAsync({
        id: department?.id,
        hospital_id: hospitalId,
        name: values.name,
        template_key: values.template_key,
        contact_phone: values.contact_phone || null,
        requires_shift_update: values.requires_shift_update,
        is_active: department?.is_active ?? true,
      })
      toast.success(department ? 'Department updated' : 'Department created')
      onClose()
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={department ? `Edit ${department.name}` : 'New department'}
      description="The template decides which readiness fields the shift in-charge is asked for."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} loading={upsertDepartment.isPending}>
            {department ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        <Field label="Department name" required error={form.formState.errors.name?.message}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              autoFocus
              aria-describedby={describedBy}
              placeholder="e.g. Accident & Emergency"
              {...form.register('name')}
            />
          )}
        </Field>

        <Field
          label="Template"
          required
          hint="Pick the closest match; it sets the readiness form for this department."
          error={form.formState.errors.template_key?.message}
        >
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...form.register('template_key')}>
              {DEPARTMENT_TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {DEPARTMENT_TEMPLATES[key].label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <TemplateSummary templateKey={templateKey} />

        <Field label="Contact phone" error={form.formState.errors.contact_phone?.message}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="tel"
              inputMode="tel"
              aria-describedby={describedBy}
              {...form.register('contact_phone')}
            />
          )}
        </Field>

        <Toggle
          checked={requiresShiftUpdate}
          onChange={(next) => form.setValue('requires_shift_update', next, { shouldDirty: true })}
          label="Requires a readiness update every shift"
          description="Departments with this off are never counted as overdue and never raise an alert."
        />
      </form>
    </Modal>
  )
}

function DeactivateModal({
  department,
  hospitalId,
  onClose,
}: {
  department: Department | null
  hospitalId: string
  onClose: () => void
}) {
  const deleteDepartment = useDeleteDepartment()
  const historyCount = useDepartmentHistoryCount(department?.id ?? null)

  const confirm = async () => {
    if (!department) return
    try {
      await deleteDepartment.mutateAsync({ departmentId: department.id, hospitalId })
      toast.success(`${department.name} retired`)
      onClose()
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  return (
    <Modal
      open={Boolean(department)}
      onClose={onClose}
      title="Retire this department?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleteDepartment.isPending} onClick={() => void confirm()}>
            Retire department
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {department?.name} will stop appearing in the readiness board and will no longer be asked
          for a shift update. It can be restored at any time.
        </p>
        {historyCount.isLoading ? (
          <p className="hint">Checking readiness history...</p>
        ) : historyCount.data && historyCount.data > 0 ? (
          <Alert tone="warning" title="This department has readiness history">
            {historyCount.data} readiness {historyCount.data === 1 ? 'update' : 'updates'} were
            submitted here. They are kept for compliance reporting, so past figures will still
            include this department.
          </Alert>
        ) : null}
      </div>
    </Modal>
  )
}

export default function DepartmentManager() {
  const { hospital } = useAuth()
  const hospitalId = hospital?.id ?? null
  const departments = useAdminDepartments(hospitalId)
  const upsertDepartment = useUpsertDepartment()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [deactivating, setDeactivating] = useState<Department | null>(null)

  if (!hospital || !hospitalId) {
    return (
      <Card>
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No hospital linked to your account"
          description="Departments belong to a facility. Ask a system administrator to attach your profile to one."
        />
      </Card>
    )
  }

  const reactivate = async (department: Department) => {
    try {
      await upsertDepartment.mutateAsync({
        id: department.id,
        hospital_id: hospitalId,
        is_active: true,
      })
      toast.success(`${department.name} restored`)
    } catch (error) {
      toast.error(humanizeSupabaseError(error))
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (department: Department) => {
    setEditing(department)
    setFormOpen(true)
  }

  return (
    <Card>
      <CardHeader
        title="Departments"
        description="Each department reports its own readiness once per shift."
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            New department
          </Button>
        }
      />

      {departments.isLoading ? (
        <LoadingBlock label="Loading departments" rows={4} />
      ) : departments.isError ? (
        <CardBody>
          <ErrorBlock error={departments.error} onRetry={() => void departments.refetch()} />
        </CardBody>
      ) : (departments.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No departments yet"
          description="Add the departments that report readiness -- typically emergency, theatre, ICU and the blood bank."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              New department
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {departments.data?.map((department) => {
            const template = DEPARTMENT_TEMPLATES[department.template_key]
            return (
              <li
                key={department.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {department.name}
                    </p>
                    <Badge tone="brand">{template?.label ?? department.template_key}</Badge>
                    {!department.is_active && <Badge tone="neutral">Retired</Badge>}
                    {department.is_active && !department.requires_shift_update && (
                      <Badge tone="warning">No shift update required</Badge>
                    )}
                  </div>
                  <p className="mt-1 hint">
                    {template
                      ? `${template.resources.length} readiness ${
                          template.resources.length === 1 ? 'field' : 'fields'
                        }`
                      : 'Unknown template'}
                    {department.contact_phone ? ` - ${department.contact_phone}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(department)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                  {department.is_active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeactivating(department)}
                      aria-label={`Retire ${department.name}`}
                    >
                      <PowerOff className="h-3.5 w-3.5" aria-hidden />
                      Retire
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={upsertDepartment.isPending}
                      onClick={() => void reactivate(department)}
                      aria-label={`Restore ${department.name}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Restore
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {formOpen && (
        <DepartmentFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          hospitalId={hospitalId}
          department={editing}
        />
      )}

      <DeactivateModal
        department={deactivating}
        hospitalId={hospitalId}
        onClose={() => setDeactivating(null)}
      />
    </Card>
  )
}
