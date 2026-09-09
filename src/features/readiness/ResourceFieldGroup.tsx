/**
 * The resource inputs a shift in-charge fills in, plus the form contract the
 * update page is built on.
 *
 * A department only ever reports the resources its template owns, so the form
 * shape is fixed (every resource key is present) while validation is built per
 * template -- that keeps react-hook-form's field paths statically typed without
 * making the schema lie about what this department is responsible for.
 */

import { useController, type Control, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Field, Input, Meter, Toggle } from '@/components/ui'
import {
  BLOOD_GROUPS,
  RESOURCES,
  RESOURCE_KEYS,
  type BloodGroup,
  type DepartmentTemplate,
  type ResourceKey,
} from '@/lib/constants'
import type { HospitalResources } from '@/lib/types'
import { cn } from '@/lib/utils'

export const DIVERSION_REASON_MAX = 300
export const READINESS_NOTES_MAX = 500

export interface ReadinessFormValues {
  resources: Record<ResourceKey, number | boolean>
  /** Capacity denominators, for the resources that track one. */
  totals: Record<ResourceKey, number>
  bloodStock: Record<BloodGroup, number>
  erOpen: boolean
  diversionReason: string
  notes: string
}

// ---------------------------------------------------------------------------
// Reading the current state off a hospital_resources row
// ---------------------------------------------------------------------------

function columnValue(
  resources: HospitalResources | null | undefined,
  column: string | undefined,
): number | boolean | null {
  if (!resources || !column) return null
  const value = (resources as unknown as Record<string, unknown>)[column]
  return typeof value === 'number' || typeof value === 'boolean' ? value : null
}

/** Current reported value per resource key, for prefill and delta display. */
export function readCurrentResources(
  resources: HospitalResources | null | undefined,
): Partial<Record<ResourceKey, number | boolean>> {
  const result: Partial<Record<ResourceKey, number | boolean>> = {}
  for (const key of RESOURCE_KEYS) {
    const value = columnValue(resources, RESOURCES[key].column)
    if (value !== null) result[key] = value
  }
  return result
}

export function readCurrentTotals(
  resources: HospitalResources | null | undefined,
): Partial<Record<ResourceKey, number>> {
  const result: Partial<Record<ResourceKey, number>> = {}
  for (const key of RESOURCE_KEYS) {
    const value = columnValue(resources, RESOURCES[key].totalColumn)
    if (typeof value === 'number') result[key] = value
  }
  return result
}

export function formatResourceValue(key: ResourceKey, value: number | boolean | undefined): string {
  const definition = RESOURCES[key]
  if (value === undefined || value === null) return 'not reported'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (definition.kind === 'percent') return `${value}%`
  return definition.unit ? `${value} ${definition.unit}` : String(value)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const baseSchema = z.object({
  // Values arrive from number inputs as NaN while empty, so they are checked in
  // the refinement below where the message can name the actual resource.
  resources: z.record(z.unknown()),
  totals: z.record(z.unknown()),
  bloodStock: z.record(z.unknown()),
  erOpen: z.boolean(),
  diversionReason: z.string().max(DIVERSION_REASON_MAX, 'Keep the reason under 300 characters'),
  notes: z.string().max(READINESS_NOTES_MAX, 'Keep notes under 500 characters'),
})

export function buildReadinessSchema(template: DepartmentTemplate) {
  return baseSchema.superRefine((values, ctx) => {
    const problem = (path: Array<string>, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

    for (const key of template.resources) {
      const definition = RESOURCES[key]
      const value = values.resources[key]

      if (definition.kind === 'boolean') {
        if (typeof value !== 'boolean') problem(['resources', key], 'Answer yes or no')
        continue
      }

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problem(['resources', key], 'Enter a number')
        continue
      }
      if (value < 0) {
        problem(['resources', key], 'Cannot be negative')
        continue
      }
      if (definition.kind === 'percent') {
        if (value > 100) problem(['resources', key], 'Must be between 0 and 100')
        continue
      }
      if (!Number.isInteger(value)) {
        problem(['resources', key], 'Whole numbers only')
        continue
      }

      if (definition.totalColumn) {
        const total = values.totals[key]
        if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
          problem(['totals', key], 'Enter the total capacity')
        } else if (!Number.isInteger(total)) {
          problem(['totals', key], 'Whole numbers only')
        } else if (value > total) {
          problem(['resources', key], `Cannot be more than the total of ${total}`)
        }
      }
    }

    if (template.collectsBloodStock) {
      for (const group of BLOOD_GROUPS) {
        const units = values.bloodStock[group]
        if (typeof units !== 'number' || !Number.isFinite(units) || units < 0) {
          problem(['bloodStock', group], 'Enter 0 or more')
        } else if (!Number.isInteger(units)) {
          problem(['bloodStock', group], 'Whole units only')
        }
      }
    }

    // An ER on diversion without a stated reason is unactionable for the
    // referring hospital on the other end of the phone.
    if (template.controlsErStatus && !values.erOpen && values.diversionReason.trim().length < 3) {
      problem(['diversionReason'], 'Say why the emergency room is on diversion')
    }
  })
}

export function buildReadinessResolver(template: DepartmentTemplate): Resolver<ReadinessFormValues> {
  return zodResolver(buildReadinessSchema(template)) as unknown as Resolver<ReadinessFormValues>
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function meterTone(percent: number): 'success' | 'warning' | 'danger' {
  if (percent >= 60) return 'success'
  if (percent >= 30) return 'warning'
  return 'danger'
}

function NumberInput({
  id,
  describedBy,
  value,
  onChange,
  onBlur,
  max,
  suffix,
}: {
  id: string
  describedBy: string | undefined
  value: number | boolean | undefined
  onChange: (next: number) => void
  onBlur: () => void
  max?: number
  suffix?: string
}) {
  const numeric = typeof value === 'number' ? value : Number.NaN
  return (
    <div className="relative">
      <Input
        id={id}
        aria-describedby={describedBy}
        type="number"
        inputMode="numeric"
        step={1}
        min={0}
        max={max}
        className={cn(suffix && 'pr-12')}
        value={Number.isFinite(numeric) ? String(numeric) : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
        }
        onBlur={onBlur}
      />
      {suffix && (
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
          aria-hidden
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

function ResourceField({
  resourceKey,
  control,
  current,
}: {
  resourceKey: ResourceKey
  control: Control<ReadinessFormValues>
  current?: number | boolean
}) {
  const definition = RESOURCES[resourceKey]
  const { field, fieldState } = useController({ control, name: `resources.${resourceKey}` })
  const totalField = useController({ control, name: `totals.${resourceKey}` })

  const onRecord =
    current === undefined ? undefined : `On record: ${formatResourceValue(resourceKey, current)}`
  const hint = [definition.help, onRecord].filter(Boolean).join(' ')

  if (definition.kind === 'boolean') {
    return (
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <Toggle
          checked={field.value === true}
          onChange={field.onChange}
          label={definition.label}
          description={hint || undefined}
        />
        {fieldState.error?.message && (
          <p role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            {fieldState.error.message}
          </p>
        )}
      </div>
    )
  }

  if (definition.kind === 'percent') {
    const percent = typeof field.value === 'number' && Number.isFinite(field.value) ? field.value : 0
    return (
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <Field
          label={definition.label}
          hint={hint || undefined}
          error={fieldState.error?.message}
          required
        >
          {({ id, describedBy }) => (
            <NumberInput
              id={id}
              describedBy={describedBy}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              max={100}
              suffix="%"
            />
          )}
        </Field>
        <div className="mt-2.5 flex items-center gap-2">
          <Meter
            value={percent}
            tone={meterTone(percent)}
            label={`${definition.label}: ${percent}%`}
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {percent}%
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={definition.label}
          hint={hint || undefined}
          error={fieldState.error?.message}
          required
        >
          {({ id, describedBy }) => (
            <NumberInput
              id={id}
              describedBy={describedBy}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              suffix={definition.unit}
            />
          )}
        </Field>

        {definition.totalColumn && (
          <Field
            label="Total capacity"
            hint="Everything the unit has, working or not."
            error={totalField.fieldState.error?.message}
            required
          >
            {({ id, describedBy }) => (
              <NumberInput
                id={id}
                describedBy={describedBy}
                value={totalField.field.value}
                onChange={totalField.field.onChange}
                onBlur={totalField.field.onBlur}
                suffix={definition.unit}
              />
            )}
          </Field>
        )}
      </div>
    </div>
  )
}

export interface ResourceFieldGroupProps {
  /** Heading for the group, normally `RESOURCE_GROUP_LABELS[group]`. */
  title?: string
  description?: string
  resourceKeys: readonly ResourceKey[]
  control: Control<ReadinessFormValues>
  /** Values currently on record, shown so the in-charge confirms rather than retypes. */
  current?: Partial<Record<ResourceKey, number | boolean>>
  className?: string
}

export function ResourceFieldGroup({
  title,
  description,
  resourceKeys,
  control,
  current,
  className,
}: ResourceFieldGroupProps) {
  if (resourceKeys.length === 0) return null

  return (
    <section className={cn('space-y-3', className)}>
      {title && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          {description && <p className="hint">{description}</p>}
        </div>
      )}
      <div className="space-y-3">
        {resourceKeys.map((key) => (
          <ResourceField
            key={key}
            resourceKey={key}
            control={control}
            current={current?.[key]}
          />
        ))}
      </div>
    </section>
  )
}
