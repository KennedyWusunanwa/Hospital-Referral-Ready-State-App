/**
 * Referral data layer: reads, RPC-backed writes and the realtime subscription
 * that makes an incoming referral appear on the list without a refresh.
 */

import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { DEFAULT_SCORING_CONFIG } from '@/lib/constants'
import type {
  AgeBand,
  PatientSex,
  ReferralOutcome,
  ReferralStatus,
  ResourceKey,
  ScoringConfig,
  UrgencyLevel,
} from '@/lib/constants'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import type {
  EmergencyRequirement,
  EmergencyType,
  Json,
  Referral,
  ReferralCandidateRow,
  ReferralEvent,
  ReferralWithRelations,
} from '@/lib/types'

/**
 * Typed as a plain `string` on purpose. PostgREST's select-string type parser
 * resolves embedded resources through the `Relationships` metadata, which the
 * hand-written `database.types.ts` mirror leaves empty; feeding it the aliased
 * `!fk` syntax produces an unusable result type. `.returns<T>()` supplies the
 * shape instead, and `ReferralWithRelations` is the contract this must match.
 */
const REFERRAL_SELECT: string = `
  *,
  requesting_hospital:hospitals!referrals_requesting_hospital_id_fkey (
    id, name, code, phone, emergency_phone, city, region
  ),
  receiving_hospital:hospitals!referrals_receiving_hospital_id_fkey (
    id, name, code, phone, emergency_phone, city, region
  ),
  emergency_type:emergency_types!referrals_emergency_type_id_fkey (
    id, name, code, category
  ),
  requested_by_profile:profiles!referrals_requested_by_fkey (
    id, full_name, phone
  ),
  responded_by_profile:profiles!referrals_responded_by_fkey (
    id, full_name, phone
  )
`

function fail(error: unknown): never {
  throw new Error(humanizeSupabaseError(error))
}

type JsonObject = { [key: string]: Json | undefined }

/** RPCs and snapshot columns are `Json`; narrow before reading fields off them. */
function asJsonObject(value: Json | null | undefined): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value
}

// ---------------------------------------------------------------------------
// Emergency types & requirements
// ---------------------------------------------------------------------------

export function useEmergencyTypes(): UseQueryResult<EmergencyType[]> {
  return useQuery({
    queryKey: queryKeys.emergencyTypes.all,
    // Reference data: rarely edited, and every referral screen needs it.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .returns<EmergencyType[]>()
      if (error) fail(error)
      return data ?? []
    },
  })
}

export function useEmergencyRequirements(
  emergencyTypeId: string | null,
): UseQueryResult<EmergencyRequirement[]> {
  return useQuery({
    queryKey: queryKeys.emergencyTypes.requirements(emergencyTypeId ?? 'none'),
    enabled: Boolean(emergencyTypeId),
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_requirements')
        .select('*')
        .eq('emergency_type_id', emergencyTypeId ?? '')
        .order('is_critical', { ascending: false })
        .order('weight', { ascending: false })
        .returns<EmergencyRequirement[]>()
      if (error) fail(error)
      return data ?? []
    },
  })
}

// ---------------------------------------------------------------------------
// Scoring configuration
// ---------------------------------------------------------------------------

export function useScoringConfig(): UseQueryResult<ScoringConfig> {
  return useQuery({
    queryKey: queryKeys.admin.scoringConfig,
    staleTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scoring_config')
        .select('*')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) fail(error)
      // A fresh deployment may not have seeded the singleton row yet; the
      // spec defaults (70/30 with staleness penalties) are the right fallback.
      if (!data) return DEFAULT_SCORING_CONFIG

      return {
        resourceWeight: data.resource_weight,
        proximityWeight: data.proximity_weight,
        yellowPenalty: data.yellow_penalty,
        redPenalty: data.red_penalty,
        maxEtaMinutes: data.max_eta_minutes,
        maxDistanceKm: data.max_distance_km,
        roadDistanceFactor: data.road_distance_factor,
        fixedTransportOverheadMinutes: data.fixed_transport_overhead_minutes,
        tieBreakEpsilon: data.tie_break_epsilon,
        excludeRedHospitals: data.exclude_red_hospitals,
        excludeHospitalsOnDiversion: data.exclude_hospitals_on_diversion,
      } satisfies ScoringConfig
    },
  })
}

// ---------------------------------------------------------------------------
// Candidate ranking source
// ---------------------------------------------------------------------------

export function useReferralCandidates(params: {
  originHospitalId: string | null
  emergencyTypeId: string | null
  maxKm?: number
}): UseQueryResult<ReferralCandidateRow[]> {
  const { originHospitalId, emergencyTypeId, maxKm } = params
  return useQuery({
    queryKey: queryKeys.referrals.candidates({
      originHospitalId,
      emergencyTypeId,
      maxKm: maxKm ?? DEFAULT_SCORING_CONFIG.maxDistanceKm,
    }),
    enabled: Boolean(originHospitalId && emergencyTypeId),
    // Resource availability moves shift by shift; keep it warm but not stale.
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_referral_candidates', {
        p_origin_hospital_id: originHospitalId ?? '',
        p_emergency_type_id: emergencyTypeId ?? '',
        p_max_km: maxKm ?? DEFAULT_SCORING_CONFIG.maxDistanceKm,
      })
      if (error) fail(error)
      return (data ?? []) as ReferralCandidateRow[]
    },
  })
}

// ---------------------------------------------------------------------------
// Referral lists and detail
// ---------------------------------------------------------------------------

export interface ReferralFilters {
  hospitalId?: string | null
  direction?: 'incoming' | 'outgoing' | 'all'
  status?: ReferralStatus[]
  /** ISO timestamp, inclusive lower bound on `requested_at`. */
  from?: string
  /** ISO timestamp, inclusive upper bound on `requested_at`. */
  to?: string
}

export function useReferrals(filters: ReferralFilters): UseQueryResult<ReferralWithRelations[]> {
  const { hospitalId, direction = 'all', status, from, to } = filters

  return useQuery({
    queryKey: queryKeys.referrals.list({
      hospitalId: hospitalId ?? null,
      direction,
      status: status ?? null,
      from: from ?? null,
      to: to ?? null,
    }),
    staleTime: 15 * 1000,
    queryFn: async () => {
      let query = supabase.from('referrals').select(REFERRAL_SELECT)

      if (hospitalId) {
        if (direction === 'incoming') {
          query = query.eq('receiving_hospital_id', hospitalId)
        } else if (direction === 'outgoing') {
          query = query.eq('requesting_hospital_id', hospitalId)
        } else {
          query = query.or(
            `requesting_hospital_id.eq.${hospitalId},receiving_hospital_id.eq.${hospitalId}`,
          )
        }
      }

      if (status && status.length > 0) query = query.in('status', status)
      if (from) query = query.gte('requested_at', from)
      if (to) query = query.lte('requested_at', to)

      const { data, error } = await query
        .order('requested_at', { ascending: false })
        .limit(500)
        .returns<ReferralWithRelations[]>()
      if (error) fail(error)
      return data ?? []
    },
  })
}

export function useReferral(referralId: string | null): UseQueryResult<ReferralWithRelations | null> {
  return useQuery({
    queryKey: queryKeys.referrals.detail(referralId ?? 'none'),
    enabled: Boolean(referralId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referrals')
        .select(REFERRAL_SELECT)
        .eq('id', referralId ?? '')
        .returns<ReferralWithRelations[]>()
        .maybeSingle()
      if (error) fail(error)
      return data ?? null
    },
  })
}

export function useReferralEvents(referralId: string | null): UseQueryResult<ReferralEvent[]> {
  return useQuery({
    queryKey: queryKeys.referrals.events(referralId ?? 'none'),
    enabled: Boolean(referralId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_events')
        .select('*')
        .eq('referral_id', referralId ?? '')
        .order('created_at', { ascending: true })
        .returns<ReferralEvent[]>()
      if (error) fail(error)
      return data ?? []
    },
  })
}

/** Drives the sidebar badge, so it polls rather than waiting for a navigation. */
export function usePendingReferralCount(hospitalId: string | null): UseQueryResult<number> {
  return useQuery({
    queryKey: queryKeys.referrals.inbox(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('receiving_hospital_id', hospitalId ?? '')
        .eq('status', 'pending')
      if (error) fail(error)
      return count ?? 0
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateReferralInput {
  receivingHospitalId: string
  emergencyTypeId: string
  urgency: UrgencyLevel
  /** Non-identifying reference, e.g. from `generatePatientRef()`. Never a name. */
  patientRef: string
  patientAgeBand: AgeBand
  patientSex: PatientSex
  clinicalSummary: string
  requiredResources: ResourceKey[]
  /** Output of `buildScoreSnapshot` -- the audit trail for the ranking. */
  scoreSnapshot: Json
  /** Output of `buildCandidateSnapshot` -- the alternatives considered. */
  candidateSnapshot: Json
  distanceKm: number | null
  etaMinutes: number | null
}

export function useCreateReferral(): UseMutationResult<
  { id: string; reference_number: string },
  Error,
  CreateReferralInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateReferralInput) => {
      const { data, error } = await supabase.rpc('create_referral', {
        p_receiving_hospital_id: input.receivingHospitalId,
        p_emergency_type_id: input.emergencyTypeId,
        p_urgency: input.urgency,
        p_patient_ref: input.patientRef,
        p_patient_age_band: input.patientAgeBand,
        p_patient_sex: input.patientSex,
        p_clinical_summary: input.clinicalSummary,
        p_required_resources: input.requiredResources,
        p_score_snapshot: input.scoreSnapshot,
        p_candidate_snapshot: input.candidateSnapshot,
        p_distance_km: input.distanceKm,
        p_eta_minutes: input.etaMinutes,
      })
      if (error) fail(error)

      const row = asJsonObject(data)
      const id = row?.id
      const reference = row?.reference_number
      if (typeof id !== 'string' || typeof reference !== 'string') {
        throw new Error('The referral was not created. Please try again.')
      }
      return { id, reference_number: reference }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    },
  })
}

export function useUpdateReferralStatus(): UseMutationResult<
  unknown,
  Error,
  { referralId: string; status: ReferralStatus; notes?: string; outcome?: ReferralOutcome }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      referralId,
      status,
      notes,
      outcome,
    }: {
      referralId: string
      status: ReferralStatus
      notes?: string
      outcome?: ReferralOutcome
    }) => {
      const { data, error } = await supabase.rpc('update_referral_status', {
        p_referral_id: referralId,
        p_status: status,
        p_notes: notes ?? null,
        p_outcome: outcome ?? null,
      })
      if (error) fail(error)
      return data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.referrals.detail(variables.referralId),
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/**
 * Keeps the referral lists live for one hospital. Postgres changes filters
 * accept a single predicate, so incoming and outgoing get a binding each on
 * the same channel.
 */
export function useReferralRealtime(hospitalId: string | null): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!hospitalId) return

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.referrals.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all })
    }

    const channel = supabase
      .channel(`referrals:${hospitalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'referrals',
          filter: `receiving_hospital_id=eq.${hospitalId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'referrals',
          filter: `requesting_hospital_id=eq.${hospitalId}`,
        },
        invalidate,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hospitalId, queryClient])
}

// ---------------------------------------------------------------------------
// Snapshot readers
// ---------------------------------------------------------------------------

/** The 0-100 match score recorded when this referral was raised, if any. */
export function referralScore(referral: Pick<Referral, 'score_snapshot'>): number | null {
  const selected = asJsonObject(asJsonObject(referral.score_snapshot)?.selected)
  const score = selected?.score
  return typeof score === 'number' && Number.isFinite(score) ? score : null
}
