/**
 * The last few referrals in each direction. Deliberately shallow -- it exists
 * so a coordinator can confirm at a glance that what they sent has moved, and
 * hands off to the referral list for anything more.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Inbox, Send } from 'lucide-react'
import { Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui'
import type { ReferralWithRelations } from '@/lib/types'
import { ReferralCard } from '@/features/referrals/ReferralCard'
import { useReferrals } from '@/features/referrals/useReferrals'

const MAX_PER_COLUMN = 5

function Column({
  title,
  icon,
  direction,
  referrals,
  emptyTitle,
  emptyDescription,
  now,
}: {
  title: string
  icon: ReactNode
  direction: 'incoming' | 'outgoing'
  referrals: ReferralWithRelations[]
  emptyTitle: string
  emptyDescription: string
  now: Date
}) {
  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className="text-slate-400 dark:text-slate-500">{icon}</span>
          {title}
        </h2>
        <Link
          to="/referrals"
          className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          View all
        </Link>
      </div>

      <div className="mt-3 space-y-3">
        {referrals.length === 0 ? (
          <Card>
            <EmptyState
              icon={direction === 'incoming' ? <Inbox className="h-7 w-7" /> : <Send className="h-7 w-7" />}
              title={emptyTitle}
              description={emptyDescription}
            />
          </Card>
        ) : (
          referrals.map((referral) => (
            <ReferralCard
              key={referral.id}
              referral={referral}
              direction={direction}
              now={now}
            />
          ))
        )}
      </div>
    </section>
  )
}

export interface RecentActivityProps {
  hospitalId: string | null
  now: Date
}

export function RecentActivity({ hospitalId, now }: RecentActivityProps) {
  // Matches the referral list page's unfiltered query, so navigating there is
  // instant rather than a second round trip.
  const query = useReferrals({ hospitalId, direction: 'all' })

  const { incoming, outgoing } = useMemo(() => {
    const rows = query.data ?? []
    return {
      incoming: rows
        .filter((referral) => referral.receiving_hospital_id === hospitalId)
        .slice(0, MAX_PER_COLUMN),
      outgoing: rows
        .filter((referral) => referral.requesting_hospital_id === hospitalId)
        .slice(0, MAX_PER_COLUMN),
    }
  }, [query.data, hospitalId])

  if (query.isPending) {
    return (
      <Card>
        <LoadingBlock label="Loading recent referrals" rows={4} />
      </Card>
    )
  }

  if (query.isError) {
    return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Column
        title="Recent incoming"
        icon={<ArrowDownLeft className="h-4 w-4" aria-hidden />}
        direction="incoming"
        referrals={incoming}
        emptyTitle="No incoming referrals yet"
        emptyDescription="Requests sent to this hospital will appear here."
        now={now}
      />
      <Column
        title="Recent outgoing"
        icon={<ArrowUpRight className="h-4 w-4" aria-hidden />}
        direction="outgoing"
        referrals={outgoing}
        emptyTitle="No outgoing referrals yet"
        emptyDescription="Referrals this hospital raises will appear here."
        now={now}
      />
    </div>
  )
}
