/**
 * Notifications: the read model behind the header bell and the notifications
 * page, plus the realtime subscription that surfaces an incoming referral in
 * seconds instead of at the next poll.
 */

import { useEffect, useRef } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { toast, type ExternalToast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/constants'
import type { Tables } from '@/lib/database.types'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { AppNotification } from '@/lib/types'

type NotificationRow = Tables<'notifications'>

const NOTIFICATION_COLUMNS =
  'id, user_id, hospital_id, type, title, body, link, severity, is_read, read_at, created_at'

/** A notification list is a working queue, not an archive. */
const MAX_NOTIFICATIONS = 100

const UNREAD_POLL_MS = 30_000

/**
 * Must stay in step with the `severity` CHECK constraint in 0001_schema.sql --
 * the database rejects anything outside these three.
 */
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export function notificationSeverity(value: string | null | undefined): NotificationSeverity {
  const known: readonly string[] = NOTIFICATION_SEVERITIES
  return value && known.includes(value) ? (value as NotificationSeverity) : 'info'
}

function notificationType(value: string): NotificationType {
  const known: readonly string[] = NOTIFICATION_TYPES
  return known.includes(value) ? (value as NotificationType) : 'system'
}

function toAppNotification(row: NotificationRow): AppNotification {
  return { ...row, type: notificationType(row.type) }
}

/**
 * Only ever follow an in-app path. `link` is written by database triggers, and
 * a signed-in clinician should never be bounced off-site by a stored value.
 */
export function internalLink(link: string | null | undefined): string | null {
  if (!link) return null
  return link.startsWith('/') && !link.startsWith('//') ? link : null
}

function invalidateNotifications(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useNotifications(onlyUnread = false): UseQueryResult<AppNotification[]> {
  const { user } = useAuth()
  const userId = user?.id ?? null

  return useQuery({
    queryKey: [...queryKeys.notifications.all, { userId, onlyUnread }],
    enabled: Boolean(userId),
    queryFn: async () => {
      let query = supabase
        .from('notifications')
        .select(NOTIFICATION_COLUMNS)
        .eq('user_id', userId ?? '')
        .order('created_at', { ascending: false })
        .limit(MAX_NOTIFICATIONS)

      if (onlyUnread) query = query.eq('is_read', false)

      const { data, error } = await query
      if (error) throw new Error(humanizeSupabaseError(error))
      return (data ?? []).map(toAppNotification)
    },
  })
}

export function useUnreadNotificationCount(): UseQueryResult<number> {
  const { user } = useAuth()
  const userId = user?.id ?? null

  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    enabled: Boolean(userId),
    // Mounted on every screen via the header bell, so it stays a head-only
    // count and never pulls rows.
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId ?? '')
        .eq('is_read', false)

      if (error) throw new Error(humanizeSupabaseError(error))
      return count ?? 0
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useMarkNotificationsRead(): UseMutationResult<unknown, Error, { ids?: string[] }> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ids }: { ids?: string[] }) => {
      // A null `p_ids` means "everything addressed to me", which is what the
      // "Mark all as read" action wants.
      const { data, error } = await supabase.rpc('mark_notifications_read', {
        p_ids: ids && ids.length > 0 ? ids : null,
      } as never)
      if (error) throw new Error(humanizeSupabaseError(error))
      return data
    },
    onSuccess: () => invalidateNotifications(queryClient),
    onError: (error) => toast.error(humanizeSupabaseError(error)),
  })
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

type NotificationListener = (notification: AppNotification) => void

interface NotificationSubscription {
  channel: RealtimeChannel
  listeners: NotificationListener[]
  teardown: ReturnType<typeof setTimeout> | null
}

/**
 * One websocket per signed-in user, shared by every consumer of the hook. The
 * layout bell and the notifications page must not open two subscriptions, and
 * neither must React StrictMode's mount / unmount / mount cycle.
 */
const subscriptions = new Map<string, NotificationSubscription>()

/** Long enough to survive a StrictMode remount or a route change. */
const TEARDOWN_GRACE_MS = 1_000

function subscribeToInserts(userId: string, listener: NotificationListener): () => void {
  let entry = subscriptions.get(userId)

  if (entry) {
    if (entry.teardown) {
      clearTimeout(entry.teardown)
      entry.teardown = null
    }
  } else {
    const listeners: NotificationListener[] = []
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on<NotificationRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Only the longest-mounted consumer reacts, so two of them cannot
          // raise the same toast twice for a single insert.
          listeners[0]?.(toAppNotification(payload.new))
        },
      )
      .subscribe()

    entry = { channel, listeners, teardown: null }
    subscriptions.set(userId, entry)
  }

  entry.listeners.push(listener)

  return () => {
    const current = subscriptions.get(userId)
    if (!current) return

    const index = current.listeners.indexOf(listener)
    if (index !== -1) current.listeners.splice(index, 1)
    if (current.listeners.length > 0 || current.teardown) return

    current.teardown = setTimeout(() => {
      current.teardown = null
      if (current.listeners.length > 0) return
      subscriptions.delete(userId)
      void supabase.removeChannel(current.channel)
    }, TEARDOWN_GRACE_MS)
  }
}

function raiseToast(notification: AppNotification, navigate: NavigateFunction): void {
  const path = internalLink(notification.link)
  const options: ExternalToast = {
    description: notification.body ?? undefined,
    action: path ? { label: 'View', onClick: () => navigate(path) } : undefined,
  }

  switch (notificationSeverity(notification.severity)) {
    case 'critical':
      toast.error(notification.title, options)
      break
    case 'warning':
      toast.warning(notification.title, options)
      break
    default:
      toast(notification.title, options)
  }
}

/**
 * Subscribes to inserts on the current user's notifications, refreshes the
 * cached lists and announces the arrival. Safe to call from more than one
 * component: the subscription is shared and reference-counted.
 */
export function useNotificationRealtime(): void {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const userId = user?.id ?? null

  // Held in a ref so a re-render never tears the websocket down and rebuilds it
  // just because a callback identity changed.
  const listenerRef = useRef<NotificationListener>(() => {})
  useEffect(() => {
    listenerRef.current = (notification) => {
      invalidateNotifications(queryClient)
      raiseToast(notification, navigate)
    }
  }, [queryClient, navigate])

  useEffect(() => {
    if (!userId) return
    return subscribeToInserts(userId, (notification) => listenerRef.current(notification))
  }, [userId])
}
