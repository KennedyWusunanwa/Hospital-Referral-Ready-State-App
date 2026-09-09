import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Ban,
  Check,
  CircleDot,
  Clock,
  Hourglass,
  Truck,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui'
import { REFERRAL_STATUS_LABELS, URGENCY_LABELS } from '@/lib/constants'
import type { ReferralStatus, UrgencyLevel } from '@/lib/constants'

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const STATUS_TONES: Record<ReferralStatus, BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  declined: 'danger',
  in_transit: 'info',
  completed: 'brand',
  cancelled: 'neutral',
  expired: 'neutral',
}

/** Colour alone must never carry the state, so each status also gets a glyph. */
const STATUS_ICONS: Record<ReferralStatus, LucideIcon> = {
  pending: Hourglass,
  accepted: Check,
  declined: X,
  in_transit: Truck,
  completed: CircleDot,
  cancelled: Ban,
  expired: Clock,
}

export function ReferralStatusBadge({
  status,
  className,
}: {
  status: ReferralStatus
  className?: string
}) {
  const Icon = STATUS_ICONS[status]
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      <Icon className="h-3 w-3" aria-hidden />
      {REFERRAL_STATUS_LABELS[status]}
    </Badge>
  )
}

const URGENCY_TONES: Record<UrgencyLevel, BadgeTone> = {
  critical: 'danger',
  urgent: 'warning',
  routine: 'neutral',
}

/** Short forms; the full "Critical - immediate" wording is kept as the title. */
const URGENCY_SHORT: Record<UrgencyLevel, string> = {
  critical: 'Critical',
  urgent: 'Urgent',
  routine: 'Routine',
}

export function UrgencyBadge({
  urgency,
  className,
}: {
  urgency: UrgencyLevel
  className?: string
}) {
  return (
    <span title={URGENCY_LABELS[urgency]} className="inline-flex">
      <Badge tone={URGENCY_TONES[urgency]} className={className}>
        {urgency === 'critical' && <AlertTriangle className="h-3 w-3" aria-hidden />}
        <span className="sr-only">Urgency: </span>
        {URGENCY_SHORT[urgency]}
      </Badge>
    </span>
  )
}

export { STATUS_TONES as REFERRAL_STATUS_TONES, URGENCY_TONES as REFERRAL_URGENCY_TONES }
