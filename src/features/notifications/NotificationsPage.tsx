import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, CheckCheck, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorBlock,
  Field,
  FilterBar,
  LoadingBlock,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
} from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { getZonedParts } from '@/domain/shifts'
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/constants'
import type { AppNotification } from '@/lib/types'
import { useUrlState } from '@/lib/useUrlState'
import { formatDate } from '@/lib/utils'
import { NotificationItem, TYPE_LABELS } from './NotificationItem'
import {
  NOTIFICATION_SEVERITIES,
  internalLink,
  notificationSeverity,
  useMarkNotificationsRead,
  useNotificationRealtime,
  useNotifications,
  useUnreadNotificationCount,
  type NotificationSeverity,
} from './useNotifications'

const MS_PER_DAY = 86_400_000

const FILTER_DEFAULTS = { tab: 'unread', q: '', type: '', severity: '' }

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}
const SEVERITY_TONE = { info: 'brand', warning: 'warning', critical: 'danger' } as const

interface DayGroup {
  key: string
  label: string
  items: AppNotification[]
}

function dayKey(date: Date, timezone: string): string {
  const { year, month, day } = getZonedParts(date, timezone)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * The list arrives newest-first, so same-day rows are already contiguous and a
 * single pass comparing against the previous group is enough.
 */
function groupByDay(items: AppNotification[], timezone: string, now: Date): DayGroup[] {
  const today = dayKey(now, timezone)
  const yesterday = dayKey(new Date(now.getTime() - MS_PER_DAY), timezone)

  return items.reduce<DayGroup[]>((groups, item) => {
    const created = new Date(item.created_at)
    const key = dayKey(created, timezone)
    const last = groups[groups.length - 1]

    if (last && last.key === key) {
      last.items.push(item)
      return groups
    }

    const label =
      key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDate(created, timezone)
    groups.push({ key, label, items: [item] })
    return groups
  }, [])
}

export default function NotificationsPage() {
  const { timezone } = useAuth()
  const navigate = useNavigate()
  const { state, update, reset } = useUrlState(FILTER_DEFAULTS)
  const tab = state.tab === 'all' ? 'all' : 'unread'

  useNotificationRealtime()

  const onlyUnread = tab === 'unread'
  const notifications = useNotifications(onlyUnread)
  const unread = useUnreadNotificationCount()
  const markRead = useMarkNotificationsRead()

  const filtered = useMemo(() => {
    const rows = notifications.data ?? []
    const needle = state.q.trim().toLowerCase()
    return rows.filter((row) => {
      if (state.type && row.type !== state.type) return false
      if (state.severity && notificationSeverity(row.severity) !== state.severity) return false
      if (!needle) return true
      return `${row.title} ${row.body ?? ''} ${TYPE_LABELS[row.type]}`
        .toLowerCase()
        .includes(needle)
    })
  }, [notifications.data, state.q, state.type, state.severity])

  const severityCounts = useMemo(() => {
    const tally: Record<NotificationSeverity, number> = { info: 0, warning: 0, critical: 0 }
    for (const row of notifications.data ?? []) tally[notificationSeverity(row.severity)] += 1
    return tally
  }, [notifications.data])

  const groups = useMemo(() => groupByDay(filtered, timezone, new Date()), [filtered, timezone])

  const unreadCount = unread.data ?? 0
  const activeFilters = (state.q ? 1 : 0) + (state.type ? 1 : 0) + (state.severity ? 1 : 0)

  function handleSelect(notification: AppNotification) {
    if (!notification.is_read) markRead.mutate({ ids: [notification.id] })
    const path = internalLink(notification.link)
    if (path) navigate(path)
  }

  function handleMarkAll() {
    markRead.mutate({}, { onSuccess: () => toast.success('All notifications marked as read') })
  }

  function handleMarkVisible() {
    const ids = filtered.filter((row) => !row.is_read).map((row) => row.id)
    if (ids.length === 0) return
    markRead.mutate(
      { ids },
      {
        onSuccess: () =>
          toast.success(`${ids.length} notification${ids.length === 1 ? '' : 's'} marked as read`),
      },
    )
  }

  const list = notifications.isPending ? (
    <LoadingBlock label="Loading notifications" rows={4} />
  ) : notifications.isError ? (
    <div className="p-5">
      <ErrorBlock error={notifications.error} onRetry={() => void notifications.refetch()} />
    </div>
  ) : groups.length === 0 ? (
    activeFilters > 0 ? (
      <EmptyState
        icon={<Search className="h-8 w-8" aria-hidden />}
        title="No notifications match"
        description="Clear the search or pick a different type or severity."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => update({ q: '', type: '', severity: '' })}
          >
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<BellOff className="h-8 w-8" aria-hidden />}
        title={onlyUnread ? 'You are all caught up' : 'No notifications yet'}
        description={
          onlyUnread
            ? 'Nothing needs your attention right now. New referrals, messages and readiness alerts will appear here.'
            : 'Alerts about referrals, messages and readiness compliance will appear here.'
        }
        action={
          onlyUnread ? (
            <Button variant="outline" size="sm" onClick={() => update({ tab: 'all' })}>
              View all notifications
            </Button>
          ) : undefined
        }
      />
    )
  ) : (
    <div>
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
            {group.label}
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {group.items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onSelect={handleSelect}
                timezone={timezone}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Referral activity, messages and readiness compliance alerts addressed to you."
        actions={
          <>
            {activeFilters > 0 && filtered.some((row) => !row.is_read) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkVisible}
                loading={markRead.isPending}
              >
                Mark these as read
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAll}
              loading={markRead.isPending}
              disabled={unreadCount === 0}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all as read
            </Button>
          </>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => reset(['tab'])}
        summary={
          notifications.data
            ? `${filtered.length} ${onlyUnread ? 'unread' : ''} notification${filtered.length === 1 ? '' : 's'}${activeFilters > 0 ? ' match' : ''}`
            : undefined
        }
        gridClassName="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SegmentedControl
            ariaLabel="Read state"
            value={tab}
            onChange={(next) => update({ tab: next })}
            options={[
              { value: 'unread', label: 'Unread', count: unreadCount },
              { value: 'all', label: 'All' },
            ]}
          />
          <SearchInput
            containerClassName="flex-1"
            value={state.q}
            onChange={(value) => update({ q: value })}
            placeholder="Search titles and messages"
            aria-label="Search notifications"
          />
          <Field className="lg:w-56">
            {({ id }) => (
              <Select
                id={id}
                aria-label="Notification type"
                value={state.type}
                onChange={(e) => update({ type: e.target.value })}
              >
                <option value="">All types</option>
                {NOTIFICATION_TYPES.map((type: NotificationType) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Severity</span>
          {NOTIFICATION_SEVERITIES.map((severity) => (
            <Chip
              key={severity}
              active={state.severity === severity}
              onClick={() => update({ severity: state.severity === severity ? '' : severity })}
              tone={SEVERITY_TONE[severity]}
              count={severityCounts[severity]}
            >
              {SEVERITY_LABELS[severity]}
            </Chip>
          ))}
        </div>
      </FilterBar>

      <Alert tone="info" title="Where readiness alerts come from">
        <p>
          Nobody raises these by hand. The scheduled{' '}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs dark:bg-slate-900/50">
            flag_overdue_readiness
          </code>{' '}
          job checks every department against its shift calendar, turns it yellow after one missed
          shift and red after three, and sends the alert to that hospital&rsquo;s administrators.
          Chasing the department is the follow-up; this page only tells you which one has fallen
          behind.
        </p>
      </Alert>

      <Card className="overflow-hidden">{list}</Card>
    </div>
  )
}
