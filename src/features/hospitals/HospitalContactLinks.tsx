import { Mail, Phone, Siren } from 'lucide-react'
import { cn, telHref } from '@/lib/utils'

/**
 * Contact affordances are anchors, not buttons: on a ward phone `tel:` and
 * `mailto:` need to be long-pressable and openable in a new app, which a
 * scripted click handler takes away.
 */
const LINK_BASE =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors'

const LINK_TONES = {
  neutral:
    'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  emergency:
    'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70',
} as const

export function CallLink({
  phone,
  label,
  emergency,
  className,
}: {
  phone: string | null | undefined
  label?: string
  emergency?: boolean
  className?: string
}) {
  const href = telHref(phone)
  if (!href || !phone) return null

  const text = label ?? phone
  return (
    <a
      href={href}
      className={cn(LINK_BASE, emergency ? LINK_TONES.emergency : LINK_TONES.neutral, className)}
      aria-label={`${emergency ? 'Call emergency line' : 'Call'} ${phone}`}
    >
      {emergency ? <Siren className="h-3.5 w-3.5" aria-hidden /> : <Phone className="h-3.5 w-3.5" aria-hidden />}
      <span className="truncate">{text}</span>
    </a>
  )
}

export function EmailLink({
  email,
  label,
  className,
}: {
  email: string | null | undefined
  label?: string
  className?: string
}) {
  if (!email) return null
  return (
    <a
      href={`mailto:${email}`}
      className={cn(LINK_BASE, LINK_TONES.neutral, className)}
      aria-label={`Email ${email}`}
    >
      <Mail className="h-3.5 w-3.5" aria-hidden />
      <span className="truncate">{label ?? email}</span>
    </a>
  )
}
