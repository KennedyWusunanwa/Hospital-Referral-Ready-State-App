import { useState } from 'react'
import { useBranding, useBrandLogo, type LogoVariant } from '@/features/branding/useBranding'
import { BUILT_IN_LOGOS } from '@/lib/constants'
import { cn } from '@/lib/utils'

export interface BrandLogoProps {
  /**
   * `auto` follows the painted theme. A surface that is always dark (the
   * coloured sign-in panel) passes `dark` so it gets light artwork whatever the
   * theme is.
   */
  surface?: 'auto' | LogoVariant
  /** `mark` is the square emblem alone; `wordmark` includes the name. */
  kind?: 'wordmark' | 'mark'
  className?: string
  /** Decorative when the name is already printed alongside. */
  decorative?: boolean
}

/**
 * The network's logo, already resolved for the current theme.
 *
 * A custom upload that fails to load falls back to the built-in artwork rather
 * than a broken image icon in the corner of every screen.
 */
export function BrandLogo({
  surface = 'auto',
  kind = 'wordmark',
  className,
  decorative = false,
}: BrandLogoProps) {
  const { appName } = useBranding()
  const logo = useBrandLogo(surface, kind)
  const [failed, setFailed] = useState<string | null>(null)

  const fallback =
    kind === 'mark'
      ? logo.variant === 'dark'
        ? BUILT_IN_LOGOS.markDark
        : BUILT_IN_LOGOS.markLight
      : logo.variant === 'dark'
        ? BUILT_IN_LOGOS.dark
        : BUILT_IN_LOGOS.light

  const src = failed === logo.src ? fallback : logo.src

  return (
    <img
      src={src}
      alt={decorative ? '' : appName}
      aria-hidden={decorative || undefined}
      draggable={false}
      onError={() => {
        if (src !== fallback) setFailed(logo.src)
      }}
      className={cn('select-none object-contain object-left', className)}
    />
  )
}
