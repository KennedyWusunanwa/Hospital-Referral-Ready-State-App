import { Droplet } from 'lucide-react'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
} from '@/components/ui'
import { useBloodStock } from '@/features/readiness/useReadiness'
import { BLOOD_GROUPS, type BloodGroup } from '@/lib/constants'
import { cn, relativeTime, sum } from '@/lib/utils'

/** Units at or below this are flagged; a single trauma case can consume 4. */
const LOW_STOCK_UNITS = 4

function stockTone(units: number): { tone: 'danger' | 'warning' | 'success'; label: string } {
  if (units <= 0) return { tone: 'danger', label: 'Out of stock' }
  if (units <= LOW_STOCK_UNITS) return { tone: 'warning', label: 'Low' }
  return { tone: 'success', label: 'Adequate' }
}

export function BloodStockTable({ hospitalId }: { hospitalId: string | null }) {
  const query = useBloodStock(hospitalId)

  const rows = query.data ?? []
  const byGroup = new Map(rows.map((row) => [row.blood_group, row]))
  const totalUnits = sum(rows.map((row) => row.units))
  const lastUpdated = rows.reduce<string | null>(
    (latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest),
    null,
  )

  return (
    <Card className="print-block">
      <CardHeader
        title="Blood bank stock"
        description={
          rows.length > 0 ? `Last reported ${relativeTime(lastUpdated)}` : 'Reported by the blood bank each shift'
        }
        action={
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Droplet className="h-4 w-4 text-red-500" aria-hidden />
            <span className="tabular-nums">{totalUnits}</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">units</span>
          </div>
        }
      />

      {query.isPending ? (
        <LoadingBlock label="Loading blood stock" rows={3} />
      ) : query.isError ? (
        <CardBody>
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
        </CardBody>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Droplet className="h-8 w-8" />}
          title="No blood stock reported"
          description="This hospital has not submitted blood bank figures yet."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th scope="col" className="px-5 py-2 font-medium">
                  Group
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="hidden px-5 py-2 font-medium sm:table-cell">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {BLOOD_GROUPS.map((group: BloodGroup) => {
                const row = byGroup.get(group)
                const units = row?.units ?? null
                const state = units === null ? null : stockTone(units)

                return (
                  <tr
                    key={group}
                    className={cn(
                      state?.tone === 'danger' && 'bg-red-50/60 dark:bg-red-950/20',
                      state?.tone === 'warning' && 'bg-amber-50/60 dark:bg-amber-950/20',
                    )}
                  >
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-semibold text-slate-900 dark:text-slate-100"
                    >
                      {group}
                    </th>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-800 dark:text-slate-200">
                      {units ?? '-'}
                    </td>
                    <td className="px-5 py-2.5">
                      {state ? (
                        <Badge tone={state.tone}>{state.label}</Badge>
                      ) : (
                        <span className="hint">Not reported</span>
                      )}
                    </td>
                    <td className="hidden px-5 py-2.5 text-slate-500 sm:table-cell dark:text-slate-400">
                      {row ? relativeTime(row.updated_at) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
