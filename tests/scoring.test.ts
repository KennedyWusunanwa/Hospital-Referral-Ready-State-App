import { describe, expect, it } from 'vitest'
import { DEFAULT_SCORING_CONFIG, type ResourceKey } from '@/lib/constants'
import type { EmergencyRequirement, ReferralCandidateRow, ScoredHospital } from '@/lib/types'
import {
  FALLBACK_REQUIREMENTS,
  availabilityOf,
  buildCandidateSnapshot,
  buildScoreSnapshot,
  candidateReadiness,
  compareCandidates,
  rankHospitals,
  scoreBand,
  type RankingInput,
} from '@/domain/scoring'

/**
 * A fixed "now" so nothing in this file depends on the wall clock:
 * 10:00 in Africa/Accra (UTC+0) is the morning shift of 2025-06-15.
 */
const NOW = new Date('2025-06-15T10:00:00Z')

/** Timestamps landing in the current shift / 1 shift back / 3 shifts back. */
const FRESH = '2025-06-15T08:00:00Z'
const ONE_SHIFT_AGO = '2025-06-15T02:00:00Z'
const THREE_SHIFTS_AGO = '2025-06-14T10:00:00Z'

type Requirement = Pick<
  EmergencyRequirement,
  'resource_key' | 'weight' | 'is_critical' | 'min_quantity'
>

const req = (
  resource_key: ResourceKey,
  weight = 1,
  is_critical = false,
  min_quantity = 1,
): Requirement => ({ resource_key, weight, is_critical, min_quantity })

let candidateSeq = 0

/** A fully-stocked, fully-current candidate; override only what a test cares about. */
function makeCandidate(overrides: Partial<ReferralCandidateRow> = {}): ReferralCandidateRow {
  candidateSeq += 1
  return {
    hospital_id: 'h-' + candidateSeq,
    name: 'Hospital ' + candidateSeq,
    code: 'H' + candidateSeq,
    level: 'district',
    city: 'Accra',
    region: 'Greater Accra',
    phone: '+233 30 000 0000',
    emergency_phone: '+233 30 000 0001',
    email: 'ops@example.org',
    latitude: 5.6037,
    longitude: -0.187,
    timezone: 'Africa/Accra',
    distance_km: 20,
    accepts_referrals: true,

    er_open: true,
    diversion_reason: null,

    operating_rooms_total: 3,
    operating_rooms_functional: 2,
    resident_surgeon_available: true,
    anesthetist_available: true,
    obstetric_theatre_available: true,
    neurosurgery_available: true,
    cath_lab_available: true,
    icu_beds_total: 10,
    icu_beds_available: 4,
    nicu_beds_total: 6,
    nicu_beds_available: 3,
    neonatal_resuscitation_available: true,
    ventilators_total: 8,
    ventilators_available: 4,
    oxygen_supply_percent: 100,
    isolation_beds_available: 2,
    general_beds_total: 40,
    general_beds_available: 12,
    burn_unit_available: true,
    dialysis_available: true,
    blood_bank_functional: true,
    ct_functional: true,
    mri_functional: true,
    xray_functional: true,
    ultrasound_functional: true,
    ambulances_available: 2,
    power_backup_available: true,

    resources_updated_at: FRESH,
    oldest_department_update_at: FRESH,
    departments_total: 0,
    departments_reporting: 0,

    blood_units_total: 40,
    blood_stock: {},

    referrals_received: 0,
    referrals_accepted: 0,
    avg_response_seconds: null,
    ...overrides,
  }
}

const rank = (input: Partial<RankingInput> & { candidates: ReferralCandidateRow[] }) =>
  rankHospitals({
    requirements: [],
    urgency: 'critical',
    now: NOW,
    ...input,
  })

const byId = (ranked: ScoredHospital[]) => ranked.map((entry) => entry.hospital.hospital_id)
const find = (ranked: ScoredHospital[], id: string): ScoredHospital => {
  const found = ranked.find((entry) => entry.hospital.hospital_id === id)
  if (!found) throw new Error('no scored entry for ' + id)
  return found
}

// ---------------------------------------------------------------------------

describe('the documented formula', () => {
  it('is resource * 70% + proximity * 30%', () => {
    const candidate = makeCandidate({ hospital_id: 'target', distance_km: 20 })

    const [scored] = rank({
      candidates: [candidate],
      requirements: [req('resident_surgeon', 1, false, 1)],
    })

    // 20 km * 1.3 road factor = 26 km at 60 km/h = 26 min, + 10 min overhead
    // = 36 min ETA; proximity = (1 - 36/180) * 100 = 80.
    expect(scored.resourceScore).toBe(100)
    expect(scored.proximityScore).toBe(80)
    expect(scored.etaMinutes).toBe(36)
    expect(scored.distanceKm).toBe(20)
    expect(scored.roadDistanceKm).toBe(26)
    expect(scored.readiness).toBe('green')
    expect(scored.penaltyApplied).toBe(0)
    expect(scored.score).toBeCloseTo(100 * 0.7 + 80 * 0.3, 5)
    expect(scored.score).toBe(94)
    expect(scored.eligible).toBe(true)
    expect(scored.rank).toBe(1)
  })

  it('honours a reweighted resource/proximity split', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ distance_km: 20 })],
      requirements: [req('resident_surgeon')],
      config: { resourceWeight: 0.5, proximityWeight: 0.5 },
    })

    expect(scored.score).toBe(90) // 100 * 0.5 + 80 * 0.5
  })

  it('scores 0 on resources when nothing required is available', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ resident_surgeon_available: false, distance_km: 0 })],
      requirements: [req('resident_surgeon')],
    })

    expect(scored.resourceScore).toBe(0)
    // Reported sub-scores are rounded to one decimal place.
    expect(scored.proximityScore).toBe(94.4)
  })
})

describe('availability normalisation', () => {
  it('is all-or-nothing for boolean resources', () => {
    const yes = availabilityOf(makeCandidate({ ct_functional: true }), {
      key: 'ct_scan',
      weight: 1,
      isCritical: false,
      minQuantity: 1,
    })
    const no = availabilityOf(makeCandidate({ ct_functional: false }), {
      key: 'ct_scan',
      weight: 1,
      isCritical: false,
      minQuantity: 1,
    })

    expect(yes).toMatchObject({ availability: 1, value: true, meetsMinimum: true })
    expect(no).toMatchObject({ availability: 0, value: false, meetsMinimum: false })
  })

  it('scales percent resources linearly and clamps them', () => {
    const requirement = {
      key: 'oxygen' as const,
      weight: 1,
      isCritical: false,
      minQuantity: 20,
    }

    expect(availabilityOf(makeCandidate({ oxygen_supply_percent: 0 }), requirement)).toMatchObject({
      availability: 0,
      meetsMinimum: false,
    })
    expect(
      availabilityOf(makeCandidate({ oxygen_supply_percent: 45 }), requirement).availability,
    ).toBeCloseTo(0.45, 10)
    expect(
      availabilityOf(makeCandidate({ oxygen_supply_percent: 19 }), requirement).meetsMinimum,
    ).toBe(false)
    expect(
      availabilityOf(makeCandidate({ oxygen_supply_percent: 20 }), requirement).meetsMinimum,
    ).toBe(true)
    expect(
      availabilityOf(makeCandidate({ oxygen_supply_percent: 140 }), requirement).availability,
    ).toBe(1)
  })

  it('saturates count resources instead of rewarding surplus', () => {
    // icu_bed saturates at 2 free beds.
    const requirement = { key: 'icu_bed' as const, weight: 1, isCritical: false, minQuantity: 1 }

    expect(availabilityOf(makeCandidate({ icu_beds_available: 0 }), requirement)).toMatchObject({
      availability: 0,
      meetsMinimum: false,
    })
    expect(
      availabilityOf(makeCandidate({ icu_beds_available: 1 }), requirement).availability,
    ).toBeCloseTo(0.5, 10)
    expect(availabilityOf(makeCandidate({ icu_beds_available: 2 }), requirement).availability).toBe(
      1,
    )
    // 5 free beds is not "more available" than 2 for the purpose of one patient.
    expect(availabilityOf(makeCandidate({ icu_beds_available: 5 }), requirement).availability).toBe(
      availabilityOf(makeCandidate({ icu_beds_available: 2 }), requirement).availability,
    )
  })

  it('raises the saturation point when a requirement demands more than the default', () => {
    const requirement = { key: 'icu_bed' as const, weight: 1, isCritical: false, minQuantity: 4 }
    expect(
      availabilityOf(makeCandidate({ icu_beds_available: 2 }), requirement).availability,
    ).toBeCloseTo(0.5, 10)
    expect(availabilityOf(makeCandidate({ icu_beds_available: 4 }), requirement).availability).toBe(
      1,
    )
  })

  it('reports the companion capacity column where one exists', () => {
    const withCapacity = availabilityOf(makeCandidate({ icu_beds_total: 10 }), {
      key: 'icu_bed',
      weight: 1,
      isCritical: false,
      minQuantity: 1,
    })
    const withoutCapacity = availabilityOf(makeCandidate(), {
      key: 'oxygen',
      weight: 1,
      isCritical: false,
      minQuantity: 20,
    })

    expect(withCapacity.capacity).toBe(10)
    expect(withoutCapacity.capacity).toBeNull()
  })

  it('rolls the saturated availabilities into the resource sub-score', () => {
    const [scored] = rank({
      candidates: [
        makeCandidate({
          resident_surgeon_available: true, // 1.0
          icu_beds_available: 1, // 0.5 (saturation 2)
          distance_km: 0,
        }),
      ],
      requirements: [req('resident_surgeon'), req('icu_bed')],
    })

    expect(scored.resourceScore).toBe(75) // (1 + 0.5) / 2 * 100
  })
})

describe('requirement weights', () => {
  const candidate = () =>
    makeCandidate({
      resident_surgeon_available: true,
      ct_functional: false,
      distance_km: 20,
    })

  it('moves the score toward the heavier requirement', () => {
    const even = rank({
      candidates: [candidate()],
      requirements: [req('resident_surgeon', 1), req('ct_scan', 1)],
    })[0]
    const favourAvailable = rank({
      candidates: [candidate()],
      requirements: [req('resident_surgeon', 2), req('ct_scan', 1)],
    })[0]
    const favourMissing = rank({
      candidates: [candidate()],
      requirements: [req('resident_surgeon', 1), req('ct_scan', 2)],
    })[0]

    expect(even.resourceScore).toBe(50) // (1*1 + 0*1) / 2
    expect(favourAvailable.resourceScore).toBeCloseTo((2 / 3) * 100, 0)
    expect(favourMissing.resourceScore).toBeCloseTo((1 / 3) * 100, 0)

    expect(favourAvailable.score).toBeGreaterThan(even.score)
    expect(favourMissing.score).toBeLessThan(even.score)
  })

  it('drops zero-weight non-critical requirements entirely', () => {
    const [scored] = rank({
      candidates: [candidate()],
      requirements: [req('resident_surgeon', 1), req('ct_scan', 0)],
    })

    expect(scored.resourceScore).toBe(100)
    expect(scored.breakdown.map((b) => b.key)).toEqual(['resident_surgeon'])
  })

  it('ignores a requirement pointing at a retired resource key', () => {
    const [scored] = rank({
      candidates: [candidate()],
      requirements: [
        req('resident_surgeon', 1),
        { resource_key: 'helipad' as ResourceKey, weight: 5, is_critical: true, min_quantity: 1 },
      ],
    })

    expect(scored.breakdown).toHaveLength(1)
    expect(scored.eligible).toBe(true)
  })
})

describe('critical requirements', () => {
  it('excludes a hospital that fails one, with a populated reason', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ resident_surgeon_available: false })],
      requirements: [req('resident_surgeon', 3, true, 1)],
    })

    expect(scored.eligible).toBe(false)
    expect(scored.exclusions).toEqual(['No resident surgeon on site'])
    expect(scored.breakdown[0]).toMatchObject({ isCritical: true, blocking: true })
  })

  it('treats a count below min_quantity as unmet', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ icu_beds_available: 1 })],
      requirements: [req('icu_bed', 3, true, 2)],
    })

    expect(scored.eligible).toBe(false)
    expect(scored.exclusions).toContain('No icu beds free')
  })

  it('sorts every ineligible hospital below every eligible one, however high the raw score', () => {
    const ranked = rank({
      candidates: [
        // Perfect resources, right next door -- but not taking referrals.
        makeCandidate({ hospital_id: 'perfect-but-closed', distance_km: 0, accepts_referrals: false }),
        // Mediocre, far away, but open.
        makeCandidate({
          hospital_id: 'workable',
          distance_km: 120,
          resident_surgeon_available: true,
        }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(byId(ranked)).toEqual(['workable', 'perfect-but-closed'])
    expect(find(ranked, 'perfect-but-closed').score).toBeGreaterThan(find(ranked, 'workable').score)
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].rank).toBe(2)
  })
})

describe('additionalRequired', () => {
  it('promotes coordinator-selected extras to critical requirements', () => {
    const ranked = rank({
      candidates: [
        makeCandidate({ hospital_id: 'near-no-ct', distance_km: 5, ct_functional: false }),
        makeCandidate({ hospital_id: 'far-with-ct', distance_km: 120, ct_functional: true }),
      ],
      requirements: [req('resident_surgeon')],
      additionalRequired: ['ct_scan'],
    })

    // Without the extra requirement the near hospital would win outright.
    const withoutExtra = rank({
      candidates: [
        makeCandidate({ hospital_id: 'near-no-ct', distance_km: 5, ct_functional: false }),
        makeCandidate({ hospital_id: 'far-with-ct', distance_km: 120, ct_functional: true }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(byId(withoutExtra)).toEqual(['near-no-ct', 'far-with-ct'])
    expect(byId(ranked)).toEqual(['far-with-ct', 'near-no-ct'])
    expect(find(ranked, 'near-no-ct').eligible).toBe(false)
    expect(find(ranked, 'near-no-ct').exclusions).toContain('No ct scanner working')
  })

  it('upgrades an existing non-critical requirement in place', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ ct_functional: false })],
      requirements: [req('ct_scan', 1, false, 1)],
      additionalRequired: ['ct_scan'],
    })

    expect(scored.breakdown).toHaveLength(1)
    expect(scored.breakdown[0]).toMatchObject({ key: 'ct_scan', isCritical: true, weight: 2 })
    expect(scored.eligible).toBe(false)
  })
})

describe('the staleness penalty', () => {
  const build = (updatedAt: string) =>
    makeCandidate({ distance_km: 20, resources_updated_at: updatedAt })

  it('ranks green above yellow above red for otherwise identical hospitals', () => {
    const ranked = rank({
      candidates: [
        { ...build(THREE_SHIFTS_AGO), hospital_id: 'red', name: 'A Red' },
        { ...build(FRESH), hospital_id: 'green', name: 'B Green' },
        { ...build(ONE_SHIFT_AGO), hospital_id: 'yellow', name: 'C Yellow' },
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(byId(ranked)).toEqual(['green', 'yellow', 'red'])
    expect(ranked.map((entry) => entry.readiness)).toEqual(['green', 'yellow', 'red'])
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3])
  })

  it('deducts exactly the configured rate', () => {
    const base = 94 // 100 * 0.7 + 80 * 0.3, verified above

    const green = rank({
      candidates: [build(FRESH)],
      requirements: [req('resident_surgeon')],
    })[0]
    const yellow = rank({
      candidates: [build(ONE_SHIFT_AGO)],
      requirements: [req('resident_surgeon')],
    })[0]
    const red = rank({
      candidates: [build(THREE_SHIFTS_AGO)],
      requirements: [req('resident_surgeon')],
    })[0]

    expect(green.penaltyApplied).toBe(0)
    expect(green.score).toBe(base)

    expect(yellow.score).toBeCloseTo(base * (1 - DEFAULT_SCORING_CONFIG.yellowPenalty), 1)
    expect(yellow.penaltyApplied).toBeCloseTo(base * DEFAULT_SCORING_CONFIG.yellowPenalty, 1)

    expect(red.score).toBeCloseTo(base * (1 - DEFAULT_SCORING_CONFIG.redPenalty), 1)
    expect(red.penaltyApplied).toBeCloseTo(base * DEFAULT_SCORING_CONFIG.redPenalty, 1)
  })

  it('respects an overridden penalty rate', () => {
    const [scored] = rank({
      candidates: [build(ONE_SHIFT_AGO)],
      requirements: [req('resident_surgeon')],
      config: { yellowPenalty: 0.5 },
    })

    expect(scored.score).toBe(47) // 94 * 0.5
    expect(scored.penaltyApplied).toBe(47)
  })

  it('is red whenever a configured department has never reported, whatever the timestamps', () => {
    const candidate = makeCandidate({
      resources_updated_at: FRESH,
      oldest_department_update_at: FRESH,
      departments_total: 4,
      departments_reporting: 3,
    })

    expect(candidateReadiness(candidate, NOW)).toEqual({ status: 'red', shiftsElapsed: 3 })

    const [scored] = rank({ candidates: [candidate], requirements: [req('resident_surgeon')] })
    expect(scored.readiness).toBe('red')
    expect(scored.penaltyApplied).toBeGreaterThan(0)
  })

  it('prefers department readiness over the resource timestamp when departments exist', () => {
    const candidate = makeCandidate({
      resources_updated_at: FRESH,
      oldest_department_update_at: THREE_SHIFTS_AGO,
      departments_total: 2,
      departments_reporting: 2,
    })

    expect(candidateReadiness(candidate, NOW)).toEqual({ status: 'red', shiftsElapsed: 3 })
  })

  it('reports -1 shifts, not Infinity, for a facility that has never reported', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ resources_updated_at: null })],
      requirements: [req('resident_surgeon')],
    })

    expect(scored.readiness).toBe('red')
    expect(scored.shiftsSinceUpdate).toBe(-1)
  })
})

describe('eligibility gates', () => {
  it('excludes the referring facility itself', () => {
    const ranked = rank({
      candidates: [makeCandidate({ hospital_id: 'origin' }), makeCandidate({ hospital_id: 'other' })],
      requirements: [req('resident_surgeon')],
      originHospitalId: 'origin',
    })

    expect(find(ranked, 'origin').exclusions).toContain('Referring facility')
    expect(find(ranked, 'origin').eligible).toBe(false)
    expect(byId(ranked)[0]).toBe('other')
  })

  it('excludes a hospital that is not accepting referrals', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ accepts_referrals: false })],
      requirements: [req('resident_surgeon')],
    })

    expect(scored.exclusions).toContain('Not accepting referrals')
    expect(scored.eligible).toBe(false)
  })

  it('excludes a hospital on diversion and quotes the reason', () => {
    const [withReason] = rank({
      candidates: [makeCandidate({ er_open: false, diversion_reason: 'No theatre staff' })],
      requirements: [req('resident_surgeon')],
    })
    const [withoutReason] = rank({
      candidates: [makeCandidate({ er_open: false, diversion_reason: null })],
      requirements: [req('resident_surgeon')],
    })

    expect(withReason.exclusions).toContain('On diversion: No theatre staff')
    expect(withoutReason.exclusions).toContain('On diversion')
  })

  it('keeps a diverted hospital eligible when the gate is switched off', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ er_open: false })],
      requirements: [req('resident_surgeon')],
      config: { excludeHospitalsOnDiversion: false },
    })

    expect(scored.eligible).toBe(true)
    expect(scored.exclusions).toEqual([])
  })

  it('excludes red hospitals only when configured to', () => {
    const candidate = makeCandidate({ resources_updated_at: THREE_SHIFTS_AGO })

    const permissive = rank({ candidates: [candidate], requirements: [req('resident_surgeon')] })[0]
    const strict = rank({
      candidates: [candidate],
      requirements: [req('resident_surgeon')],
      config: { excludeRedHospitals: true },
    })[0]

    expect(DEFAULT_SCORING_CONFIG.excludeRedHospitals).toBe(false)
    expect(permissive.eligible).toBe(true)
    expect(strict.eligible).toBe(false)
    expect(strict.exclusions).toContain('Readiness data stale')
  })

  it('excludes anything beyond the search radius', () => {
    const ranked = rank({
      candidates: [
        makeCandidate({ hospital_id: 'inside', distance_km: 240 }),
        makeCandidate({ hospital_id: 'outside', distance_km: 251 }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(find(ranked, 'inside').eligible).toBe(true)
    expect(find(ranked, 'outside').eligible).toBe(false)
    expect(find(ranked, 'outside').exclusions).toContain('Beyond 250 km search radius')
  })

  it('handles a candidate with an unusable distance', () => {
    const [scored] = rank({
      candidates: [makeCandidate({ distance_km: Number.NaN })],
      requirements: [req('resident_surgeon')],
    })

    expect(scored.distanceKm).toBe(-1)
    expect(scored.etaMinutes).toBe(-1)
    expect(scored.proximityScore).toBe(0)
    expect(scored.eligible).toBe(false)
  })

  it('accumulates every applicable exclusion', () => {
    const [scored] = rank({
      candidates: [
        makeCandidate({
          hospital_id: 'origin',
          accepts_referrals: false,
          er_open: false,
          distance_km: 400,
        }),
      ],
      requirements: [req('resident_surgeon')],
      originHospitalId: 'origin',
    })

    expect(scored.exclusions).toHaveLength(4)
    expect(scored.eligible).toBe(false)
  })
})

describe('tie-breaking', () => {
  const twin = (overrides: Partial<ReferralCandidateRow>) =>
    makeCandidate({ distance_km: 20, ...overrides })

  it('orders candidates within tieBreakEpsilon by historical acceptance rate', () => {
    const ranked = rank({
      candidates: [
        twin({ hospital_id: 'unreliable', name: 'A', referrals_received: 10, referrals_accepted: 4 }),
        twin({ hospital_id: 'reliable', name: 'B', referrals_received: 10, referrals_accepted: 9 }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(ranked[0].score).toBe(ranked[1].score)
    expect(byId(ranked)).toEqual(['reliable', 'unreliable'])
    expect(find(ranked, 'reliable').historicalAcceptanceRate).toBeCloseTo(0.9, 10)
    expect(find(ranked, 'unreliable').historicalAcceptanceRate).toBeCloseTo(0.4, 10)
  })

  it('sorts a candidate with history above one with none', () => {
    const ranked = rank({
      candidates: [
        twin({ hospital_id: 'unknown', name: 'A', referrals_received: 0, referrals_accepted: 0 }),
        twin({ hospital_id: 'known', name: 'B', referrals_received: 4, referrals_accepted: 1 }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(find(ranked, 'unknown').historicalAcceptanceRate).toBeNull()
    expect(byId(ranked)).toEqual(['known', 'unknown'])
  })

  it('falls through to response time, then distance, then name', () => {
    const base = {
      referrals_received: 10,
      referrals_accepted: 8,
    }

    const byResponse = rank({
      candidates: [
        twin({ hospital_id: 'slow', name: 'A', ...base, avg_response_seconds: 900 }),
        twin({ hospital_id: 'quick', name: 'B', ...base, avg_response_seconds: 120 }),
      ],
      requirements: [req('resident_surgeon')],
    })
    expect(byId(byResponse)).toEqual(['quick', 'slow'])

    const byName = rank({
      candidates: [
        twin({ hospital_id: 'zeta', name: 'Zeta Hospital', ...base, avg_response_seconds: 300 }),
        twin({ hospital_id: 'alpha', name: 'Alpha Hospital', ...base, avg_response_seconds: 300 }),
      ],
      requirements: [req('resident_surgeon')],
    })
    expect(byId(byName)).toEqual(['alpha', 'zeta'])
  })

  it('does not apply the tie-break when scores differ by more than epsilon', () => {
    const ranked = rank({
      candidates: [
        twin({
          hospital_id: 'better-resourced',
          name: 'A',
          icu_beds_available: 2,
          referrals_received: 0,
          referrals_accepted: 0,
        }),
        twin({
          hospital_id: 'well-liked',
          name: 'B',
          icu_beds_available: 0,
          referrals_received: 10,
          referrals_accepted: 10,
        }),
      ],
      requirements: [req('icu_bed')],
    })

    expect(ranked[0].score - ranked[1].score).toBeGreaterThan(
      DEFAULT_SCORING_CONFIG.tieBreakEpsilon,
    )
    expect(byId(ranked)).toEqual(['better-resourced', 'well-liked'])
  })

  it('compareCandidates puts eligible ahead of ineligible regardless of score', () => {
    const [eligible, ineligible] = rank({
      candidates: [
        makeCandidate({ hospital_id: 'ok', distance_km: 200 }),
        makeCandidate({ hospital_id: 'closed', distance_km: 1, accepts_referrals: false }),
      ],
      requirements: [req('resident_surgeon')],
    })

    expect(compareCandidates(eligible, ineligible)).toBeLessThan(0)
    expect(compareCandidates(ineligible, eligible)).toBeGreaterThan(0)
  })
})

describe('fallback requirements', () => {
  it('are used when the emergency type configures none', () => {
    const ranked = rank({
      candidates: [
        makeCandidate({
          hospital_id: 'stocked',
          general_beds_available: 10,
          oxygen_supply_percent: 100,
          power_backup_available: true,
        }),
        makeCandidate({
          hospital_id: 'bare',
          general_beds_available: 0,
          oxygen_supply_percent: 0,
          power_backup_available: false,
        }),
      ],
    })

    expect(find(ranked, 'stocked').breakdown.map((b) => b.key)).toEqual(
      FALLBACK_REQUIREMENTS.map((r) => r.resource_key),
    )
    expect(find(ranked, 'stocked').resourceScore).toBe(100)
    expect(find(ranked, 'bare').resourceScore).toBe(0)
    // The ranking is not degenerate: a stocked hospital still beats an empty one.
    expect(byId(ranked)).toEqual(['stocked', 'bare'])
    expect(ranked.some((entry) => entry.score > 0)).toBe(true)
  })

  it('never marks a fallback requirement critical', () => {
    const [scored] = rank({
      candidates: [
        makeCandidate({
          general_beds_available: 0,
          oxygen_supply_percent: 0,
          power_backup_available: false,
        }),
      ],
    })

    expect(scored.breakdown.every((b) => !b.isCritical)).toBe(true)
    expect(scored.eligible).toBe(true)
  })
})

describe('ranking mechanics', () => {
  const many = () => [
    makeCandidate({ hospital_id: 'a', name: 'Alpha', distance_km: 10 }),
    makeCandidate({ hospital_id: 'b', name: 'Bravo', distance_km: 60, icu_beds_available: 1 }),
    makeCandidate({ hospital_id: 'c', name: 'Charlie', distance_km: 30, icu_beds_available: 0 }),
    makeCandidate({ hospital_id: 'd', name: 'Delta', distance_km: 300 }),
    makeCandidate({ hospital_id: 'e', name: 'Echo', distance_km: 15, accepts_referrals: false }),
  ]

  it('assigns contiguous ranks 1..n', () => {
    const ranked = rank({ candidates: many(), requirements: [req('icu_bed'), req('oxygen', 2)] })

    expect(ranked).toHaveLength(5)
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it('never reorders eligible below ineligible', () => {
    const ranked = rank({ candidates: many(), requirements: [req('icu_bed')] })
    const firstIneligible = ranked.findIndex((entry) => !entry.eligible)

    expect(firstIneligible).toBeGreaterThan(0)
    expect(ranked.slice(firstIneligible).every((entry) => !entry.eligible)).toBe(true)
    expect(ranked.slice(0, firstIneligible).every((entry) => entry.eligible)).toBe(true)
  })

  it('is deterministic for identical inputs and stable under input order', () => {
    const requirements = [req('icu_bed'), req('oxygen', 2)]

    const first = rank({ candidates: many(), requirements })
    const second = rank({ candidates: many(), requirements })
    const shuffled = rank({ candidates: [...many()].reverse(), requirements })

    expect(byId(second)).toEqual(byId(first))
    expect(byId(shuffled)).toEqual(byId(first))
    expect(second.map((entry) => entry.score)).toEqual(first.map((entry) => entry.score))
  })

  it('returns an empty ranking for no candidates', () => {
    expect(rank({ candidates: [], requirements: [req('icu_bed')] })).toEqual([])
  })

  it('keeps every score inside 0..100', () => {
    for (const entry of rank({ candidates: many(), requirements: [req('icu_bed')] })) {
      expect(entry.score).toBeGreaterThanOrEqual(0)
      expect(entry.score).toBeLessThanOrEqual(100)
    }
  })
})

describe('snapshots', () => {
  const input: RankingInput = {
    candidates: [
      makeCandidate({ hospital_id: 'chosen', name: 'Chosen Hospital', distance_km: 20 }),
      makeCandidate({ hospital_id: 'second', name: 'Second Hospital', distance_km: 90 }),
      makeCandidate({ hospital_id: 'third', name: 'Third Hospital', distance_km: 140 }),
    ],
    requirements: [req('resident_surgeon', 3, true, 1), req('icu_bed', 2, false, 1)],
    additionalRequired: ['ct_scan'],
    urgency: 'critical',
    now: NOW,
    config: { maxEtaMinutes: 200 },
  }

  it('captures the effective config, requirements and selected breakdown', () => {
    const ranked = rankHospitals(input)
    const snapshot = buildScoreSnapshot(ranked[0], input, NOW)

    expect(snapshot.version).toBe(1)
    expect(snapshot.scored_at).toBe(NOW.toISOString())
    expect(snapshot.urgency).toBe('critical')

    // Defaults merged with the override, so the decision stays re-explainable.
    expect(snapshot.config.maxEtaMinutes).toBe(200)
    expect(snapshot.config.resourceWeight).toBe(DEFAULT_SCORING_CONFIG.resourceWeight)
    expect(snapshot.config.redPenalty).toBe(DEFAULT_SCORING_CONFIG.redPenalty)

    expect(snapshot.requirements).toEqual([
      { key: 'resident_surgeon', weight: 3, critical: true, min: 1 },
      { key: 'icu_bed', weight: 2, critical: false, min: 1 },
      { key: 'ct_scan', weight: 2, critical: true, min: 1 },
    ])

    expect(snapshot.selected).toMatchObject({
      hospital_id: 'chosen',
      rank: 1,
      readiness: 'green',
      score: ranked[0].score,
      resource_score: ranked[0].resourceScore,
      proximity_score: ranked[0].proximityScore,
      penalty: ranked[0].penaltyApplied,
      distance_km: 20,
    })
    expect(snapshot.selected.breakdown).toEqual(ranked[0].breakdown)
    expect(snapshot.selected.breakdown.map((b) => b.key)).toEqual([
      'resident_surgeon',
      'icu_bed',
      'ct_scan',
    ])
  })

  it('records the alternatives, respecting the limit', () => {
    const ranked = rankHospitals(input)

    expect(buildCandidateSnapshot(ranked)).toHaveLength(3)
    expect(buildCandidateSnapshot(ranked, 2)).toHaveLength(2)
    expect(buildCandidateSnapshot(ranked, 0)).toEqual([])
    expect(buildCandidateSnapshot(ranked, 2).map((entry) => entry.hospital_id)).toEqual(
      byId(ranked).slice(0, 2),
    )

    expect(buildCandidateSnapshot(ranked, 1)[0]).toEqual({
      hospital_id: ranked[0].hospital.hospital_id,
      name: ranked[0].hospital.name,
      score: ranked[0].score,
      readiness: ranked[0].readiness,
      distance_km: ranked[0].distanceKm,
      eta_minutes: ranked[0].etaMinutes,
      eligible: ranked[0].eligible,
      exclusions: ranked[0].exclusions,
      rank: ranked[0].rank,
    })
  })

  it('keeps the exclusion reasons of an ineligible alternative', () => {
    const ranked = rank({
      candidates: [
        makeCandidate({ hospital_id: 'open' }),
        makeCandidate({ hospital_id: 'closed', accepts_referrals: false }),
      ],
      requirements: [req('resident_surgeon')],
    })

    const snapshot = buildCandidateSnapshot(ranked)
    expect(snapshot[1]).toMatchObject({
      hospital_id: 'closed',
      eligible: false,
      exclusions: ['Not accepting referrals'],
    })
  })
})

describe('scoreBand', () => {
  it('bands a score for presentation', () => {
    expect(scoreBand(100)).toBe('strong')
    expect(scoreBand(70)).toBe('strong')
    expect(scoreBand(69.9)).toBe('moderate')
    expect(scoreBand(45)).toBe('moderate')
    expect(scoreBand(44.9)).toBe('weak')
    expect(scoreBand(0)).toBe('weak')
  })
})
