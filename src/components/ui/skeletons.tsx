/**
 * Page-shaped placeholders.
 *
 * A route that is still downloading, or a screen whose first query has not
 * answered, paints the outline of what is coming rather than a lone spinner:
 * the eye lands where the content will be and nothing jumps when it arrives.
 * Spinners are kept for processes with no shape of their own (ranking,
 * submitting, signing in), through `InlineLoader` and the `Button` loading state.
 */

import { Card, Skeleton, Spinner } from './index'
import { cn } from '@/lib/utils'

function Frame({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn('animate-fade-in', className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** A spinner with words next to it, for a process that has no layout to preview. */
export function InlineLoader({
  label,
  className,
  size = 'md',
}: {
  label: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const spinner = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 text-slate-600 dark:text-slate-300',
        size === 'lg' ? 'text-base' : size === 'sm' ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <Spinner className={spinner} />
      {label}
    </span>
  )
}

/** Centre-of-page process indicator, for a step that replaces the whole view. */
export function ProcessLoader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <Spinner className="h-7 w-7 text-brand-600 dark:text-brand-400" />
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
      {hint && <p className="max-w-sm hint">{hint}</p>}
    </div>
  )
}

export function PageHeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {actions && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      )}
    </div>
  )
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-28" />
        </Card>
      ))}
    </div>
  )
}

export function FilterBarSkeleton({ controls = 4 }: { controls?: number }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: controls }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function CardGridSkeleton({
  count = 6,
  columns = 'sm:grid-cols-2 xl:grid-cols-3',
}: {
  count?: number
  columns?: string
}) {
  return (
    <div className={cn('grid gap-3', columns)}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} className="p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </Card>
      ))}
    </div>
  )
}

/** Stacked rows such as referral cards or notification lines. */
export function ListSkeleton({ rows = 5, dense = false }: { rows?: number; dense?: boolean }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <Card key={index} className={dense ? 'p-3' : 'p-4'}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              {!dense && <Skeleton className="h-3 w-1/2" />}
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden', className)}>
      <div className="hidden border-b border-slate-200 px-3 py-2.5 sm:flex sm:gap-6 dark:border-slate-800">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-center gap-4 px-3 py-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
            <Skeleton className="hidden h-4 w-20 md:block" />
            <Skeleton className="h-8 w-16 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FormSkeleton({ fields = 6, title = true }: { fields?: number; title?: boolean }) {
  return (
    <Card>
      {title && (
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
      )}
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-36" />
      </div>
    </Card>
  )
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2 px-2" style={{ height }} aria-hidden>
      {[35, 55, 40, 70, 60, 85, 50, 65, 45, 75, 58, 80].map((h, index) => (
        <Skeleton key={index} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Whole pages
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <Frame label="Loading your dashboard" className="space-y-6">
      <PageHeaderSkeleton />
      <Card className="p-4">
        <Skeleton className="h-4 w-36" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-4 h-11 w-36" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-24 w-full" />
        </Card>
      </div>
      <StatGridSkeleton count={5} />
      <Card className="p-5">
        <Skeleton className="h-4 w-44" />
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </Card>
    </Frame>
  )
}

export function ListPageSkeleton({
  view = 'cards',
  filters = 4,
}: {
  view?: 'cards' | 'list' | 'table'
  filters?: number
}) {
  return (
    <Frame label="Loading" className="space-y-4 sm:space-y-6">
      <PageHeaderSkeleton />
      <FilterBarSkeleton controls={filters} />
      {view === 'cards' ? (
        <CardGridSkeleton />
      ) : view === 'table' ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : (
        <ListSkeleton />
      )}
    </Frame>
  )
}

export function DetailPageSkeleton() {
  return (
    <Frame label="Loading details" className="space-y-4 sm:space-y-6">
      <Skeleton className="h-4 w-28" />
      <div className="flex items-start gap-3">
        <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="ml-auto h-4 w-36" />
      </Card>
      <StatGridSkeleton count={5} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-36" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      </div>
    </Frame>
  )
}

export function FormPageSkeleton({ steps = false }: { steps?: boolean }) {
  return (
    <Frame label="Loading form" className="space-y-5">
      <PageHeaderSkeleton actions={false} />
      {steps && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      )}
      <FormSkeleton />
      <FormSkeleton fields={4} />
    </Frame>
  )
}

export function ReportsSkeleton() {
  return (
    <Frame label="Loading reports" className="space-y-5">
      <PageHeaderSkeleton />
      <FilterBarSkeleton controls={3} />
      <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <StatGridSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-48" />
          <div className="mt-4">
            <ChartSkeleton />
          </div>
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4">
            <ChartSkeleton />
          </div>
        </Card>
      </div>
    </Frame>
  )
}

export function TabbedPageSkeleton({ view = 'form' }: { view?: 'form' | 'table' | 'stats' }) {
  return (
    <Frame label="Loading" className="space-y-5">
      <PageHeaderSkeleton actions={false} />
      <div className="flex gap-1 border-b border-slate-200 pb-2 dark:border-slate-800">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-8 w-24" />
        ))}
      </div>
      {view === 'table' ? (
        <>
          <FilterBarSkeleton controls={3} />
          <Card>
            <TableSkeleton />
          </Card>
        </>
      ) : view === 'stats' ? (
        <>
          <StatGridSkeleton count={5} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <ChartSkeleton />
            </Card>
            <Card className="p-5">
              <ChartSkeleton />
            </Card>
          </div>
        </>
      ) : (
        <FormSkeleton />
      )}
    </Frame>
  )
}

export function NotificationsSkeleton() {
  return (
    <Frame label="Loading notifications" className="space-y-5">
      <PageHeaderSkeleton />
      <FilterBarSkeleton controls={3} />
      <Card className="overflow-hidden">
        <TableSkeleton rows={6} columns={1} />
      </Card>
    </Frame>
  )
}
