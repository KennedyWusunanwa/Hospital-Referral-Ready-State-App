/**
 * Referral scoring.
 *
 * From the project plan:
 *
 *   Score = (Resource Availability Weight * 70%) + (Proximity Weight * 30%)
 *   - Each resource gets a weighted score based on availability.
 *   - Proximity is scored inversely (closer hospitals score higher).
 *   - Hospitals with missing updates (Yellow/Red) get a penalty deduction.
 *   - Ties are broken on historical success rate.
 *
 * This module is the single authority for that calculation. It is pure: given
 * the same candidates, requirements, config and `now`, it always produces the
 * same ranking. The result is snapshotted onto the referral row when a request
 * is raised, so a decision can always be re-explained after the fact even once
 * the underlying readiness data has moved on.
 */

import {
  DEFAULT_SCORING_CONFIG,
  RESOURCES,
  type ReadinessStatus,
  type ResourceKey,
  type ScoringConfig,
  type UrgencyLevel,
} from '@/lib/constants'
import type {
  EmergencyRequirement,
  ReferralCandidateRow,
  ResourceScoreDetail,
  ScoredHospital,
} from '@/lib/types'
import { clamp, estimateEtaMinutes, proximityScore, roadDistanceKm } from './geo'
import { statusFromShiftsElapsed } from './readiness'
import { shiftsSince } from './shifts'

/**
 * Applied when an emergency type has no configured requirements, so that a
 * misconfigured catalogue degrades to "can this place take a patient at all?"
 * rather than scoring every hospital identically at zero.
 */
export const FALLBACK_REQUIREMENTS: ReadonlyArray<
  Pick<EmergencyRequirement, 'resource_key' | 'weight' | 'is_critical' | 'min_quantity'>
> = [
  { resource_key: 'general_bed', weight: 3, is_critical: false, min_quantity: 1 },
  { resource_key: 'oxygen', weight: 2, is_critical: false, min_quantity: 20 },
  { resource_key: 'power_backup', weight: 1, is_critical: false, min_quantity: 1 },
]

export interface RankingInput {
  candidates: ReferralCandidateRow[]
  /** Requirements configured for the chosen emergency type. */
  requirements: Array<
    Pick<EmergencyRequirement, 'resource_key' | 'weight' | 'is_critical' | 'min_quantity'>
  >
  /** Extra must-haves ticked by the coordinator; treated as critical. */
  additionalRequired?: ResourceKey[]
  urgency: UrgencyLevel
  config?: Partial<ScoringConfig>
  /** Excluded from the ranking -- you cannot refer a patient to yourself. */
  originHospitalId?: string
  now?: Date
}

export interface NormalisedRequirement {
  key: ResourceKey
  weight: number
  isCritical: boolean
  minQuantity: number
}

// ---------------------------------------------------------------------------
// Requirement normalisation
// ---------------------------------------------------------------------------

function normaliseRequirements(input: RankingInput): NormalisedRequirement[] {
  const source = input.requirements.length > 0 ? input.requirements : FALLBACK_REQUIREMENTS

  const byKey = new Map<ResourceKey, NormalisedRequirement>()

  for (const requirement of source) {
    const key = requirement.resource_key as ResourceKey
    if (!RESOURCES[key]) continue // tolerate a stale row pointing at a retired resource
    const weight = Number.isFinite(requirement.weight) ? Math.max(0, requirement.weight) : 1
    if (weight === 0 && !requirement.is_critical) continue
    byKey.set(key, {
      key,
      weight,
      isCritical: Boolean(requirement.is_critical),
      minQuantity: Math.max(0, requirement.min_quantity ?? 0),
    })
  }

  // Coordinator-selected extras are hard requirements: the patient needs them.
  for (const key of input.additionalRequired ?? []) {
    if (!RESOURCES[key]) continue
    const existing = byKey.get(key)
    byKey.set(key, {
      key,
      weight: Math.max(existing?.weight ?? 0, 2),
      isCritical: true,
      // One unit is the smallest quantity that counts as "actually present",
      // for every resource kind.
      minQuantity: Math.max(existing?.minQuantity ?? 0, 1),
    })
  }

  return [...byKey.values()]
}

// ---------------------------------------------------------------------------
// Per-resource availability
// ---------------------------------------------------------------------------

function readRaw(candidate: ReferralCandidateRow, key: ResourceKey): number | boolean {
  const column = RESOURCES[key].column as keyof ReferralCandidateRow
  const value = candidate[column]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return RESOURCES[key].kind === 'boolean' ? false : 0
}

function readCapacity(candidate: ReferralCandidateRow, key: ResourceKey): number | null {
  const totalColumn = RESOURCES[key].totalColumn as keyof ReferralCandidateRow | undefined
  if (!totalColumn) return null
  const value = candidate[totalColumn]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Normalise a reported value to 0..1.
 *
 * Counts saturate: two free ICU beds is "available"; twenty is not four times
 * more available for the purposes of placing one patient. The saturation point
 * is the larger of the resource's own default and the requirement's minimum.
 */
export function availabilityOf(
  candidate: ReferralCandidateRow,
  requirement: NormalisedRequirement,
): { availability: number; value: number | boolean; capacity: number | null; meetsMinimum: boolean } {
  const definition = RESOURCES[requirement.key]
  const value = readRaw(candidate, requirement.key)
  const capacity = readCapacity(candidate, requirement.key)

  if (definition.kind === 'boolean') {
    const present = value === true
    return { availability: present ? 1 : 0, value, capacity, meetsMinimum: present }
  }

  const numeric = typeof value === 'number' ? value : 0

  if (definition.kind === 'percent') {
    const availability = clamp(numeric / 100, 0, 1)
    const threshold = requirement.minQuantity > 0 ? requirement.minQuantity : 1
    return { availability, value: numeric, capacity, meetsMinimum: numeric >= threshold }
  }

  const saturation = Math.max(1, definition.saturationQuantity ?? 1, requirement.minQuantity)
  const availability = clamp(numeric / saturation, 0, 1)
  const threshold = Math.max(1, requirement.minQuantity)
  return { availability, value: numeric, capacity, meetsMinimum: numeric >= threshold }
}

// ---------------------------------------------------------------------------
// Readiness of a candidate
// ---------------------------------------------------------------------------

/**
 * A candidate's readiness comes from the *oldest* department that owes an
 * update -- the same worst-of roll-up the dashboard shows -- falling back to
 * the resource row's own timestamp when department data is unavailable.
 */
export function candidateReadiness(
  candidate: ReferralCandidateRow,
  now: Date,
): { status: ReadinessStatus; shiftsElapsed: number } {
  const reference =
    candidate.departments_total > 0
      ? candidate.oldest_department_update_at
      : candidate.resources_updated_at

  const shiftsElapsed = shiftsSince(reference, now, candidate.timezone)

  // A hospital that has configured departments but has some that have never
  // reported cannot be green, whatever the oldest timestamp says.
  const missingReports = candidate.departments_total - candidate.departments_reporting
  if (missingReports > 0) {
    return { status: 'red', shiftsElapsed: Math.max(shiftsElapsed, 3) }
  }

  return { status: statusFromShiftsElapsed(shiftsElapsed), shiftsElapsed }
}

function penaltyFor(status: ReadinessStatus, config: ScoringConfig): number {
  if (status === 'yellow') return clamp(config.yellowPenalty, 0, 1)
  if (status === 'red') return clamp(config.redPenalty, 0, 1)
  return 0
}

// ---------------------------------------------------------------------------
// Scoring a single candidate
// ---------------------------------------------------------------------------

export function scoreCandidate(
  candidate: ReferralCandidateRow,
  requirements: NormalisedRequirement[],
  input: Required<Pick<RankingInput, 'urgency'>> & {
    config: ScoringConfig
    now: Date
    originHospitalId?: string
  },
): ScoredHospital {
  const { config, now, urgency } = input

  const breakdown: ResourceScoreDetail[] = []
  const exclusions: string[] = []

  let weightedSum = 0
  let totalWeight = 0

  for (const requirement of requirements) {
    const definition = RESOURCES[requirement.key]
    const { availability, value, capacity, meetsMinimum } = availabilityOf(candidate, requirement)
    const blocking = requirement.isCritical && !meetsMinimum

    weightedSum += availability * requirement.weight
    totalWeight += requirement.weight

    breakdown.push({
      key: requirement.key,
      label: definition.label,
      weight: requirement.weight,
      availability,
      value,
      capacity,
      isCritical: requirement.isCritical,
      blocking,
    })

    if (blocking) exclusions.push(`No ${definition.label.toLowerCase()}`)
  }

  const resourceScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0

  const distanceKm = Number.isFinite(candidate.distance_km) ? candidate.distance_km : Infinity
  const roadKm = roadDistanceKm(distanceKm, config.roadDistanceFactor)
  const etaMinutes = estimateEtaMinutes(distanceKm, urgency, config)
  const proximity = proximityScore(etaMinutes, config.maxEtaMinutes)

  const { status: readiness, shiftsElapsed } = candidateReadiness(candidate, now)

  const base = resourceScore * config.resourceWeight + proximity * config.proximityWeight
  const penaltyRate = penaltyFor(readiness, config)
  const score = clamp(base * (1 - penaltyRate), 0, 100)

  // --- eligibility gates -------------------------------------------------
  if (input.originHospitalId && candidate.hospital_id === input.originHospitalId) {
    exclusions.push('Referring facility')
  }
  if (!candidate.accepts_referrals) {
    exclusions.push('Not accepting referrals')
  }
  if (config.excludeHospitalsOnDiversion && !candidate.er_open) {
    exclusions.push(
      candidate.diversion_reason ? `On diversion: ${candidate.diversion_reason}` : 'On diversion',
    )
  }
  if (config.excludeRedHospitals && readiness === 'red') {
    exclusions.push('Readiness data stale')
  }
  if (distanceKm > config.maxDistanceKm) {
    exclusions.push(`Beyond ${config.maxDistanceKm} km search radius`)
  }

  const historicalAcceptanceRate =
    candidate.referrals_received > 0
      ? candidate.referrals_accepted / candidate.referrals_received
      : null

  return {
    hospital: candidate,
    score: round1(score),
    resourceScore: round1(resourceScore),
    proximityScore: round1(proximity),
    penaltyApplied: round1(base - score),
    readiness,
    shiftsSinceUpdate: Number.isFinite(shiftsElapsed) ? shiftsElapsed : -1,
    distanceKm: Number.isFinite(distanceKm) ? round1(distanceKm) : -1,
    roadDistanceKm: Number.isFinite(roadKm) ? round1(roadKm) : -1,
    etaMinutes: Number.isFinite(etaMinutes) ? Math.round(etaMinutes) : -1,
    breakdown,
    exclusions,
    eligible: exclusions.length === 0,
    historicalAcceptanceRate,
    rank: 0,
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank every candidate. Ineligible hospitals are still returned -- a
 * coordinator needs to see *why* the nearest trauma centre was skipped -- but
 * they always sort below every eligible option and are never auto-selected.
 */
export function rankHospitals(input: RankingInput): ScoredHospital[] {
  const config: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, ...(input.config ?? {}) }
  const now = input.now ?? new Date()
  const requirements = normaliseRequirements(input)

  const scored = input.candidates.map((candidate) =>
    scoreCandidate(candidate, requirements, {
      config,
      now,
      urgency: input.urgency,
      originHospitalId: input.originHospitalId,
    }),
  )

  scored.sort((a, b) => compareCandidates(a, b, config.tieBreakEpsilon))
  scored.forEach((entry, index) => {
    entry.rank = index + 1
  })

  return scored
}

/**
 * Ordering rules, in priority order:
 *  1. eligible before ineligible
 *  2. higher score
 *  3. (ties within `epsilon`) higher historical acceptance rate
 *  4. faster historical response
 *  5. closer
 *  6. name, so the order is stable
 */
export function compareCandidates(
  a: ScoredHospital,
  b: ScoredHospital,
  epsilon: number = DEFAULT_SCORING_CONFIG.tieBreakEpsilon,
): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1

  const scoreDelta = b.score - a.score
  if (Math.abs(scoreDelta) > epsilon) return scoreDelta

  const aRate = a.historicalAcceptanceRate
  const bRate = b.historicalAcceptanceRate
  if (aRate !== null && bRate !== null && aRate !== bRate) return bRate - aRate
  if (aRate !== null && bRate === null) return -1
  if (aRate === null && bRate !== null) return 1

  const aResponse = a.hospital.avg_response_seconds
  const bResponse = b.hospital.avg_response_seconds
  if (aResponse !== null && bResponse !== null && aResponse !== bResponse) {
    return aResponse - bResponse
  }

  if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm

  return a.hospital.name.localeCompare(b.hospital.name)
}

// ---------------------------------------------------------------------------
// Snapshotting
// ---------------------------------------------------------------------------

export interface ScoreSnapshot {
  version: 1
  scored_at: string
  urgency: UrgencyLevel
  config: ScoringConfig
  requirements: Array<{ key: ResourceKey; weight: number; critical: boolean; min: number }>
  selected: {
    hospital_id: string
    score: number
    resource_score: number
    proximity_score: number
    penalty: number
    readiness: ReadinessStatus
    distance_km: number
    eta_minutes: number
    rank: number
    breakdown: ResourceScoreDetail[]
  }
}

/** The audit record explaining why this hospital was chosen. */
export function buildScoreSnapshot(
  selected: ScoredHospital,
  input: RankingInput,
  scoredAt: Date,
): ScoreSnapshot {
  const config: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, ...(input.config ?? {}) }
  return {
    version: 1,
    scored_at: scoredAt.toISOString(),
    urgency: input.urgency,
    config,
    requirements: normaliseRequirements(input).map((r) => ({
      key: r.key,
      weight: r.weight,
      critical: r.isCritical,
      min: r.minQuantity,
    })),
    selected: {
      hospital_id: selected.hospital.hospital_id,
      score: selected.score,
      resource_score: selected.resourceScore,
      proximity_score: selected.proximityScore,
      penalty: selected.penaltyApplied,
      readiness: selected.readiness,
      distance_km: selected.distanceKm,
      eta_minutes: selected.etaMinutes,
      rank: selected.rank,
      breakdown: selected.breakdown,
    },
  }
}

/** A compact record of the alternatives that were on the table. */
export function buildCandidateSnapshot(
  ranked: ScoredHospital[],
  limit = 10,
): Array<{
  hospital_id: string
  name: string
  score: number
  readiness: ReadinessStatus
  distance_km: number
  eta_minutes: number
  eligible: boolean
  exclusions: string[]
  rank: number
}> {
  return ranked.slice(0, limit).map((entry) => ({
    hospital_id: entry.hospital.hospital_id,
    name: entry.hospital.name,
    score: entry.score,
    readiness: entry.readiness,
    distance_km: entry.distanceKm,
    eta_minutes: entry.etaMinutes,
    eligible: entry.eligible,
    exclusions: entry.exclusions,
    rank: entry.rank,
  }))
}

// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Presentation band for a score, used for colour coding in the UI. */
export function scoreBand(score: number): 'strong' | 'moderate' | 'weak' {
  if (score >= 70) return 'strong'
  if (score >= 45) return 'moderate'
  return 'weak'
}
