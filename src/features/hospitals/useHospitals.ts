import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { Hospital } from '@/lib/types'

// One literal, not a concatenation: supabase-js parses this string at the type
// level and a joined expression widens to `string`, which loses the row type.
const HOSPITAL_COLUMNS =
  'id, name, code, level, address, city, region, country, latitude, longitude, phone, emergency_phone, email, timezone, is_active, accepts_referrals, notes, created_at, updated_at'

/** The directory changes rarely; a long stale time keeps card lists from refetching. */
const DIRECTORY_STALE_MS = 5 * 60_000

export interface HospitalFilters {
  search?: string
  region?: string
  /** Defaults to true -- a decommissioned facility should not be referrable. */
  onlyActive?: boolean
}

/**
 * PostgREST parses `or=(...)` as a comma-delimited list, so a search term
 * containing a comma, bracket or wildcard would change the meaning of the
 * filter rather than be matched literally.
 */
function sanitiseSearchTerm(term: string): string {
  return term.replace(/[,()%\*"']/g, ' ').replace(/\s+/g, ' ').trim()
}

export function useHospitals(filters: HospitalFilters = {}): UseQueryResult<Hospital[]> {
  const { region, onlyActive = true } = filters
  const search = sanitiseSearchTerm(filters.search ?? '')

  return useQuery({
    queryKey: queryKeys.hospitals.list({ search, region: region ?? null, onlyActive }),
    staleTime: DIRECTORY_STALE_MS,
    queryFn: async () => {
      let query = supabase.from('hospitals').select(HOSPITAL_COLUMNS).order('name')

      if (onlyActive) query = query.eq('is_active', true)
      if (region) query = query.eq('region', region)
      if (search) {
        query = query.or(
          `name.ilike.%${search}%,code.ilike.%${search}%,city.ilike.%${search}%`,
        )
      }

      const { data, error } = await query
      if (error) throw new Error(humanizeSupabaseError(error))
      return (data ?? []) as Hospital[]
    },
  })
}

export function useHospital(hospitalId: string | null): UseQueryResult<Hospital | null> {
  return useQuery({
    queryKey: queryKeys.hospitals.detail(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    staleTime: DIRECTORY_STALE_MS,
    queryFn: async () => {
      if (!hospitalId) return null

      const { data, error } = await supabase
        .from('hospitals')
        .select(HOSPITAL_COLUMNS)
        .eq('id', hospitalId)
        .maybeSingle()

      if (error) throw new Error(humanizeSupabaseError(error))
      return (data as Hospital | null) ?? null
    },
  })
}
