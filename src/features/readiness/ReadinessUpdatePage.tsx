/**
 * The shift in-charge's readiness form for a single department.
 *
 * Two things here are deliberate rather than decorative. The form auto-saves to
 * localStorage, because a ward tablet loses its session mid-shift more often
 * than anyone would like. And nothing is written until the in-charge confirms a
 * list of exactly what changed: a mis-keyed zero on this screen diverts an
 * ambulance to the wrong hospital.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useController, useForm, type Control } from 'react-hook-form'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, History, Save } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Textarea,
  Toggle,
} from '@/components/ui'
import {
  BLOOD_GROUPS,
  DEPARTMENT_TEMPLATES,
  RESOURCES,
  RESOURCE_GROUP_LABELS,
  RESOURCE_KEYS,
  type BloodGroup,
  type DepartmentTemplate,
  type ResourceDefinition,
  type ResourceKey,
} from '@/lib/constants'
import type {
  BloodStock,
  Department,
  HospitalResources,
  ReadinessPayload,
  ReadinessUpdate,
} from '@/lib/types'
import { humanizeSupabaseError } from '@/lib/supabase'
import { formatDateTime, formatTime, groupBy } from '@/lib/utils'
import { getShiftAt, shiftLabel, type ShiftRef } from '@/domain/shifts'
import {
  ResourceFieldGroup,
  buildReadinessResolver,
  formatResourceValue,
  readCurrentResources,
  readCurrentTotals,
  type ReadinessFormValues,
} from './ResourceFieldGroup'
import {
  useBloodStock,
  useCurrentShiftUpdate,
  useDepartment,
  useHospitalResources,
  useReadinessHistory,
  useSubmitReadiness,
} from './useReadiness'

const DRAFT_DEBOUNCE_MS = 800

function draftKey(departmentId: string, shift: ShiftRef): string {
  return `fern.readiness.draft.${departmentId}.${shift.shiftDate}.${shift.shiftType}`
}

function readDraft(key: string): Partial<ReadinessFormValues> | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<ReadinessFormValues>)
      : null
  } catch {
    // Private browsing, or a draft written by an older version of the form.
    return null
  }
}

function writeDraft(key: string, serialised: string): boolean {
  try {
    window.localStorage.setItem(key, serialised)
    return true
  } catch {
    return false
  }
}

function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to do -- an orphaned draft is keyed to a shift that has passed.
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function mergeDraft(
  base: ReadinessFormValues,
  draft: Partial<ReadinessFormValues>,
): ReadinessFormValues {
  const resources = { ...base.resources }
  const totals = { ...base.totals }
  const bloodStock = { ...base.bloodStock }

  for (const key of RESOURCE_KEYS) {
    const value = draft.resources?.[key]
    // A blank number field serialises to null; fall back to the value on record
    // rather than restoring an empty box the in-charge has to re-enter.
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      resources[key] = value
    }
    const total = draft.totals?.[key]
    if (typeof total === 'number' && Number.isFinite(total)) totals[key] = total
  }

  for (const group of BLOOD_GROUPS) {
    const units = draft.bloodStock?.[group]
    if (typeof units === 'number' && Number.isFinite(units)) bloodStock[group] = units
  }

  return {
    resources,
    totals,
    bloodStock,
    erOpen: typeof draft.erOpen === 'boolean' ? draft.erOpen : base.erOpen,
    diversionReason:
      typeof draft.diversionReason === 'string' ? draft.diversionReason : base.diversionReason,
    notes: typeof draft.notes === 'string' ? draft.notes : base.notes,
  }
}

function buildDefaultValues(input: {
  resources: HospitalResources | null
  bloodStock: BloodStock[]
  currentUpdate: ReadinessUpdate | null
  draft: Partial<ReadinessFormValues> | null
}): ReadinessFormValues {
  const onRecord = readCurrentResources(input.resources)
  const onRecordTotals = readCurrentTotals(input.resources)
  const submitted = input.currentUpdate?.payload.resources ?? {}

  const resources = {} as Record<ResourceKey, number | boolean>
  const totals = {} as Record<ResourceKey, number>
  for (const key of RESOURCE_KEYS) {
    const fallback: number | boolean = RESOURCES[key].kind === 'boolean' ? false : 0
    resources[key] = submitted[key] ?? onRecord[key] ?? fallback
    totals[key] = onRecordTotals[key] ?? 0
  }

  const bloodStock = {} as Record<BloodGroup, number>
  for (const group of BLOOD_GROUPS) {
    bloodStock[group] = input.bloodStock.find((row) => row.blood_group === group)?.units ?? 0
  }

  const base: ReadinessFormValues = {
    resources,
    totals,
    bloodStock,
    erOpen: input.currentUpdate?.payload.er_open ?? input.resources?.er_open ?? true,
    diversionReason:
      input.currentUpdate?.payload.diversion_reason ?? input.resources?.diversion_reason ?? '',
    notes: input.currentUpdate?.notes ?? '',
  }

  return input.draft ? mergeDraft(base, input.draft) : base
}

// ---------------------------------------------------------------------------
// Change summary
// ---------------------------------------------------------------------------

interface Delta {
  label: string
  from: string
  to: string
}

function computeDeltas(
  values: ReadinessFormValues,
  template: DepartmentTemplate,
  resources: HospitalResources | null,
  bloodStock: BloodStock[],
): Delta[] {
  const onRecord = readCurrentResources(resources)
  const onRecordTotals = readCurrentTotals(resources)
  const deltas: Delta[] = []

  for (const key of template.resources) {
    const definition = RESOURCES[key]
    const next = values.resources[key]
    const previous = onRecord[key]
    if (previous !== next) {
      deltas.push({
        label: definition.label,
        from: formatResourceValue(key, previous),
        to: formatResourceValue(key, next),
      })
    }
    if (definition.totalColumn && onRecordTotals[key] !== values.totals[key]) {
      deltas.push({
        label: `${definition.label} - total capacity`,
        from: formatResourceValue(key, onRecordTotals[key]),
        to: formatResourceValue(key, values.totals[key]),
      })
    }
  }

  if (template.collectsBloodStock) {
    for (const group of BLOOD_GROUPS) {
      const previous = bloodStock.find((row) => row.blood_group === group)?.units ?? 0
      if (previous !== values.bloodStock[group]) {
        deltas.push({
          label: `Blood units ${group}`,
          from: `${previous}`,
          to: `${values.bloodStock[group]}`,
        })
      }
    }
  }

  if (template.controlsErStatus) {
    const previousOpen = resources?.er_open ?? true
    if (previousOpen !== values.erOpen) {
      deltas.push({
        label: 'Emergency room',
        from: previousOpen ? 'Open' : 'On diversion',
        to: values.erOpen ? 'Open' : 'On diversion',
      })
    }
    const previousReason = resources?.diversion_reason ?? ''
    if (!values.erOpen && previousReason !== values.diversionReason) {
      deltas.push({
        label: 'Diversion reason',
        from: previousReason || 'none',
        to: values.diversionReason || 'none',
      })
    }
  }

  return deltas
}

// ---------------------------------------------------------------------------
// Blood stock
// ---------------------------------------------------------------------------

function BloodGroupField({
  group,
  control,
  current,
}: {
  group: BloodGroup
  control: Control<ReadinessFormValues>
  current: number
}) {
  const { field, fieldState } = useController({ control, name: `bloodStock.${group}` })
  return (
    <Field label={`${group} units`} hint={`On record: ${current}`} error={fieldState.error?.message}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={Number.isFinite(field.value) ? String(field.value) : ''}
          onChange={(event) =>
            field.onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
          }
          onBlur={field.onBlur}
        />
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function ReadinessForm({
  department,
  template,
  resources,
  bloodStock,
  currentUpdate,
}: {
  department: Department
  template: DepartmentTemplate
  resources: HospitalResources | null
  bloodStock: BloodStock[]
  currentUpdate: ReadinessUpdate | null
}) {
  const navigate = useNavigate()
  const { timezone } = useAuth()
  const submit = useSubmitReadiness()

  // Pinned at mount: if the shift rolls over while the form is open, the draft
  // must keep saving under the key it was restored from.
  const [shift] = useState<ShiftRef>(() => getShiftAt(new Date(), timezone))
  const storageKey = draftKey(department.id, shift)

  const [defaultValues] = useState<ReadinessFormValues>(() =>
    buildDefaultValues({ resources, bloodStock, currentUpdate, draft: readDraft(storageKey) }),
  )
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  const [pending, setPending] = useState<ReadinessFormValues | null>(null)

  const resolver = useMemo(() => buildReadinessResolver(template), [template])
  const { control, register, handleSubmit, watch, formState } = useForm<ReadinessFormValues>({
    defaultValues,
    resolver,
    mode: 'onBlur',
  })

  const watched = watch()
  const erOpen = useController({ control, name: 'erOpen' })

  // Seeded with the mounted values so a restored draft is not re-saved, and so
  // marking the save does not itself count as a change and loop forever.
  const lastSavedRef = useRef(JSON.stringify(defaultValues))

  useEffect(() => {
    const serialised = JSON.stringify(watched)
    if (serialised === lastSavedRef.current) return
    const timer = window.setTimeout(() => {
      lastSavedRef.current = serialised
      if (writeDraft(storageKey, serialised)) setDraftSavedAt(new Date())
    }, DRAFT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [watched, storageKey])

  const groups = useMemo(() => {
    const byGroup = groupBy([...template.resources], (key) => RESOURCES[key].group)
    return (Object.keys(byGroup) as Array<ResourceDefinition['group']>).map((group) => ({
      group,
      keys: byGroup[group],
    }))
  }, [template])

  const onRecord = useMemo(() => readCurrentResources(resources), [resources])
  const deltas = useMemo(
    () => (pending ? computeDeltas(pending, template, resources, bloodStock) : []),
    [pending, template, resources, bloodStock],
  )

  const confirm = () => {
    if (!pending) return

    const reported: ReadinessPayload['resources'] = {}
    const totals: Record<string, number> = {}
    for (const key of template.resources) {
      reported[key] = pending.resources[key]
      if (RESOURCES[key].totalColumn) totals[key] = pending.totals[key]
    }

    const blood: Record<string, number> = {}
    if (template.collectsBloodStock) {
      for (const group of BLOOD_GROUPS) blood[group] = pending.bloodStock[group]
    }

    // Capacity denominators ride alongside the readings so `submit_readiness`
    // can refresh the *_total columns in the same write.
    const payload: ReadinessPayload = {
      resources: reported,
      totals,
      ...(template.collectsBloodStock ? { blood_stock: blood } : {}),
      ...(template.controlsErStatus
        ? {
            er_open: pending.erOpen,
            diversion_reason: pending.erOpen ? null : pending.diversionReason.trim(),
          }
        : {}),
    }

    submit.mutate(
      { departmentId: department.id, payload, notes: pending.notes },
      {
        onSuccess: () => {
          clearDraft(storageKey)
          setPending(null)
          toast.success(`${department.name} readiness recorded for the ${shift.shiftType} shift.`)
          navigate('/readiness')
        },
        onError: (error) => toast.error(humanizeSupabaseError(error)),
      },
    )
  }

  return (
    <>
      <form onSubmit={handleSubmit((values) => setPending(values))} noValidate>
        <Card>
          <CardHeader
            title={`Report for the ${shift.shiftType} shift`}
            description={shiftLabel(shift)}
            action={
              draftSavedAt && (
                <span className="inline-flex items-center gap-1.5 hint">
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Draft saved {formatTime(draftSavedAt, timezone)}
                </span>
              )
            }
          />
          <CardBody className="space-y-6">
            {currentUpdate && (
              <Alert tone="success" title="Already reported this shift">
                Submitted {formatDateTime(currentUpdate.submitted_at, timezone)}. The values below
                are what is currently on record -- change only what has moved.
              </Alert>
            )}

            {groups.map(({ group, keys }) => (
              <ResourceFieldGroup
                key={group}
                title={RESOURCE_GROUP_LABELS[group]}
                resourceKeys={keys}
                control={control}
                current={onRecord}
              />
            ))}

            {template.controlsErStatus && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Emergency room status
                </h3>
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <Toggle
                    checked={erOpen.field.value}
                    onChange={erOpen.field.onChange}
                    label="Emergency room open to referrals"
                    description="Switch this off to go on diversion. Hospitals on diversion are never recommended."
                  />
                </div>
                {!erOpen.field.value && (
                  <Field
                    label="Why is the emergency room on diversion?"
                    hint="Referring hospitals see this before they call."
                    error={formState.errors.diversionReason?.message}
                    required
                  >
                    {({ id, describedBy }) => (
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        placeholder="e.g. No functioning theatre until 18:00"
                        {...register('diversionReason')}
                      />
                    )}
                  </Field>
                )}
              </section>
            )}

            {template.collectsBloodStock && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Blood stock
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {BLOOD_GROUPS.map((group) => (
                    <BloodGroupField
                      key={group}
                      group={group}
                      control={control}
                      current={bloodStock.find((row) => row.blood_group === group)?.units ?? 0}
                    />
                  ))}
                </div>
              </section>
            )}

            <Field
              label="Notes for the next shift"
              hint="Optional. Anything a referring hospital or the incoming in-charge should know."
              error={formState.errors.notes?.message}
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  placeholder="e.g. Second theatre back in service from 20:00"
                  {...register('notes')}
                />
              )}
            </Field>
          </CardBody>
          <CardFooter>
            <Button type="button" variant="ghost" onClick={() => navigate('/readiness')}>
              Cancel
            </Button>
            <Button type="submit">
              {currentUpdate ? "Update this shift's submission" : 'Review and submit'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Confirm what changed"
        description={`${department.name} - ${shiftLabel(shift)}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={submit.isPending}>
              Go back
            </Button>
            <Button onClick={confirm} loading={submit.isPending}>
              Confirm and submit
            </Button>
          </>
        }
      >
        {deltas.length === 0 ? (
          <Alert tone="info" title="Nothing has changed">
            Submitting confirms the values already on record for this shift, which is enough to keep
            the department green.
          </Alert>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {deltas.map((delta) => (
              <li key={delta.label} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-slate-700 dark:text-slate-300">{delta.label}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-slate-400 line-through">{delta.from}</span>
                  <span className="mx-1.5 text-slate-400" aria-hidden>
                    -&gt;
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {delta.to}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Recent submissions
// ---------------------------------------------------------------------------

function RecentSubmissions({ departmentId }: { departmentId: string }) {
  const { timezone } = useAuth()
  const query = useReadinessHistory(departmentId, 7)

  return (
    <Card>
      <CardHeader title="Recent submissions" description="The last seven days." />
      {query.isPending ? (
        <LoadingBlock label="Loading submissions" rows={3} />
      ) : query.isError ? (
        <CardBody>
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        </CardBody>
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          icon={<History className="h-8 w-8" />}
          title="No submissions yet"
          description="This department has not reported in the last seven days."
        />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {(query.data ?? []).map((update) => (
            <li key={update.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {shiftLabel({ shiftDate: update.shift_date, shiftType: update.shift_type })}
                </span>
                <Badge tone="neutral">{formatDateTime(update.submitted_at, timezone)}</Badge>
              </div>
              {update.notes && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{update.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReadinessUpdatePage() {
  const { departmentId } = useParams<{ departmentId: string }>()
  const navigate = useNavigate()

  const departmentQuery = useDepartment(departmentId ?? null)
  const department = departmentQuery.data ?? null
  const hospitalId = department?.hospital_id ?? null

  const resourcesQuery = useHospitalResources(hospitalId)
  const bloodQuery = useBloodStock(hospitalId)
  const currentShiftQuery = useCurrentShiftUpdate(departmentId ?? null)

  const template = department ? DEPARTMENT_TEMPLATES[department.template_key] : null

  const body = () => {
    if (departmentQuery.isPending) return <LoadingBlock label="Loading department" rows={4} />
    if (departmentQuery.isError) {
      return (
        <ErrorBlock error={departmentQuery.error} onRetry={() => void departmentQuery.refetch()} />
      )
    }
    if (!department || !template) {
      return (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title="Department not found"
          description="This department may have been removed, or it belongs to another hospital."
          action={
            <Button variant="outline" onClick={() => navigate('/readiness')}>
              Back to the board
            </Button>
          }
        />
      )
    }
    if (resourcesQuery.isError) {
      return <ErrorBlock error={resourcesQuery.error} onRetry={() => void resourcesQuery.refetch()} />
    }
    if (resourcesQuery.isPending || bloodQuery.isPending || currentShiftQuery.isPending) {
      return <LoadingBlock label="Loading current values" rows={6} />
    }

    return (
      <ReadinessForm
        department={department}
        template={template}
        resources={resourcesQuery.data ?? null}
        bloodStock={bloodQuery.data ?? []}
        currentUpdate={currentShiftQuery.data ?? null}
      />
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={department?.name ?? 'Readiness update'}
        description={
          template
            ? `${template.label} - confirm what is available this shift`
            : 'Confirm what is available this shift'
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/readiness')}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to board
          </Button>
        }
      />

      {body()}

      {departmentId && <RecentSubmissions departmentId={departmentId} />}
    </div>
  )
}
