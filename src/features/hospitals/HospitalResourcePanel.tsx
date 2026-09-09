import { useMemo } from 'react'
import { PackageSearch } from 'lucide-react'
import {
  DEPARTMENT_TEMPLATES,
  READINESS_LABELS,
  RESOURCES,
  RESOURCE_GROUP_LABELS,
  RESOURCE_KEYS,
  type ReadinessStatus,
  type ResourceDefinition,
  type ResourceKey,
} from '@/lib/constants'
import {
  BoolMark,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Meter,
  StatusDot,
} from '@/components/ui'
import { worstStatus } from '@/domain/readiness'
import { useDepartmentReadiness, useHospitalResources } from '@/features/readiness/useReadiness'
import { cn, relativeTime } from '@/lib/utils'
import type { DepartmentReadiness, HospitalResources } from '@/lib/types'

type ResourceGroup = ResourceDefinition['group']
type MeterTone = 'brand' | 'success' | 'warning' | 'danger'

const GROUP_ORDER: readonly ResourceGroup[] = [
  'critical_care',
  'surgical',
  'diagnostics',
  'supplies',
  'logistics',
]

export interface HospitalResourcePanelProps {
  hospitalId: string | null
  /** Narrow the panel to a subset of groups -- the dashboard shows fewer than the detail page. */
  groups?: readonly ResourceGroup[]
  className?: string
}

/**
 * The snapshot is stored as one wide row, so each catalogue entry names the
 * column it reads. That indirection is what keeps `constants.ts` the single
 * source of truth for the readiness form, the score and this panel alike.
 */
function readColumn(resources: HospitalResources, column: string): unknown {
  return (resources as unknown as Record<string, unknown>)[column]
}

function readNumber(resources: HospitalResources, column: string | undefined): number | null {
  if (!column) return null
  const value = readColumn(resources, column)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function countTone(available: number, saturation: number | undefined): MeterTone {
  if (available <= 0) return 'danger'
  if (saturation !== undefined && available < saturation) return 'warning'
  return 'success'
}

function percentTone(percent: number): MeterTone {
  if (percent <= 20) return 'danger'
  if (percent <= 50) return 'warning'
  return 'success'
}

interface GroupMeta {
  /** Worst readiness among the departments that report into this group. */
  status: ReadinessStatus | null
  lastUpdatedAt: string | null
  departmentNames: string[]
}

/**
 * Freshness is attributed to the departments that own each group's fields,
 * which is more honest than stamping one hospital-wide time on every number.
 */
function summariseGroups(departments: DepartmentReadiness[]): Record<ResourceGroup, GroupMeta> {
  const meta = {} as Record<ResourceGroup, GroupMeta>
  for (const group of GROUP_ORDER) {
    meta[group] = { status: null, lastUpdatedAt: null, departmentNames: [] }
  }

  for (const department of departments) {
    if (!department.requires_shift_update) continue
    const template = DEPARTMENT_TEMPLATES[department.template_key]
    if (!template) continue

    const groups = new Set<ResourceGroup>(
      template.resources.map((key: ResourceKey) => RESOURCES[key].group),
    )

    for (const group of groups) {
      const entry = meta[group]
      if (!entry) continue
      entry.departmentNames.push(department.department_name)
      entry.status = entry.status ? worstStatus(entry.status, department.status) : department.status
      if (
        department.last_submitted_at &&
        (!entry.lastUpdatedAt || department.last_submitted_at < entry.lastUpdatedAt)
      ) {
        entry.lastUpdatedAt = department.last_submitted_at
      }
    }
  }

  return meta
}

function ResourceRow({
  definition,
  resources,
}: {
  definition: ResourceDefinition
  resources: HospitalResources
}) {
  const raw = readColumn(resources, definition.column)

  if (definition.kind === 'boolean') {
    return (
      <div className="flex items-start justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="text-sm text-slate-800 dark:text-slate-200">{definition.label}</p>
          {definition.help && <p className="hint">{definition.help}</p>}
        </div>
        <BoolMark value={raw === true} label={raw === true ? 'Yes' : 'No'} />
      </div>
    )
  }

  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null

  if (value === null) {
    return (
      <div className="flex items-start justify-between gap-3 py-2">
        <p className="min-w-0 text-sm text-slate-800 dark:text-slate-200">{definition.label}</p>
        <span className="shrink-0 text-sm text-slate-400">Not reported</span>
      </div>
    )
  }

  const capacity = readNumber(resources, definition.totalColumn)
  const isPercent = definition.kind === 'percent'
  const tone = isPercent ? percentTone(value) : countTone(value, definition.saturationQuantity)
  const meterMax = isPercent ? 100 : Math.max(capacity ?? 0, value, 1)

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm text-slate-800 dark:text-slate-200">{definition.label}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {isPercent ? `${Math.round(value)}%` : value}
          {!isPercent && capacity !== null && (
            <span className="font-normal text-slate-400"> / {capacity}</span>
          )}
          {!isPercent && definition.unit && (
            <span className="ml-1 text-xs font-normal text-slate-400">{definition.unit}</span>
          )}
        </p>
      </div>
      <Meter
        className="mt-1.5"
        value={value}
        max={meterMax}
        tone={tone}
        label={`${definition.label}: ${isPercent ? `${Math.round(value)}%` : value}`}
      />
      {definition.help && <p className="mt-1 hint">{definition.help}</p>}
    </div>
  )
}

/**
 * A hospital's current resource snapshot, grouped the way the readiness form
 * collects it. Shared by the hospital detail page and the dashboard.
 */
export function HospitalResourcePanel({
  hospitalId,
  groups = GROUP_ORDER,
  className,
}: HospitalResourcePanelProps) {
  const resourcesQuery = useHospitalResources(hospitalId)
  const readinessQuery = useDepartmentReadiness(hospitalId)

  const groupMeta = useMemo(() => summariseGroups(readinessQuery.data ?? []), [readinessQuery.data])

  const definitionsByGroup = useMemo(() => {
    const byGroup = {} as Record<ResourceGroup, ResourceDefinition[]>
    for (const group of GROUP_ORDER) byGroup[group] = []
    for (const key of RESOURCE_KEYS) {
      const definition = RESOURCES[key]
      byGroup[definition.group].push(definition)
    }
    return byGroup
  }, [])

  if (resourcesQuery.isPending) {
    return (
      <Card className={className}>
        <LoadingBlock label="Loading resource snapshot" rows={4} />
      </Card>
    )
  }

  if (resourcesQuery.isError) {
    return (
      <ErrorBlock
        className={className}
        error={resourcesQuery.error}
        onRetry={() => void resourcesQuery.refetch()}
      />
    )
  }

  const resources = resourcesQuery.data
  if (!resources) {
    return (
      <Card className={className}>
        <EmptyState
          icon={<PackageSearch className="h-8 w-8" />}
          title="No resource snapshot yet"
          description="This hospital has not submitted a readiness update, so there is nothing to show."
        />
      </Card>
    )
  }

  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      {groups.map((group) => {
        const definitions = definitionsByGroup[group]
        if (!definitions || definitions.length === 0) return null

        const meta = groupMeta[group]
        const updatedAt = meta?.lastUpdatedAt ?? resources.updated_at

        return (
          <Card key={group} className="print-block">
            <CardHeader
              title={RESOURCE_GROUP_LABELS[group]}
              description={
                meta && meta.departmentNames.length > 0
                  ? `Reported by ${meta.departmentNames.join(', ')}`
                  : 'Reported hospital-wide'
              }
              action={
                <div className="text-right">
                  {meta?.status && (
                    <StatusDot status={meta.status} label={READINESS_LABELS[meta.status]} />
                  )}
                  <p className="hint mt-0.5 whitespace-nowrap">Updated {relativeTime(updatedAt)}</p>
                </div>
              }
            />
            <CardBody className="divide-y divide-slate-100 py-1 dark:divide-slate-800">
              {definitions.map((definition) => (
                <ResourceRow key={definition.key} definition={definition} resources={resources} />
              ))}
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
