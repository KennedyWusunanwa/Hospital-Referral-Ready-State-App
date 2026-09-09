/**
 * Administration data access.
 *
 * Administrative writes are the ones an investigation later has to reconstruct,
 * so every mutation here also records an audit event. The audit write is
 * deliberately non-fatal: an administrator whose change succeeded must not be
 * shown a failure because the bookkeeping call was rejected.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_SCORING_CONFIG,
  type AuditAction,
  type ScoringConfig,
  type UserRole,
} from '@/lib/constants'
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/lib/database.types'
import type { AuditLog, Department, Hospital, Profile } from '@/lib/types'

async function logAudit(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  details: Json,
): Promise<void> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_details: details,
  })
  if (error) console.warn(`audit event ${action} was not recorded: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function useStaff(hospitalId: string | null): UseQueryResult<Profile[]> {
  return useQuery({
    queryKey: queryKeys.admin.users(hospitalId),
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select('*')
        .order('is_active', { ascending: false })
        .order('full_name', { ascending: true })

      if (hospitalId) query = query.eq('hospital_id', hospitalId)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as Profile[]
    },
  })
}

export interface UpdateStaffInput {
  userId: string
  /** Only used to target the invalidation at the right cached list. */
  hospitalId: string | null
  changes: {
    role?: UserRole
    department_id?: string | null
    is_active?: boolean
  }
}

export function useUpdateStaff(): UseMutationResult<Profile, Error, UpdateStaffInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, changes }: UpdateStaffInput) => {
      const patch: TablesUpdate<'profiles'> = changes
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select('*')
        .single()
      if (error) throw error

      const action: AuditAction =
        changes.is_active === false ? 'user.deactivate' : 'user.update_role'
      await logAudit(action, 'profile', userId, changes as Json)

      return data as Profile
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users(variables.hospitalId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users(null) })
    },
  })
}

// ---------------------------------------------------------------------------
// Hospital
// ---------------------------------------------------------------------------

export type UpsertHospitalInput = { id?: string | null } & TablesUpdate<'hospitals'>

export function useUpsertHospital(): UseMutationResult<Hospital, Error, UpsertHospitalInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...values }: UpsertHospitalInput) => {
      if (id) {
        const { data, error } = await supabase
          .from('hospitals')
          .update(values)
          .eq('id', id)
          .select('*')
          .single()
        if (error) throw error
        await logAudit('hospital.update', 'hospital', id, values as Json)
        return data as Hospital
      }

      const { data, error } = await supabase
        .from('hospitals')
        .insert(values as TablesInsert<'hospitals'>)
        .select('*')
        .single()
      if (error) throw error
      await logAudit('hospital.create', 'hospital', data.id, values as Json)
      return data as Hospital
    },
    onSuccess: (hospital) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hospitals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.hospitals.detail(hospital.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

/**
 * The readiness feature's `useDepartments` intentionally hides retired
 * departments; administration has to see them in order to bring one back.
 */
export function useAdminDepartments(hospitalId: string | null): UseQueryResult<Department[]> {
  return useQuery({
    queryKey: [...queryKeys.departments.byHospital(hospitalId ?? 'none'), 'admin'],
    enabled: Boolean(hospitalId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('hospital_id', hospitalId as string)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as Department[]
    },
  })
}

/** How much readiness history a department carries -- shown before retiring it. */
export function useDepartmentHistoryCount(departmentId: string | null): UseQueryResult<number> {
  return useQuery({
    queryKey: [...queryKeys.departments.detail(departmentId ?? 'none'), 'history-count'],
    enabled: Boolean(departmentId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('readiness_updates')
        .select('id', { count: 'exact', head: true })
        .eq('department_id', departmentId as string)
      if (error) throw error
      return count ?? 0
    },
  })
}

export type UpsertDepartmentInput = { id?: string | null; hospital_id: string } & TablesUpdate<'departments'>

export function useUpsertDepartment(): UseMutationResult<Department, Error, UpsertDepartmentInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...values }: UpsertDepartmentInput) => {
      if (id) {
        const { data, error } = await supabase
          .from('departments')
          .update(values)
          .eq('id', id)
          .select('*')
          .single()
        if (error) throw error
        await logAudit('department.update', 'department', id, values as Json)
        return data as Department
      }

      const { data, error } = await supabase
        .from('departments')
        .insert(values as TablesInsert<'departments'>)
        .select('*')
        .single()
      if (error) throw error
      await logAudit('department.create', 'department', data.id, values as Json)
      return data as Department
    },
    onSuccess: (department) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.departments.byHospital(department.hospital_id),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.departments.readiness(department.hospital_id),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments.all })
    },
  })
}

/**
 * Departments are retired, never deleted: their readiness history is the
 * evidence behind every compliance report, and a hard delete would silently
 * rewrite the past.
 */
export function useDeleteDepartment(): UseMutationResult<
  unknown,
  Error,
  { departmentId: string; hospitalId: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ departmentId }) => {
      const { error } = await supabase
        .from('departments')
        .update({ is_active: false })
        .eq('id', departmentId)
      if (error) throw error
      await logAudit('department.update', 'department', departmentId, { is_active: false })
      return null
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.departments.byHospital(variables.hospitalId),
      })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.departments.readiness(variables.hospitalId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments.all })
    },
  })
}

// ---------------------------------------------------------------------------
// Scoring configuration
// ---------------------------------------------------------------------------

export type ScoringConfigRow = Tables<'scoring_config'>

export function rowToScoringConfig(row: ScoringConfigRow): ScoringConfig {
  return {
    resourceWeight: row.resource_weight,
    proximityWeight: row.proximity_weight,
    yellowPenalty: row.yellow_penalty,
    redPenalty: row.red_penalty,
    maxEtaMinutes: row.max_eta_minutes,
    maxDistanceKm: row.max_distance_km,
    roadDistanceFactor: row.road_distance_factor,
    fixedTransportOverheadMinutes: row.fixed_transport_overhead_minutes,
    tieBreakEpsilon: row.tie_break_epsilon,
    excludeRedHospitals: row.exclude_red_hospitals,
    excludeHospitalsOnDiversion: row.exclude_hospitals_on_diversion,
  }
}

/**
 * The raw row, including `updated_at` / `updated_by`, which the settings screen
 * shows and the narrowed `ScoringConfig` deliberately drops. Keyed one segment
 * below the shared scoring-config key so the two caches never collide while a
 * single invalidation still clears both.
 */
export function useScoringConfigRow(): UseQueryResult<ScoringConfigRow | null> {
  return useQuery({
    queryKey: [...queryKeys.admin.scoringConfig, 'row'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scoring_config')
        .select('*')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export type UpdateScoringConfigInput = { id?: number } & ScoringConfig

export function useUpdateScoringConfig(): UseMutationResult<
  ScoringConfigRow,
  Error,
  UpdateScoringConfigInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id = 1, ...config }: UpdateScoringConfigInput) => {
      const values: TablesUpdate<'scoring_config'> = {
        resource_weight: config.resourceWeight,
        proximity_weight: config.proximityWeight,
        yellow_penalty: config.yellowPenalty,
        red_penalty: config.redPenalty,
        max_eta_minutes: config.maxEtaMinutes,
        max_distance_km: config.maxDistanceKm,
        road_distance_factor: config.roadDistanceFactor,
        fixed_transport_overhead_minutes: config.fixedTransportOverheadMinutes,
        tie_break_epsilon: config.tieBreakEpsilon,
        exclude_red_hospitals: config.excludeRedHospitals,
        exclude_hospitals_on_diversion: config.excludeHospitalsOnDiversion,
      }

      const { data, error } = await supabase
        .from('scoring_config')
        .update(values)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error

      await logAudit('config.update', 'scoring_config', null, { id, ...values } as Json)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.scoringConfig })
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
    },
  })
}

export const FALLBACK_SCORING_CONFIG: ScoringConfig = DEFAULT_SCORING_CONFIG

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogFilters {
  hospitalId?: string | null
  /** ISO date (yyyy-mm-dd), inclusive. */
  from?: string
  /** ISO date (yyyy-mm-dd), inclusive -- expanded to the end of that day. */
  to?: string
  action?: AuditAction | ''
  entityType?: string
  actorSearch?: string
  page?: number
  pageSize?: number
}

/** An audit row with the actor's display name resolved where it still exists. */
export interface AuditLogEntry extends AuditLog {
  actor_name: string | null
}

export interface AuditLogPage {
  rows: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export const AUDIT_PAGE_SIZE = 50

/** Cap on a CSV export so a wide date range cannot pull the whole table. */
export const AUDIT_EXPORT_LIMIT = 5000

const startOfDayIso = (date: string): string => `${date}T00:00:00.000Z`
const endOfDayIso = (date: string): string => `${date}T23:59:59.999Z`

async function fetchAuditLogs(
  filters: AuditLogFilters,
  limit: number,
  offset: number,
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.hospitalId) query = query.eq('hospital_id', filters.hospitalId)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.from) query = query.gte('created_at', startOfDayIso(filters.from))
  if (filters.to) query = query.lte('created_at', endOfDayIso(filters.to))
  if (filters.actorSearch?.trim()) {
    query = query.ilike('actor_email', `%${filters.actorSearch.trim()}%`)
  }

  const { data, error, count } = await query
  if (error) throw error

  const logs = (data ?? []) as AuditLog[]
  const actorIds = [
    ...new Set(logs.map((log) => log.actor_id).filter((id): id is string => Boolean(id))),
  ]

  let names = new Map<string, string>()
  if (actorIds.length > 0) {
    // A profile that has since been removed must not hide the trail it left.
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds)
    if (profiles) names = new Map(profiles.map((profile) => [profile.id, profile.full_name]))
  }

  return {
    rows: logs.map((log) => ({
      ...log,
      actor_name: log.actor_id ? (names.get(log.actor_id) ?? null) : null,
    })),
    total: count ?? logs.length,
  }
}

export function useAuditLogs(filters: AuditLogFilters): UseQueryResult<AuditLogPage> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = filters.pageSize ?? AUDIT_PAGE_SIZE

  return useQuery({
    queryKey: queryKeys.admin.auditLogs({ ...filters, page, pageSize }),
    // Keeping the previous page on screen stops the table collapsing to a
    // skeleton every time the administrator steps forward one page.
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const { rows, total } = await fetchAuditLogs(filters, pageSize, (page - 1) * pageSize)
      return {
        rows,
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      }
    },
  })
}

export async function fetchAuditLogsForExport(filters: AuditLogFilters): Promise<AuditLogEntry[]> {
  const { rows } = await fetchAuditLogs(filters, AUDIT_EXPORT_LIMIT, 0)
  return rows
}
