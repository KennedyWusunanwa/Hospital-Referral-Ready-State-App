import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Select,
} from '@/components/ui'
import { AUDIT_ACTIONS, ROLE_LABELS, type AuditAction, type UserRole } from '@/lib/constants'
import { formatDateTime, downloadCsv, toCsv } from '@/lib/utils'
import type { Json } from '@/lib/types'
import {
  AUDIT_EXPORT_LIMIT,
  fetchAuditLogsForExport,
  useAuditLogs,
  type AuditLogFilters,
} from './useAdmin'

/** Entity types the app writes today -- offered as suggestions, not a hard list. */
const ENTITY_SUGGESTIONS = [
  'hospital',
  'department',
  'profile',
  'referral',
  'readiness_update',
  'message',
  'scoring_config',
]

const ACTION_TONES: Array<{ match: RegExp; tone: 'danger' | 'warning' | 'success' | 'info' }> = [
  { match: /^auth\.failed/, tone: 'danger' },
  { match: /(decline|cancel|deactivate)/, tone: 'danger' },
  { match: /(accept|complete)/, tone: 'success' },
  { match: /(update|invite|config)/, tone: 'warning' },
]

function toneForAction(action: string): 'danger' | 'warning' | 'success' | 'info' | 'neutral' {
  return ACTION_TONES.find((entry) => entry.match.test(action))?.tone ?? 'neutral'
}

function formatDetails(details: Json): string {
  if (details === null || details === undefined) return '{}'
  return JSON.stringify(details, null, 2)
}

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

export default function AuditLogViewer() {
  const { hospital, can, timezone } = useAuth()
  const seesEveryHospital = can('admin:system')

  const [allHospitals, setAllHospitals] = useState(false)
  const [filters, setFilters] = useState<AuditLogFilters>({
    from: daysAgo(30),
    to: today(),
    action: '',
    entityType: '',
    actorSearch: '',
    page: 1,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const effectiveFilters: AuditLogFilters = {
    ...filters,
    hospitalId: seesEveryHospital && allHospitals ? null : (hospital?.id ?? null),
  }

  const logs = useAuditLogs(effectiveFilters)

  /** Any filter change invalidates the current page number. */
  const patch = (changes: Partial<AuditLogFilters>) =>
    setFilters((current) => ({ ...current, ...changes, page: 1 }))

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = await fetchAuditLogsForExport(effectiveFilters)
      if (rows.length === 0) {
        toast.error('Nothing to export for these filters')
        return
      }
      const csv = toCsv(
        rows.map((row) => ({
          timestamp: row.created_at,
          actor: row.actor_name ?? '',
          actor_email: row.actor_email ?? '',
          actor_role: row.actor_role ?? '',
          action: row.action,
          entity_type: row.entity_type ?? '',
          entity_id: row.entity_id ?? '',
          details: JSON.stringify(row.details ?? {}),
        })),
      )
      downloadCsv(`audit-log-${filters.from}-to-${filters.to}.csv`, csv)
      toast.success(
        rows.length >= AUDIT_EXPORT_LIMIT
          ? `Exported the most recent ${AUDIT_EXPORT_LIMIT} entries`
          : `Exported ${rows.length} entries`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const page = logs.data?.page ?? filters.page ?? 1
  const pageCount = logs.data?.pageCount ?? 1

  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Every readiness submission, referral decision and administrative change."
        action={
          <Button size="sm" variant="outline" loading={exporting} onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        }
      />

      <CardBody className="space-y-4 border-b border-slate-200 dark:border-slate-800">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.from ?? ''}
                max={filters.to}
                onChange={(event) => patch({ from: event.target.value })}
              />
            )}
          </Field>

          <Field label="To">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={filters.to ?? ''}
                min={filters.from}
                onChange={(event) => patch({ to: event.target.value })}
              />
            )}
          </Field>

          <Field label="Action">
            {({ id }) => (
              <Select
                id={id}
                value={filters.action ?? ''}
                onChange={(event) => patch({ action: event.target.value as AuditAction | '' })}
              >
                <option value="">All actions</option>
                {AUDIT_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Entity type" hint="Blank matches every entity.">
            {({ id, describedBy }) => (
              <>
                <Input
                  id={id}
                  list="audit-entity-types"
                  aria-describedby={describedBy}
                  placeholder="e.g. referral"
                  value={filters.entityType ?? ''}
                  onChange={(event) => patch({ entityType: event.target.value })}
                />
                <datalist id="audit-entity-types">
                  {ENTITY_SUGGESTIONS.map((entity) => (
                    <option key={entity} value={entity} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Actor email" className="sm:col-span-2">
            {({ id }) => (
              <Input
                id={id}
                type="search"
                placeholder="Part of an email address"
                value={filters.actorSearch ?? ''}
                onChange={(event) => patch({ actorSearch: event.target.value })}
              />
            )}
          </Field>
        </div>

        {seesEveryHospital && (
          <Checkbox
            label="Include every hospital"
            description="Off shows only events recorded against your own facility."
            checked={allHospitals}
            onChange={(event) => {
              setAllHospitals(event.target.checked)
              patch({})
            }}
          />
        )}
      </CardBody>

      {logs.isLoading ? (
        <LoadingBlock label="Loading audit entries" rows={6} />
      ) : logs.isError ? (
        <CardBody>
          <ErrorBlock error={logs.error} onRetry={() => void logs.refetch()} />
        </CardBody>
      ) : (logs.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-8 w-8" />}
          title="No matching entries"
          description="Widen the date range or clear a filter to see more of the trail."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th scope="col" className="w-8 px-3 py-2">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Actor
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Entity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {logs.data?.rows.map((entry) => {
                const isOpen = expanded === entry.id
                return (
                  <Fragment key={entry.id}>
                    <tr className="align-top">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : entry.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Hide details' : 'Show details'}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                        {formatDateTime(entry.created_at, timezone)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-slate-900 dark:text-slate-100">
                          {entry.actor_name ?? entry.actor_email ?? 'System'}
                        </span>
                        {entry.actor_name && entry.actor_email && (
                          <span className="block hint">{entry.actor_email}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                        {entry.actor_role
                          ? (ROLE_LABELS[entry.actor_role as UserRole] ?? entry.actor_role)
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={toneForAction(entry.action)}>{entry.action}</Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        <span className="block">{entry.entity_type ?? '-'}</span>
                        {entry.entity_id && (
                          <span className="block font-mono text-xs text-slate-400">
                            {entry.entity_id.slice(0, 8)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50 dark:bg-slate-950/40">
                        <td colSpan={6} className="px-3 py-3">
                          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                            {formatDetails(entry.details)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <CardFooter className="justify-between">
        <span className="hint">
          {logs.data
            ? `Page ${page} of ${pageCount} - ${logs.data.total} ${
                logs.data.total === 1 ? 'entry' : 'entries'
              }`
            : ' '}
        </span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || logs.isFetching}
            onClick={() => setFilters((current) => ({ ...current, page: page - 1 }))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount || logs.isFetching}
            onClick={() => setFilters((current) => ({ ...current, page: page + 1 }))}
          >
            Next
          </Button>
        </span>
      </CardFooter>
    </Card>
  )
}
