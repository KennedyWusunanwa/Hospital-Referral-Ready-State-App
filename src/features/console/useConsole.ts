/**
 * Data access for the system console: network-wide statistics, the sign-in
 * log and the emergency catalogue. Everything here is super-administrator
 * territory; the database enforces that, these hooks just fetch.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type { LoginMethod, ResourceKey, UrgencyLevel } from '@/lib/constants'
import type { Json, Tables, TablesInsert } from '@/lib/database.types'
import type { EmergencyRequirement, EmergencyType } from '@/lib/types'
import { normalisePlatformStats, type PlatformStats } from './platformStats'

export { describeUserAgent } from '@/lib/userAgent'
export * from './platformStats'

// ---------------------------------------------------------------------------
// Platform statistics
// ---------------------------------------------------------------------------

export function usePlatformStats(): UseQueryResult<PlatformStats> {
  return useQuery({
    queryKey: queryKeys.console.stats,
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('platform_stats')
      if (error) throw new Error(humanizeSupabaseError(error))
      return normalisePlatformStats(data ?? null)
    },
  })
}

// ---------------------------------------------------------------------------
// Sign-in log
// ---------------------------------------------------------------------------

export type LoginEvent = Tables<'login_events'>

export interface LoginEventFilters {
  /** Matches the email address. */
  q?: string
  method?: LoginMethod | ''
  hospitalId?: string | null
  /** ISO date (yyyy-mm-dd), inclusive. */
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface LoginEventPage {
  rows: LoginEvent[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export const LOGIN_PAGE_SIZE = 50
export const LOGIN_EXPORT_LIMIT = 5000

function sanitise(term: string): string {
  return term
    .replace(/[,()%*"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchLoginEvents(
  filters: LoginEventFilters,
  limit: number,
  offset: number,
): Promise<{ rows: LoginEvent[]; total: number }> {
  let query = supabase
    .from('login_events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const needle = sanitise(filters.q ?? '')
  if (needle) query = query.ilike('email', `%${needle}%`)
  if (filters.method) query = query.eq('method', filters.method)
  if (filters.hospitalId) query = query.eq('hospital_id', filters.hospitalId)
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00.000Z`)
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`)

  const { data, error, count } = await query
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) {
      throw new Error(
        'The sign-in log table has not been created yet. Run migration 0006_platform_console.sql.',
      )
    }
    throw new Error(humanizeSupabaseError(error))
  }
  return { rows: (data ?? []) as LoginEvent[], total: count ?? 0 }
}

export function useLoginEvents(filters: LoginEventFilters): UseQueryResult<LoginEventPage> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = filters.pageSize ?? LOGIN_PAGE_SIZE
  return useQuery({
    queryKey: queryKeys.console.loginEvents({ ...filters, page, pageSize }),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    queryFn: async () => {
      const { rows, total } = await fetchLoginEvents(filters, pageSize, (page - 1) * pageSize)
      return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
    },
  })
}

export async function fetchLoginEventsForExport(filters: LoginEventFilters): Promise<LoginEvent[]> {
  const { rows } = await fetchLoginEvents(filters, LOGIN_EXPORT_LIMIT, 0)
  return rows
}

// ---------------------------------------------------------------------------
// Emergency catalogue
// ---------------------------------------------------------------------------

export interface EmergencyCatalogue {
  types: EmergencyType[]
  requirements: Record<string, EmergencyRequirement[]>
}

export function useEmergencyCatalogue(): UseQueryResult<EmergencyCatalogue> {
  return useQuery({
    queryKey: queryKeys.admin.emergencyCatalogue,
    staleTime: 60_000,
    queryFn: async () => {
      const [types, requirements] = await Promise.all([
        supabase
          .from('emergency_types')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('emergency_requirements')
          .select('*')
          .order('is_critical', { ascending: false })
          .order('weight', { ascending: false }),
      ])
      if (types.error) throw new Error(humanizeSupabaseError(types.error))
      if (requirements.error) throw new Error(humanizeSupabaseError(requirements.error))

      const grouped: Record<string, EmergencyRequirement[]> = {}
      for (const row of (requirements.data ?? []) as EmergencyRequirement[]) {
        ;(grouped[row.emergency_type_id] ||= []).push(row)
      }
      return { types: (types.data ?? []) as EmergencyType[], requirements: grouped }
    },
  })
}

async function logCatalogueChange(entityId: string | null, details: Json): Promise<void> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: 'config.update',
    p_entity_type: 'emergency_type',
    p_entity_id: entityId,
    p_details: details,
  })
  if (error)
    console.warn(`audit event for the emergency catalogue was not recorded: ${error.message}`)
}

export interface UpsertEmergencyTypeInput {
  id?: string | null
  code: string
  name: string
  category: string
  description: string | null
  default_urgency: UrgencyLevel
  sort_order: number
  is_active: boolean
}

export function useUpsertEmergencyType(): UseMutationResult<
  EmergencyType,
  Error,
  UpsertEmergencyTypeInput
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: UpsertEmergencyTypeInput) => {
      if (id) {
        const { data, error } = await supabase
          .from('emergency_types')
          .update(values)
          .eq('id', id)
          .select('*')
          .single()
        if (error) throw new Error(humanizeSupabaseError(error))
        await logCatalogueChange(id, { ...values } as Json)
        return data as EmergencyType
      }
      const { data, error } = await supabase
        .from('emergency_types')
        .insert(values as TablesInsert<'emergency_types'>)
        .select('*')
        .single()
      if (error) throw new Error(humanizeSupabaseError(error))
      await logCatalogueChange(data.id, { created: true, ...values } as Json)
      return data as EmergencyType
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.emergencyCatalogue })
      void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyTypes.all })
    },
  })
}

export interface RequirementDraft {
  resource_key: ResourceKey
  weight: number
  is_critical: boolean
  min_quantity: number
}

/** Replaces the requirement set for one emergency type in a single save. */
export function useSaveRequirements(): UseMutationResult<
  void,
  Error,
  { emergencyTypeId: string; rows: RequirementDraft[] }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ emergencyTypeId, rows }) => {
      const keep = rows.map((row) => row.resource_key)

      let remove = supabase
        .from('emergency_requirements')
        .delete()
        .eq('emergency_type_id', emergencyTypeId)
      if (keep.length > 0) remove = remove.not('resource_key', 'in', `(${keep.join(',')})`)
      const removed = await remove
      if (removed.error) throw new Error(humanizeSupabaseError(removed.error))

      if (rows.length > 0) {
        const { error } = await supabase.from('emergency_requirements').upsert(
          rows.map((row) => ({
            emergency_type_id: emergencyTypeId,
            resource_key: row.resource_key,
            weight: row.weight,
            is_critical: row.is_critical,
            min_quantity: row.min_quantity,
          })),
          { onConflict: 'emergency_type_id,resource_key' },
        )
        if (error) throw new Error(humanizeSupabaseError(error))
      }

      await logCatalogueChange(emergencyTypeId, { requirements: rows } as unknown as Json)
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.emergencyCatalogue })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.emergencyTypes.requirements(variables.emergencyTypeId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
    },
  })
}
