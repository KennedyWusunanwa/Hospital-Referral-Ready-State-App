import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@/components/ui'
import { useAuth } from '@/auth/AuthProvider'
import { getZonedParts } from '@/domain/shifts'
import type { AppNotification } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { NotificationItem } from './NotificationItem'
import {
  internalLink,
  useMarkNotificationsRead,
  useNotificationRealtime,
  useNotifications,
  useUnreadNotificationCount,
} from './useNotifications'

const MS_PER_DAY = 86_400_000

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
  const [tab, setTab] = useState<'unread' | 'all'>('unread')

  useNotificationRealtime()

  const onlyUnread = tab === 'unread'
  const notifications = useNotifications(onlyUnread)
  const unread = useUnreadNotificationCount()
  const markRead = useMarkNotificationsRead()

  const groups = useMemo(
    () => groupByDay(notifications.data ?? [], timezone, new Date()),
    [notifications.data, timezone],
  )

  const unreadCount = unread.data ?? 0

  function handleSelect(notification: AppNotification) {
    if (!notification.is_read) markRead.mutate({ ids: [notification.id] })
    const path = internalLink(notification.link)
    if (path) navigate(path)
  }

  function handleMarkAll() {
    markRead.mutate({}, { onSuccess: () => toast.success('All notifications marked as read') })
  }

  const list = notifications.isPending ? (
    <LoadingBlock label="Loading notifications" rows={4} />
  ) : notifications.isError ? (
    <div className="p-5">
      <ErrorBlock error={notifications.error} onRetry={() => void notifications.refetch()} />
    </div>
  ) : groups.length === 0 ? (
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
          <Button variant="outline" size="sm" onClick={() => setTab('all')}>
            View all notifications
          </Button>
        ) : undefined
      }
    />
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
        }
      />

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

      <Tabs
        defaultValue="unread"
        value={tab}
        onValueChange={(value) => setTab(value === 'all' ? 'all' : 'unread')}
      >
        <TabList>
          <Tab value="unread" count={unreadCount}>
            Unread
          </Tab>
          <Tab value="all">All</Tab>
        </TabList>

        <div className="mt-4">
          <TabPanel value="unread">
            <Card className="overflow-hidden">{list}</Card>
          </TabPanel>
          <TabPanel value="all">
            <Card className="overflow-hidden">{list}</Card>
          </TabPanel>
        </div>
      </Tabs>
    </div>
  )
}
