/**
 * Referral chat data layer.
 *
 * A referral thread is the only channel two hospitals have inside FERN, so the
 * send path is optimistic: the sender sees their message immediately and the
 * realtime INSERT (or the settled mutation) reconciles it against the server
 * copy. Losing a message to a slow ward connection is worse than a brief
 * duplicate.
 */

import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { MessageWithSender } from '@/lib/types'

const MESSAGE_COLUMNS =
  'id, referral_id, sender_id, sender_hospital_id, body, created_at, ' +
  'sender:profiles!messages_sender_id_fkey (id, full_name, role)'

/** Rows added by `onMutate` carry this id prefix until the server copy lands. */
export const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic-'

export function isOptimisticMessage(message: Pick<MessageWithSender, 'id'>): boolean {
  return message.id.startsWith(OPTIMISTIC_MESSAGE_PREFIX)
}

export function useMessages(referralId: string | null): UseQueryResult<MessageWithSender[]> {
  return useQuery({
    queryKey: queryKeys.messages.byReferral(referralId ?? 'none'),
    enabled: Boolean(referralId),
    queryFn: async (): Promise<MessageWithSender[]> => {
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('referral_id', referralId as string)
        .order('created_at', { ascending: true })

      if (error) throw new Error(humanizeSupabaseError(error))
      // The generated Relationships list is empty, so the embed cannot be
      // inferred; the shape is guaranteed by MESSAGE_COLUMNS instead.
      return (data ?? []) as unknown as MessageWithSender[]
    },
  })
}

interface SendMessageInput {
  referralId: string
  body: string
}

interface SendMessageContext {
  key: readonly unknown[]
  previous: MessageWithSender[] | undefined
}

export function useSendMessage(): UseMutationResult<unknown, Error, SendMessageInput> {
  const queryClient = useQueryClient()
  const { user, profile } = useAuth()

  return useMutation<unknown, Error, SendMessageInput, SendMessageContext>({
    mutationFn: async ({ referralId, body }) => {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          referral_id: referralId,
          body,
          sender_id: user?.id ?? null,
          sender_hospital_id: profile?.hospital_id ?? null,
        })
        .select('id')
        .single()

      if (error) throw new Error(humanizeSupabaseError(error))
      return data
    },

    onMutate: async ({ referralId, body }) => {
      const key = queryKeys.messages.byReferral(referralId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<MessageWithSender[]>(key)

      const optimistic: MessageWithSender = {
        id: `${OPTIMISTIC_MESSAGE_PREFIX}${crypto.randomUUID()}`,
        referral_id: referralId,
        sender_id: user?.id ?? null,
        sender_hospital_id: profile?.hospital_id ?? null,
        body,
        created_at: new Date().toISOString(),
        sender: profile
          ? { id: profile.id, full_name: profile.full_name, role: profile.role }
          : null,
      }

      queryClient.setQueryData<MessageWithSender[]>(key, [...(previous ?? []), optimistic])
      return { key, previous }
    },

    onError: (_error, _input, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous)
    },

    onSettled: (_data, _error, { referralId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages.byReferral(referralId) })
    },
  })
}

/**
 * Keeps the thread live for as long as it is on screen. One channel per
 * referral, torn down when the referral changes so a coordinator moving
 * between cases does not accumulate subscriptions.
 */
export function useMessageRealtime(referralId: string | null): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!referralId) return

    const channel = supabase
      .channel(`referral-messages-${referralId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `referral_id=eq.${referralId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.messages.byReferral(referralId),
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [referralId, queryClient])
}
