import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, MessageSquare, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
} from '@/components/ui'
import { ROLE_LABELS, type ReferralStatus } from '@/lib/constants'
import { humanizeSupabaseError } from '@/lib/supabase'
import type { MessageWithSender } from '@/lib/types'
import { cn, formatDate, formatTime } from '@/lib/utils'
import { CallLink } from '@/features/hospitals/HospitalContactLinks'
import {
  isOptimisticMessage,
  useMessageRealtime,
  useMessages,
  useSendMessage,
} from '@/features/messaging/useMessages'

/** Statuses after which the thread is kept as a record but closed to new posts. */
const CLOSED_STATUS_NOTE: Partial<Record<ReferralStatus, string>> = {
  declined: 'This referral was declined, so the thread is closed. Raise a new referral to continue.',
  completed: 'This transfer is complete. The thread is kept as part of the referral record.',
  cancelled: 'This referral was cancelled, so the thread is closed.',
  expired: 'This referral expired without a response, so the thread is closed.',
}

export interface MessageThreadProps {
  referralId: string
  status: ReferralStatus
  /** The facility at the other end of the thread. */
  counterpartName?: string | null
  counterpartPhone?: string | null
  className?: string
}

export function MessageThread({
  referralId,
  status,
  counterpartName,
  counterpartPhone,
  className,
}: MessageThreadProps) {
  const { user, profile, can, timezone } = useAuth()
  const { data: messages, isLoading, error, refetch } = useMessages(referralId)
  const sendMessage = useSendMessage()
  useMessageRealtime(referralId)

  const [draft, setDraft] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  const closedNote = CLOSED_STATUS_NOTE[status]
  const canSend = can('messaging:use') && !closedNote

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distance < 64
    atBottomRef.current = next
    setAtBottom((current) => (current === next ? current : next))
  }

  const scrollToBottom = () => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }

  // Only follow the newest message when the reader is already at the bottom --
  // never yank them out of history they scrolled back to.
  useLayoutEffect(() => {
    if (!atBottomRef.current) return
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  useEffect(() => {
    setDraft('')
  }, [referralId])

  const submit = async () => {
    const body = draft.trim()
    if (!body || !canSend) return
    setDraft('')
    scrollToBottom()
    try {
      await sendMessage.mutateAsync({ referralId, body })
    } catch (err) {
      setDraft(body)
      toast.error(humanizeSupabaseError(err))
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title="Coordination chat"
        description={
          counterpartName ? `Direct line to ${counterpartName}` : 'Direct line between both teams'
        }
        action={<CallLink phone={counterpartPhone} label="Call" />}
      />

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[26rem] min-h-[16rem] overflow-y-auto px-4 py-4"
        >
          {isLoading ? (
            <LoadingBlock label="Loading messages" rows={3} />
          ) : error ? (
            <ErrorBlock error={error} onRetry={() => void refetch()} />
          ) : !messages || messages.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" aria-hidden />}
              title="No messages yet"
              description="Send a note to agree the handover. If the case is urgent, call the facility rather than waiting for a reply."
            />
          ) : (
            <ol className="space-y-3">
              {messages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  previous={index > 0 ? messages[index - 1] : null}
                  own={isOwnSide(message, user?.id ?? null, profile?.hospital_id ?? null)}
                  isSelf={Boolean(user?.id) && message.sender_id === user?.id}
                  timezone={timezone}
                />
              ))}
            </ol>
          )}
        </div>

        {!atBottom && messages && messages.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            Jump to latest
          </button>
        )}
      </div>

      <CardBody className="border-t border-slate-200 pt-4 dark:border-slate-800">
        {canSend ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor={`message-input-${referralId}`} className="sr-only">
              Message to {counterpartName ?? 'the other facility'}
            </label>
            <textarea
              id={`message-input-${referralId}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={2000}
              placeholder="Type a message. Enter to send, Shift+Enter for a new line."
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={draft.trim().length === 0}
            >
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        ) : (
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            {closedNote ?? 'Your role does not include messaging on referrals.'}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/** Right-align everything written from the reader's own facility. */
function isOwnSide(
  message: MessageWithSender,
  userId: string | null,
  hospitalId: string | null,
): boolean {
  if (hospitalId && message.sender_hospital_id) return message.sender_hospital_id === hospitalId
  return Boolean(userId) && message.sender_id === userId
}

function MessageRow({
  message,
  previous,
  own,
  isSelf,
  timezone,
}: {
  message: MessageWithSender
  previous: MessageWithSender | null
  own: boolean
  isSelf: boolean
  timezone: string
}) {
  const day = formatDate(message.created_at, timezone)
  const showDaySeparator = !previous || formatDate(previous.created_at, timezone) !== day
  const pending = isOptimisticMessage(message)
  const senderName = isSelf ? 'You' : (message.sender?.full_name ?? 'Unknown user')
  const senderRole = message.sender?.role ? ROLE_LABELS[message.sender.role] : null

  return (
    <li>
      {showDaySeparator && (
        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {day}
          </span>
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>
      )}

      <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400',
              own && 'justify-end',
            )}
          >
            <span className="font-medium text-slate-700 dark:text-slate-300">{senderName}</span>
            {senderRole && <span>{senderRole}</span>}
            <span className="tabular-nums">{formatTime(message.created_at, timezone)}</span>
          </div>

          <div
            className={cn(
              'mt-1 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
              own
                ? 'rounded-br-sm bg-brand-600 text-white'
                : 'rounded-bl-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
              pending && 'opacity-70',
            )}
          >
            {message.body}
          </div>

          {pending && (
            <div className={cn('mt-1 flex', own && 'justify-end')}>
              <Badge tone="neutral">Sending</Badge>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
