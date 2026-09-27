import { useState } from 'react'
import { monogramColors, monogramText } from '@/lib/monogram'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export type HospitalLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<HospitalLogoSize, { box: string; text: string; radius: string }> = {
  xs: { box: 'h-6 w-6', text: 'text-[9px]', radius: 'rounded-md' },
  sm: { box: 'h-8 w-8', text: 'text-[10px]', radius: 'rounded-lg' },
  md: { box: 'h-10 w-10', text: 'text-xs', radius: 'rounded-lg' },
  lg: { box: 'h-14 w-14', text: 'text-sm', radius: 'rounded-xl' },
  xl: { box: 'h-20 w-20', text: 'text-base', radius: 'rounded-2xl' },
}

export interface HospitalLogoProps {
  hospital: { name: string; code?: string | null; logo_url?: string | null }
  size?: HospitalLogoSize
  className?: string
  /** Decorative when the hospital name is printed right next to it. */
  decorative?: boolean
}

/**
 * A facility's logo, or a deterministic monogram tile when it has none.
 *
 * Uploaded logos sit on a white tile with a hairline border, because most
 * hospital crests are designed for paper and disappear on a dark surface.
 */
export function HospitalLogo({
  hospital,
  size = 'md',
  className,
  decorative = true,
}: HospitalLogoProps) {
  const { theme } = useTheme()
  const [broken, setBroken] = useState<string | null>(null)
  const dims = SIZES[size]
  const url = hospital.logo_url?.trim() || null
  const showImage = url && broken !== url

  if (showImage) {
    return (
      <span
        className={cn(
          'inline-grid shrink-0 place-items-center overflow-hidden border border-slate-200 bg-white p-0.5 dark:border-slate-700',
          dims.box,
          dims.radius,
          className,
        )}
      >
        <img
          src={url}
          alt={decorative ? '' : `${hospital.name} logo`}
          aria-hidden={decorative || undefined}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(url)}
          className="h-full w-full object-contain"
        />
      </span>
    )
  }

  const seed = hospital.code || hospital.name
  const colors = monogramColors(seed, theme === 'dark')

  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${hospital.name} monogram`}
      aria-hidden={decorative || undefined}
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      className={cn(
        'inline-grid shrink-0 select-none place-items-center border font-semibold tracking-wide',
        dims.box,
        dims.text,
        dims.radius,
        className,
      )}
    >
      {monogramText(hospital.name, hospital.code)}
    </span>
  )
}
