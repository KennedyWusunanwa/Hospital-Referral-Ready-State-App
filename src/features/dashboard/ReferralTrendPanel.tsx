/**
 * A seven-day shape-of-things panel. It is a trend, not a report: the reports
 * page owns the analysis, this only shows whether the week is getting busier.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { LineChart } from 'lucide-react'
import { Card, CardBody, CardHeader, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui'
import { ReferralTrendChart } from '@/features/reports/charts'
import { useReferralAnalytics } from '@/features/reports/useReports'
import { weekStartIso } from './dashboardUtils'

export interface ReferralTrendPanelProps {
  hospitalId: string | null
  description?: string
}

export function ReferralTrendPanel({ hospitalId, description }: ReferralTrendPanelProps) {
  const from = useMemo(() => weekStartIso(), [])
  const analytics = useReferralAnalytics({ hospitalId, from })

  const daily = analytics.data?.daily ?? []

  return (
    <Card>
      <CardHeader
        title="Referral trend, last 7 days"
        description={description ?? 'Referrals raised, accepted and completed each day.'}
        action={
          <Link
            to="/reports"
            className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
          >
            Full reports
          </Link>
        }
      />
      <CardBody>
        {analytics.isPending ? (
          <LoadingBlock label="Loading referral trend" rows={3} />
        ) : analytics.isError ? (
          <ErrorBlock error={analytics.error} onRetry={() => void analytics.refetch()} />
        ) : daily.length === 0 ? (
          <EmptyState
            icon={<LineChart className="h-8 w-8" />}
            title="No referrals in the last 7 days"
            description="The trend appears once referrals start moving through the system."
          />
        ) : (
          <ReferralTrendChart data={daily} height={240} />
        )}
      </CardBody>
    </Card>
  )
}
