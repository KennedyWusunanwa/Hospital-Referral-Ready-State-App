import {
  Ambulance,
  Ban,
  ChevronRight,
  ClipboardCheck,
  CircleCheckBig,
  CircleX,
  Info,
  MessageSquare,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui'
import type { NotificationType } from '@/lib/constants'
import type { AppNotification } from '@/lib/types'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import { internalLink, notificationSeverity, type NotificationSeverity } from './useNotifications'

/** Notification types are not in the shared catalogue with labels, so name them here. */
const TYPE_LABELS: Record<NotificationType, string> = {
  readiness_overdue: 'Readiness overdue',
  referral_incoming: 'Incoming referral',
  referral_accepted: 'Referral accepted',
  referral_declined: 'Referral declined',
  referral_in_transit: 'Patient in transit',
  referral_completed: 'Referral completed',
  referral_cancelled: 'Referral cancelled',
  message_received: 'New message',
  system: 'System',
}

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  readiness_overdue: TriangleAlert,
  referral_incoming: Ambulance,
  referral_accepted: CircleCheckBig,
  referral_declined: CircleX,
  referral_in_transit: Truck,
  referral_completed: ClipboardCheck,
  referral_cancelled: Ban,
  message_received: MessageSquare,
  system: Info,
}

const SEVERITY_ICON_CLASSES: Record<NotificationSeverity, string> = {
  info: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300',
  critical: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-300',
}

const SEVERITY_BADGE_TONES = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
} as const

export interface NotificationItemProps {
  notification: AppNotification
  /** Marks the row read and follows its link, if it has one. */
  onSelect: (notification: AppNotification) => void
  timezone?: string
}

export function NotificationItem({ notification, onSelect, timezone }: NotificationItemProps) {
  const severity = notificationSeverity(notification.severity)
  const Icon = TYPE_ICONS[notification.type]
  const unread = !notification.is_read
  const link = internalLink(notification.link)

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(notification)}
        className={cn(
          'flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors',
          'hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-brand-500 dark:hover:bg-slate-800/60',
          unread
            ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/20'
            : 'border-transparent bg-transparent',
        )}
      >
        <span
          className={cn(
            'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg',
            SEVERITY_ICON_CLASSES[severity],
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 text-sm',
                unread
                  ? 'font-semibold text-slate-900 dark:text-slate-50'
                  : 'font-normal text-slate-600 dark:text-slate-400',
              )}
            >
              {notification.title}
            </span>
            {unread && (
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400"
                aria-hidden
              />
            )}
          </span>

          {notification.body && (
            <span
              className={cn(
                'mt-0.5 block text-sm',
                unread
                  ? 'text-slate-700 dark:text-slate-300'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {notification.body}
            </span>
          )}

          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_BADGE_TONES[severity]}>{TYPE_LABELS[notification.type]}</Badge>
            <span className="hint" title={formatDateTime(notification.created_at, timezone)}>
              {relativeTime(notification.created_at)}
            </span>
            {unread && (
              <span className="text-xs font-semibold text-brand-700 dark:text-brand-400">
                Unread
              </span>
            )}
            {link && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-xs text-slate-400">
                Open
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}
