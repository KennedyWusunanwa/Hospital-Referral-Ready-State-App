/**
 * The emergency catalogue: which conditions a coordinator can refer for, and
 * which resources each one needs. Weights and critical flags feed the ranking
 * directly, so every change here is audited and takes effect on the next
 * referral raised anywhere on the network.
 */

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Pencil,
  Plus,
  PowerOff,
  RotateCcw,
  Search,
  Siren,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui'
import { UrgencyBadge } from '@/features/referrals/ReferralStatusBadge'
import {
  RESOURCE_KEYS,
  RESOURCES,
  URGENCY_LABELS,
  URGENCY_LEVELS,
  type ResourceKey,
  type UrgencyLevel,
} from '@/lib/constants'
import type { EmergencyRequirement, EmergencyType } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { unique } from '@/lib/utils'
import {
  useEmergencyCatalogue,
  useSaveRequirements,
  useUpsertEmergencyType,
  type RequirementDraft,
} from './useConsole'

const FILTER_DEFAULTS = { q: '', category: '', status: 'active', urgency: '' }

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  code: z
    .string()
    .trim()
    .min(2, 'Enter a code')
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Lower-case letters, digits and underscores only'),
  category: z.string().trim().min(2, 'Enter a category').max(60),
  description: z.string().trim().max(500),
  default_urgency: z.enum(URGENCY_LEVELS),
  sort_order: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(10_000),
})

type FormValues = z.infer<typeof schema>

function TypeFormModal({
  type,
  categories,
  onClose,
}: {
  type: EmergencyType | null
  categories: string[]
  onClose: () => void
}) {
  const upsert = useUpsertEmergencyType()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: type?.name ?? '',
      code: type?.code ?? '',
      category: type?.category ?? '',
      description: type?.description ?? '',
      default_urgency: type?.default_urgency ?? 'urgent',
      sort_order: type?.sort_order ?? 100,
    },
  })

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        id: type?.id ?? null,
        name: values.name,
        code: values.code,
        category: values.category,
        description: values.description || null,
        default_urgency: values.default_urgency,
        sort_order: values.sort_order,
        is_active: type?.is_active ?? true,
      })
      toast.success(type ? 'Emergency type updated' : 'Emergency type added')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New emergency type'}
      description="Shown to coordinators when they raise a referral."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={upsert.isPending} onClick={() => void submit()}>
            {type ? 'Save changes' : 'Create type'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Name"
          required
          className="sm:col-span-2"
          error={form.formState.errors.name?.message}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              autoFocus
              aria-describedby={describedBy}
              placeholder="Obstetric haemorrhage"
              {...form.register('name')}
            />
          )}
        </Field>
        <Field
          label="Code"
          required
          hint="Stable identifier used in exports and the audit log."
          error={form.formState.errors.code?.message}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              placeholder="obstetric_haemorrhage"
              className="font-mono"
              disabled={Boolean(type)}
              {...form.register('code')}
            />
          )}
        </Field>
        <Field label="Category" required error={form.formState.errors.category?.message}>
          {({ id, describedBy }) => (
            <>
              <Input
                id={id}
                list="emergency-categories"
                aria-describedby={describedBy}
                placeholder="Obstetric"
                autoComplete="off"
                {...form.register('category')}
              />
              <datalist id="emergency-categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field
          label="Default urgency"
          required
          error={form.formState.errors.default_urgency?.message}
        >
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...form.register('default_urgency')}>
              {URGENCY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {URGENCY_LABELS[level]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Sort order"
          hint="Lower numbers appear first."
          error={form.formState.errors.sort_order?.message}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="number"
              min={0}
              step={10}
              aria-describedby={describedBy}
              {...form.register('sort_order', { valueAsNumber: true })}
            />
          )}
        </Field>
        <Field
          label="Description"
          className="sm:col-span-2"
          error={form.formState.errors.description?.message}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              rows={3}
              aria-describedby={describedBy}
              {...form.register('description')}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

function RequirementsModal({
  type,
  initial,
  onClose,
}: {
  type: EmergencyType
  initial: EmergencyRequirement[]
  onClose: () => void
}) {
  const save = useSaveRequirements()
  const [rows, setRows] = useState<RequirementDraft[]>(
    initial.map((row) => ({
      resource_key: row.resource_key,
      weight: row.weight,
      is_critical: row.is_critical,
      min_quantity: row.min_quantity,
    })),
  )

  const used = new Set(rows.map((row) => row.resource_key))
  const available = RESOURCE_KEYS.filter((key) => !used.has(key))

  const patch = (index: number, changes: Partial<RequirementDraft>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)))

  const addRow = () => {
    const key = available[0]
    if (!key) return
    setRows((current) => [
      ...current,
      { resource_key: key, weight: 3, is_critical: false, min_quantity: 1 },
    ])
  }

  const submit = async () => {
    try {
      await save.mutateAsync({ emergencyTypeId: type.id, rows })
      toast.success(`Requirements saved for ${type.name}`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const criticalCount = rows.filter((row) => row.is_critical).length

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`Resources for ${type.name}`}
      description="Weight (0-10) sets how much each resource counts toward the match score. A critical resource that is missing excludes the hospital outright."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => void submit()}>
            Save requirements
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {rows.length === 0 ? (
          <Alert tone="warning" title="No resources listed">
            With nothing listed, every hospital scores the same on resources and the ranking falls
            back to proximity alone.
          </Alert>
        ) : criticalCount === 0 ? (
          <Alert tone="info">
            No resource is marked critical, so no hospital will be excluded on resources for this
            emergency; the weights only shape the score.
          </Alert>
        ) : null}

        <Table minWidth="40rem">
          <thead>
            <tr>
              <Th>Resource</Th>
              <Th align="center">Weight</Th>
              <Th align="center">Minimum</Th>
              <Th align="center">Critical</Th>
              <Th align="right">
                <span className="sr-only">Remove</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const definition = RESOURCES[row.resource_key]
              return (
                <tr key={row.resource_key}>
                  <Td>
                    <Select
                      aria-label="Resource"
                      value={row.resource_key}
                      onChange={(event) =>
                        patch(index, { resource_key: event.target.value as ResourceKey })
                      }
                    >
                      {RESOURCE_KEYS.filter(
                        (key) => key === row.resource_key || !used.has(key),
                      ).map((key) => (
                        <option key={key} value={key}>
                          {RESOURCES[key].label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="center">
                    <Input
                      aria-label="Weight"
                      type="number"
                      min={0}
                      max={10}
                      className="mx-auto w-20 text-center"
                      value={row.weight}
                      onChange={(event) =>
                        patch(index, {
                          weight: Math.max(0, Math.min(10, Number(event.target.value) || 0)),
                        })
                      }
                    />
                  </Td>
                  <Td align="center">
                    {definition.kind === 'boolean' ? (
                      <span className="hint">present</span>
                    ) : (
                      <div className="mx-auto flex w-28 items-center gap-1">
                        <Input
                          aria-label="Minimum quantity"
                          type="number"
                          min={0}
                          className="text-center"
                          value={row.min_quantity}
                          onChange={(event) =>
                            patch(index, {
                              min_quantity: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                        />
                        <span className="hint">{definition.unit ?? ''}</span>
                      </div>
                    )}
                  </Td>
                  <Td align="center">
                    <Checkbox
                      label={<span className="sr-only">Critical</span>}
                      checked={row.is_critical}
                      onChange={(event) => patch(index, { is_critical: event.target.checked })}
                      className="justify-center"
                    />
                  </Td>
                  <Td align="right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${definition.label}`}
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>

        <Button variant="outline" size="sm" onClick={addRow} disabled={available.length === 0}>
          <Plus className="h-4 w-4" aria-hidden />
          Add resource
        </Button>
      </div>
    </Modal>
  )
}

export default function ConsoleCatalogue() {
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const catalogue = useEmergencyCatalogue()
  const upsert = useUpsertEmergencyType()

  const [editing, setEditing] = useState<EmergencyType | null | 'new'>(null)
  const [requirementsFor, setRequirementsFor] = useState<EmergencyType | null>(null)

  const types = useMemo(() => catalogue.data?.types ?? [], [catalogue.data])
  const requirements = catalogue.data?.requirements ?? {}
  const categories = useMemo(() => unique(types.map((type) => type.category)).sort(), [types])

  const visible = useMemo(() => {
    const term = state.q.trim().toLowerCase()
    return types.filter((type) => {
      if (state.status === 'active' && !type.is_active) return false
      if (state.status === 'retired' && type.is_active) return false
      if (state.category && type.category !== state.category) return false
      if (state.urgency && type.default_urgency !== state.urgency) return false
      if (!term) return true
      const resources = (requirements[type.id] ?? []).map(
        (r) => RESOURCES[r.resource_key]?.label ?? r.resource_key,
      )
      return `${type.name} ${type.code} ${type.category} ${type.description ?? ''} ${resources.join(' ')}`
        .toLowerCase()
        .includes(term)
    })
  }, [types, requirements, state])

  const setActive = async (type: EmergencyType, isActive: boolean) => {
    try {
      await upsert.mutateAsync({
        id: type.id,
        name: type.name,
        code: type.code,
        category: type.category,
        description: type.description,
        default_urgency: type.default_urgency,
        sort_order: type.sort_order,
        is_active: isActive,
      })
      toast.success(isActive ? `${type.name} restored` : `${type.name} retired`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update')
    }
  }

  const activeFilters =
    (state.q ? 1 : 0) +
    (state.category ? 1 : 0) +
    (state.urgency ? 1 : 0) +
    (state.status !== 'active' ? 1 : 0)

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={activeFilters}
        onClear={reset}
        summary={
          catalogue.data ? `${visible.length} of ${types.length} emergency types` : undefined
        }
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput
            containerClassName="flex-1"
            value={state.q}
            onChange={(value) => update({ q: value })}
            placeholder="Name, code, category or resource"
            aria-label="Search emergency types"
          />
          <SegmentedControl
            ariaLabel="Catalogue status"
            size="sm"
            value={state.status}
            onChange={(next) => update({ status: next })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'retired', label: 'Retired' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Select
            aria-label="Category"
            className="lg:w-52"
            value={state.category}
            onChange={(event) => update({ category: event.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            New type
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Default urgency
          </span>
          {URGENCY_LEVELS.map((level: UrgencyLevel) => (
            <Chip
              key={level}
              active={state.urgency === level}
              onClick={() => update({ urgency: state.urgency === level ? '' : level })}
              tone={level === 'critical' ? 'danger' : level === 'urgent' ? 'warning' : 'neutral'}
            >
              {URGENCY_LABELS[level]}
            </Chip>
          ))}
        </div>
      </FilterBar>

      {catalogue.isPending ? (
        <Card>
          <LoadingBlock label="Loading the catalogue" rows={6} />
        </Card>
      ) : catalogue.isError ? (
        <ErrorBlock error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      ) : types.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Siren className="h-8 w-8" />}
            title="The catalogue is empty"
            description="Add the emergencies coordinators can refer for, then list the resources each one needs."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" aria-hidden />
                New type
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No emergency types match"
            description="Retired types are hidden unless you change the status filter."
            action={
              <Button variant="outline" size="sm" onClick={() => reset()}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table minWidth="60rem">
            <thead>
              <tr>
                <Th>Emergency</Th>
                <Th>Category</Th>
                <Th>Default urgency</Th>
                <Th>Required resources</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((type) => {
                const rows = requirements[type.id] ?? []
                const critical = rows.filter((row) => row.is_critical)
                return (
                  <tr
                    key={type.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <Td>
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                        {type.name}
                        {!type.is_active && <Badge tone="neutral">Retired</Badge>}
                      </p>
                      <p className="hint font-mono">{type.code}</p>
                      {type.description && (
                        <p className="mt-0.5 max-w-md text-xs text-slate-500 dark:text-slate-400">
                          {type.description}
                        </p>
                      )}
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-300">{type.category}</Td>
                    <Td>
                      <UrgencyBadge urgency={type.default_urgency} />
                    </Td>
                    <Td>
                      {rows.length === 0 ? (
                        <Badge tone="warning">None listed</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {rows.slice(0, 6).map((row) => (
                            <Badge key={row.id} tone={row.is_critical ? 'danger' : 'neutral'}>
                              {RESOURCES[row.resource_key]?.label ?? row.resource_key}
                              <span className="opacity-60">×{row.weight}</span>
                            </Badge>
                          ))}
                          {rows.length > 6 && <Badge tone="neutral">+{rows.length - 6}</Badge>}
                        </div>
                      )}
                      <p className="mt-1 hint">
                        {rows.length} resource{rows.length === 1 ? '' : 's'} · {critical.length}{' '}
                        critical
                      </p>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRequirementsFor(type)}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                          Resources
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(type)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </Button>
                        {type.is_active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void setActive(type, false)}
                            aria-label={`Retire ${type.name}`}
                          >
                            <PowerOff className="h-3.5 w-3.5" aria-hidden />
                            Retire
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void setActive(type, true)}
                            aria-label={`Restore ${type.name}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            Restore
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

      {editing !== null && (
        <TypeFormModal
          key={editing === 'new' ? 'new' : editing.id}
          type={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}

      {requirementsFor && (
        <RequirementsModal
          key={requirementsFor.id}
          type={requirementsFor}
          initial={requirements[requirementsFor.id] ?? []}
          onClose={() => setRequirementsFor(null)}
        />
      )}
    </div>
  )
}
