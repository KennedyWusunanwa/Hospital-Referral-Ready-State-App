/**
 * Application-level types. These narrow the raw database row types from
 * `database.types.ts` with the string-literal unions declared in `constants.ts`,
 * so feature code never has to hand-cast a `string` into a role or a status.
 */

import type {
  AgeBand,
  DepartmentTemplateKey,
  HospitalLevel,
  NotificationType,
  PatientSex,
  ReadinessStatus,
  ReferralOutcome,
  ReferralStatus,
  ResourceKey,
  ShiftType,
  UrgencyLevel,
  UserRole,
} from './constants'
import type { Json, ReferralCandidateRow, Tables } from './database.types'

export type { Json, ReferralCandidateRow } from './database.types'
export type {
  ComplianceRow,
  HospitalPerformanceRow,
  TablesInsert,
  TablesUpdate,
} from './database.types'

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export type Hospital = Omit<Tables<'hospitals'>, 'level'> & { level: HospitalLevel }

export type Department = Omit<Tables<'departments'>, 'template_key'> & {
  template_key: DepartmentTemplateKey
}

export type Profile = Omit<Tables<'profiles'>, 'role'> & { role: UserRole }

export type HospitalResources = Tables<'hospital_resources'>

export type BloodStock = Tables<'blood_stock'>

export type ReadinessUpdate = Omit<Tables<'readiness_updates'>, 'shift_type' | 'payload'> & {
  shift_type: ShiftType
  payload: ReadinessPayload
}

export type EmergencyType = Omit<Tables<'emergency_types'>, 'default_urgency'> & {
  default_urgency: UrgencyLevel
}

export type EmergencyRequirement = Omit<Tables<'emergency_requirements'>, 'resource_key'> & {
  resource_key: ResourceKey
}

export type Referral = Omit<
  Tables<'referrals'>,
  'status' | 'urgency' | 'patient_age_band' | 'patient_sex' | 'outcome' | 'required_resources'
> & {
  status: ReferralStatus
  urgency: UrgencyLevel
  patient_age_band: AgeBand
  patient_sex: PatientSex
  outcome: ReferralOutcome | null
  required_resources: ResourceKey[]
}

export type ReferralEvent = Tables<'referral_events'>

export type Message = Tables<'messages'>

export type AppNotification = Omit<Tables<'notifications'>, 'type'> & { type: NotificationType }

export type AuditLog = Tables<'audit_logs'>

// ---------------------------------------------------------------------------
// Composites returned by joined queries
// ---------------------------------------------------------------------------

/** A referral joined with the names it is always rendered alongside. */
export interface ReferralWithRelations extends Referral {
  requesting_hospital: Pick<
    Hospital,
    'id' | 'name' | 'code' | 'phone' | 'emergency_phone' | 'city' | 'region'
  > | null
  receiving_hospital: Pick<
    Hospital,
    'id' | 'name' | 'code' | 'phone' | 'emergency_phone' | 'city' | 'region'
  > | null
  emergency_type: Pick<EmergencyType, 'id' | 'name' | 'code' | 'category'> | null
  requested_by_profile: Pick<Profile, 'id' | 'full_name' | 'phone'> | null
  responded_by_profile: Pick<Profile, 'id' | 'full_name' | 'phone'> | null
}

export interface MessageWithSender extends Message {
  sender: Pick<Profile, 'id' | 'full_name' | 'role'> | null
}

/** Per-department readiness, with the derived traffic-light state attached. */
export interface DepartmentReadiness {
  department_id: string
  hospital_id: string
  department_name: string
  template_key: DepartmentTemplateKey
  requires_shift_update: boolean
  last_submitted_at: string | null
  last_shift_date: string | null
  last_shift_type: ShiftType | null
  last_submitted_by_name: string | null
  /** Derived client-side by `domain/readiness.ts`. */
  status: ReadinessStatus
  shifts_since_update: number
}

export interface HospitalReadinessSummary {
  hospital_id: string
  status: ReadinessStatus
  green: number
  yellow: number
  red: number
  total: number
  oldest_update_at: string | null
}

/** Payload persisted on each `readiness_updates` row. */
export interface ReadinessPayload {
  resources: Partial<Record<ResourceKey, number | boolean>>
  /** Capacity denominators for the count resources that track one. */
  totals?: Partial<Record<ResourceKey, number>>
  blood_stock?: Record<string, number>
  er_open?: boolean
  diversion_reason?: string | null
}

// ---------------------------------------------------------------------------
// Scoring output
// ---------------------------------------------------------------------------

export interface ResourceScoreDetail {
  key: ResourceKey
  label: string
  weight: number
  /** Normalised availability, 0..1. */
  availability: number
  /** Raw reported value, for display. */
  value: number | boolean
  /** Denominator where the resource tracks capacity. */
  capacity?: number | null
  isCritical: boolean
  /** True when a critical requirement is not met. */
  blocking: boolean
}

export interface ScoredHospital {
  hospital: ReferralCandidateRow
  /** Final 0-100 percentage used for ranking. */
  score: number
  /** 0-100 resource sub-score before weighting. */
  resourceScore: number
  /** 0-100 proximity sub-score before weighting. */
  proximityScore: number
  /** Percentage points removed by the readiness staleness penalty. */
  penaltyApplied: number
  readiness: ReadinessStatus
  shiftsSinceUpdate: number
  distanceKm: number
  roadDistanceKm: number
  etaMinutes: number
  breakdown: ResourceScoreDetail[]
  /** Non-empty when the hospital cannot receive this case at all. */
  exclusions: string[]
  eligible: boolean
  /** Historical acceptance rate 0..1, used for tie-breaking only. */
  historicalAcceptanceRate: number | null
  rank: number
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface ReferralAnalytics {
  total: number
  by_status: Record<string, number>
  by_urgency: Record<string, number>
  by_emergency_type: Array<{ code: string; name: string; count: number }>
  acceptance_rate: number
  avg_response_seconds: number | null
  median_response_seconds: number | null
  avg_completion_minutes: number | null
  daily: Array<{ day: string; created: number; accepted: number; completed: number }>
  top_receiving: Array<{ hospital_id: string; name: string; count: number }>
  top_referring: Array<{ hospital_id: string; name: string; count: number }>
}

export function isReferralAnalytics(value: Json): value is Json & ReferralAnalytics {
  return typeof value === 'object' && value !== null && 'total' in value
}
