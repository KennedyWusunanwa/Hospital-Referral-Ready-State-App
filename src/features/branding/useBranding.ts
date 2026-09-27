/**
 * Network branding, read side.
 *
 * `app_settings` is readable by anon on purpose: the sign-in screen paints the
 * logo and brand colour before anyone has a session. Everything here therefore
 * works signed out, and falls back to the compiled-in defaults if the table has
 * not been created yet.
 *
 * Logos come in two variants. The "light" logo is dark artwork for light
 * surfaces; the "dark" logo is light artwork for dark surfaces and the coloured
 * sign-in panel. When the network has uploaded neither, the built-in FERN
 * wordmark is used; when it has uploaded only one, that one is used everywhere,
 * because a single full-colour logo normally reads on both.
 */

import { useEffect } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { supabase } from '@/lib/supabase'
import { APP_NAME, APP_TAGLINE, SUPPORT_EMAIL, type LogoMode } from '@/lib/constants'
import {
  DEFAULT_BRAND_COLOR,
  applyBrandColor,
  isValidHex,
  resolveLogo,
  toLogoMode,
  writeCachedBranding,
  type LogoVariant,
  type ResolvedLogo,
} from '@/lib/branding'
import { useTheme } from '@/lib/theme'
import type { Tables } from '@/lib/database.types'

export type AppSettings = Tables<'app_settings'>

export interface Branding {
  brandColor: string
  /** Custom logo for light surfaces, or null for the built-in wordmark. */
  logoUrl: string | null
  /** Custom logo for dark surfaces, or null for the built-in wordmark. */
  logoDarkUrl: string | null
  logoMode: LogoMode
  appName: string
  appTagline: string
  supportEmail: string
}

export const FALLBACK_BRANDING: Branding = {
  brandColor: DEFAULT_BRAND_COLOR,
  logoUrl: null,
  logoDarkUrl: null,
  logoMode: 'auto',
  appName: APP_NAME,
  appTagline: APP_TAGLINE,
  supportEmail: SUPPORT_EMAIL,
}

function cleanUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export { resolveLogo, toLogoMode } from '@/lib/branding'
export type { LogoVariant, ResolvedLogo } from '@/lib/branding'

export function rowToBranding(row: AppSettings | null): Branding {
  if (!row) return FALLBACK_BRANDING
  return {
    brandColor: isValidHex(row.brand_color ?? '') ? row.brand_color : DEFAULT_BRAND_COLOR,
    logoUrl: cleanUrl(row.logo_url),
    logoDarkUrl: cleanUrl(row.logo_dark_url),
    logoMode: toLogoMode(row.logo_mode),
    appName: row.app_name?.trim() || FALLBACK_BRANDING.appName,
    appTagline: row.app_tagline?.trim() || FALLBACK_BRANDING.appTagline,
    supportEmail: row.support_email?.trim() || FALLBACK_BRANDING.supportEmail,
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAppSettings(): UseQueryResult<AppSettings | null> {
  return useQuery({
    queryKey: queryKeys.appSettings,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
      if (error) {
        // A deployment that has not run migration 0005 yet should still load,
        // just with the default look, rather than failing every screen.
        if (/does not exist|schema cache|relation|column/i.test(error.message)) return null
        throw error
      }
      return (data ?? null) as AppSettings | null
    },
    // Branding changes rarely and is needed on every screen.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  })
}

/** Resolved branding with defaults already applied. */
export function useBranding(): Branding {
  const { data } = useAppSettings()
  return rowToBranding(data ?? null)
}

/** The logo for the current theme (or a forced surface), ready to render. */
export function useBrandLogo(
  surface: 'auto' | LogoVariant = 'auto',
  kind: 'wordmark' | 'mark' = 'wordmark',
): ResolvedLogo {
  const branding = useBranding()
  const { theme } = useTheme()
  return resolveLogo(branding, theme, surface, kind)
}

/**
 * Pushes the stored colour onto the document and remembers it, so the next boot
 * paints the right brand before the query has resolved.
 *
 * Mounted once, above the router, so it covers the signed-out screens too.
 */
export function useApplyBranding(): void {
  const branding = useBranding()

  useEffect(() => {
    applyBrandColor(branding.brandColor)
    writeCachedBranding({
      brandColor: branding.brandColor,
      logoUrl: branding.logoUrl,
      logoDarkUrl: branding.logoDarkUrl,
      logoMode: branding.logoMode,
      appName: branding.appName,
      appTagline: branding.appTagline,
    })
  }, [
    branding.brandColor,
    branding.logoUrl,
    branding.logoDarkUrl,
    branding.logoMode,
    branding.appName,
    branding.appTagline,
  ])

  useEffect(() => {
    document.title = `${branding.appName} - ${branding.appTagline}`
  }, [branding.appName, branding.appTagline])
}

export function BrandingEffect(): null {
  useApplyBranding()
  return null
}
