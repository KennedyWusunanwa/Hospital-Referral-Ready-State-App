/**
 * Readiness data access.
 *
 * The traffic light is as much a function of the wall clock as of the data: a
 * department that was green at 14:59 is yellow at 15:01 without anything having
 * been written to the database. So the status is never read from a column -- it
 * is derived on every tick from `now` and the hospital's own timezone, and the
 * queries poll on the same cadence to pick up other people's submissions.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { humanizeSupabaseError, supabase } from '@/lib/supabase'
import { DEFAULT_TIMEZONE, type DepartmentTemplateKey, type ShiftType } from '@/lib/constants'
import type { Json, Tables, Views } from '@/lib/database.types'
import type {
  BloodStock,
  Department,
  DepartmentReadiness,
  HospitalReadinessSummary,
  HospitalResources,
  ReadinessPayload,
  ReadinessUpdate,
} from '@/lib/types'
import { getShiftAt, shiftsSince } from '@/domain/shifts'
import { statusFromShiftsElapsed, summariseHospitalReadiness } from '@/domain/readiness'

/** How often the clock-driven status is re-derived and the server re-polled. */
export const READINESS_TICK_MS = 60_000

/**
 * A `now` that advances on its own, so a board left open on a ward screen turns
 * yellow at the shift boundary instead of lying until somebody reloads it.
 */
export function useNowTick(intervalMs: number = READINESS_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])

  return now
}

function fail(error: unknown): never {
  throw new Error(humanizeSupabaseError(error))
}

async function fetchTimezone(hospitalId: string): Promise<string> {
  const { data, error } = await supabase
    .from('hospitals')
    .select('timezone')
    .eq('id', hospitalId)
    .maybeSingle()
  if (error) fail(error)
  return data?.timezone || DEFAULT_TIMEZONE
}

function toDepartment(row: Tables<'departments'>): Department {
  return { ...row, template_key: row.template_key as DepartmentTemplateKey }
}

function toReadinessUpdate(row: Tables<'readiness_updates'>): ReadinessUpdate {
  return {
    ...row,
    shift_type: row.shift_type as ShiftType,
    payload: (row.payload ?? { resources: {} }) as unknown as ReadinessPayload,
  }
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export function useDepartments(hospitalId: string | null): UseQueryResult<Department[]> {
  return useQuery({
    queryKey: queryKeys.departments.byHospital(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('hospital_id', hospitalId as string)
        .eq('is_active', true)
        .order('name')
      if (error) fail(error)
      return (data ?? []).map(toDepartment)
    },
  })
}

/** Single-department lookup -- the update form is routed by department id. */
export function useDepartment(departmentId: string | null): UseQueryResult<Department | null> {
  return useQuery({
    queryKey: queryKeys.departments.detail(departmentId ?? 'none'),
    enabled: Boolean(departmentId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('id', departmentId as string)
        .maybeSingle()
      if (error) fail(error)
      return data ? toDepartment(data) : null
    },
  })
}

// ---------------------------------------------------------------------------
// Readiness board
// ---------------------------------------------------------------------------

interface RawReadiness {
  timezone: string
  rows: Array<Views<'department_readiness'>>
}

function decorate(
  row: Views<'department_readiness'>,
  now: Date,
  timeZone: string,
): DepartmentReadiness {
  const elapsed = shiftsSince(row.last_submitted_at, now, timeZone)
  return {
    department_id: row.department_id,
    hospital_id: row.hospital_id,
    department_name: row.department_name,
    template_key: row.template_key as DepartmentTemplateKey,
    requires_shift_update: row.requires_shift_update,
    last_submitted_at: row.last_submitted_at,
    last_shift_date: row.last_shift_date,
    last_shift_type: row.last_shift_type as ShiftType | null,
    last_submitted_by_name: row.last_submitted_by_name,
    status: statusFromShiftsElapsed(elapsed),
    shifts_since_update: elapsed,
  }
}

/**
 * Both readiness hooks share the raw fetch, so a page that renders the board
 * and the roll-up side by side still hits the network once.
 */
function readinessQueryOptions(hospitalId: string | null) {
  return {
    queryKey: queryKeys.departments.readiness(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    refetchInterval: READINESS_TICK_MS,
    staleTime: 30_000,
    queryFn: async (): Promise<RawReadiness> => {
      const id = hospitalId as string
      const [timezone, result] = await Promise.all([
        fetchTimezone(id),
        supabase
          .from('department_readiness')
          .select('*')
          .eq('hospital_id', id)
          .order('department_name'),
      ])
      if (result.error) fail(result.error)
      return { timezone, rows: result.data ?? [] }
    },
  }
}

export function useDepartmentReadiness(
  hospitalId: string | null,
): UseQueryResult<DepartmentReadiness[]> {
  const now = useNowTick()

  const select = useCallback(
    (raw: RawReadiness) => raw.rows.map((row) => decorate(row, now, raw.timezone)),
    [now],
  )

  return useQuery({ ...readinessQueryOptions(hospitalId), select })
}

export function useHospitalReadiness(
  hospitalId: string | null,
): UseQueryResult<HospitalReadinessSummary> {
  const now = useNowTick()

  const select = useCallback(
    (raw: RawReadiness) =>
      summariseHospitalReadiness(
        raw.rows.map((row) => decorate(row, now, raw.timezone)),
        hospitalId ?? '',
      ),
    [now, hospitalId],
  )

  return useQuery({ ...readinessQueryOptions(hospitalId), select })
}

// ---------------------------------------------------------------------------
// Current resource state
// ---------------------------------------------------------------------------

export function useHospitalResources(
  hospitalId: string | null,
): UseQueryResult<HospitalResources | null> {
  return useQuery({
    queryKey: queryKeys.hospitals.resources(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hospital_resources')
        .select('*')
        .eq('hospital_id', hospitalId as string)
        .maybeSingle()
      if (error) fail(error)
      return data ?? null
    },
  })
}

export function useBloodStock(hospitalId: string | null): UseQueryResult<BloodStock[]> {
  return useQuery({
    queryKey: queryKeys.hospitals.bloodStock(hospitalId ?? 'none'),
    enabled: Boolean(hospitalId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blood_stock')
        .select('*')
        .eq('hospital_id', hospitalId as string)
        .order('blood_group')
      if (error) fail(error)
      return data ?? []
    },
  })
}

// ---------------------------------------------------------------------------
// Submission history
// ---------------------------------------------------------------------------

export function useReadinessHistory(
  departmentId: string | null,
  days: number,
): UseQueryResult<ReadinessUpdate[]> {
  return useQuery({
    queryKey: queryKeys.readiness.history(departmentId ?? 'none', days),
    enabled: Boolean(departmentId),
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('readiness_updates')
        .select('*')
        .eq('department_id', departmentId as string)
        .gte('submitted_at', since)
        .order('submitted_at', { ascending: false })
        .limit(60)
      if (error) fail(error)
      return (data ?? []).map(toReadinessUpdate)
    },
  })
}

/**
 * Has this department already reported for the shift running right now?
 *
 * Polls on the tick, so the answer flips back to "no" the moment a new shift
 * opens -- which is what turns the form's call to action from "update this
 * shift" back into a fresh submission.
 */
export function useCurrentShiftUpdate(
  departmentId: string | null,
): UseQueryResult<ReadinessUpdate | null> {
  return useQuery({
    queryKey: queryKeys.readiness.currentShift(departmentId ?? 'none'),
    enabled: Boolean(departmentId),
    refetchInterval: READINESS_TICK_MS,
    staleTime: 30_000,
    queryFn: async () => {
      const id = departmentId as string

      const { data: department, error: departmentError } = await supabase
        .from('departments')
        .select('hospital_id')
        .eq('id', id)
        .maybeSingle()
      if (departmentError) fail(departmentError)
      if (!department) return null

      const shift = getShiftAt(new Date(), await fetchTimezone(department.hospital_id))

      const { data, error } = await supabase
        .from('readiness_updates')
        .select('*')
        .eq('department_id', id)
        .eq('shift_date', shift.shiftDate)
        .eq('shift_type', shift.shiftType)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) fail(error)
      return data ? toReadinessUpdate(data) : null
    },
  })
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitReadinessInput {
  departmentId: string
  payload: ReadinessPayload
  notes?: string
}

export function useSubmitReadiness(): UseMutationResult<unknown, Error, SubmitReadinessInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ departmentId, payload, notes }: SubmitReadinessInput) => {
      const { data, error } = await supabase.rpc('submit_readiness', {
        p_department_id: departmentId,
        p_payload: payload as unknown as Json,
        p_blood_stock: (payload.blood_stock ?? null) as unknown as Json,
        p_notes: notes?.trim() ? notes.trim() : null,
      })
      if (error) fail(error)
      return data
    },
    onSuccess: () => {
      // One submission moves the department light, the hospital roll-up and the
      // resource snapshot the referral scorer reads, so refresh all three.
      void queryClient.invalidateQueries({ queryKey: queryKeys.departments.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.readiness.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.hospitals.all })
    },
  })
}
