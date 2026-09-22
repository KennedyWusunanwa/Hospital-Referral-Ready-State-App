/**
 * Network branding, read side.
 *
 * `app_settings` is readable by anon on purpose: the sign-in screen paints the
 * logo and brand colour before anyone has a session. Everything here therefore
 * works signed out, and falls back to the compiled-in defaults if the table has
 * not been created yet.
 */

import { useEffect } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { supabase } from '@/lib/supabase'
import { APP_NAME, APP_TAGLINE, SUPPORT_EMAIL } from '@/lib/constants'
import {
  DEFAULT_BRAND_COLOR,
  applyBrandColor,
  isValidHex,
  writeCachedBranding,
} from '@/lib/branding'
import type { Tables } from '@/lib/database.types'

export type AppSettings = Tables<'app_settings'>

export interface Branding {
  brandColor: string
  logoUrl: string | null
  appName: string
  appTagline: string
  supportEmail: string
}

export const FALLBACK_BRANDING: Branding = {
  brandColor: DEFAULT_BRAND_COLOR,
  logoUrl: null,
  appName: APP_NAME,
  appTagline: APP_TAGLINE,
  supportEmail: SUPPORT_EMAIL,
}

export function rowToBranding(row: AppSettings | null): Branding {
  if (!row) return FALLBACK_BRANDING
  return {
    brandColor: isValidHex(row.brand_color ?? '') ? row.brand_color : DEFAULT_BRAND_COLOR,
    logoUrl: row.logo_url?.trim() ? row.logo_url : null,
    appName: row.app_name?.trim() || FALLBACK_BRANDING.appName,
    appTagline: row.app_tagline?.trim() || FALLBACK_BRANDING.appTagline,
    supportEmail: row.support_email?.trim() || FALLBACK_BRANDING.supportEmail,
  }
}

export function useAppSettings(): UseQueryResult<AppSettings | null> {
  return useQuery({
    queryKey: queryKeys.appSettings,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
      if (error) {
        // A deployment that has not run migration 0005 yet should still load,
        // just with the default look, rather than failing every screen.
        if (/does not exist|schema cache|relation/i.test(error.message)) return null
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
      appName: branding.appName,
      appTagline: branding.appTagline,
    })
  }, [branding.brandColor, branding.logoUrl, branding.appName, branding.appTagline])

  useEffect(() => {
    document.title = `${branding.appName} - ${branding.appTagline}`
  }, [branding.appName, branding.appTagline])
}

export function BrandingEffect(): null {
  useApplyBranding()
  return null
}
