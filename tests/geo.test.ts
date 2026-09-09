import { describe, expect, it } from 'vitest'
import { DEFAULT_SCORING_CONFIG, URGENCY_TRANSPORT_SPEED_KMH } from '@/lib/constants'
import {
  EARTH_RADIUS_KM,
  clamp,
  estimateEtaMinutes,
  formatDistance,
  formatDuration,
  haversineKm,
  isValidLatLng,
  proximityScore,
  roadDistanceKm,
  type LatLng,
} from '@/domain/geo'

const ACCRA: LatLng = { latitude: 5.6037, longitude: -0.187 }
const KUMASI: LatLng = { latitude: 6.6885, longitude: -1.6244 }
const TAMALE: LatLng = { latitude: 9.4008, longitude: -0.8393 }

const TRANSPORT = {
  roadDistanceFactor: DEFAULT_SCORING_CONFIG.roadDistanceFactor,
  fixedTransportOverheadMinutes: DEFAULT_SCORING_CONFIG.fixedTransportOverheadMinutes,
}

describe('haversineKm', () => {
  it('matches a known Ghanaian city pair', () => {
    // Accra -> Kumasi is a little under 200 km great-circle.
    expect(haversineKm(ACCRA, KUMASI)).toBeGreaterThan(185)
    expect(haversineKm(ACCRA, KUMASI)).toBeLessThan(215)
  })

  it('is symmetric', () => {
    expect(haversineKm(ACCRA, KUMASI)).toBeCloseTo(haversineKm(KUMASI, ACCRA), 9)
    expect(haversineKm(KUMASI, TAMALE)).toBeCloseTo(haversineKm(TAMALE, KUMASI), 9)
  })

  it('is zero for identical points', () => {
    expect(haversineKm(ACCRA, ACCRA)).toBe(0)
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0)
  })

  it('measures a degree of latitude as roughly 111 km', () => {
    const oneDegree = haversineKm(
      { latitude: 0, longitude: 12 },
      { latitude: 1, longitude: 12 },
    )
    expect(oneDegree).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_KM, 6)
  })

  it('handles antipodal-ish spans without NaN', () => {
    const half = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })
    expect(half).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 3)
  })
})

describe('roadDistanceKm', () => {
  it('inflates by the configured factor', () => {
    expect(roadDistanceKm(100, 1.3)).toBeCloseTo(130, 10)
    expect(roadDistanceKm(0, 1.3)).toBe(0)
  })

  it('never shrinks a distance, whatever the factor', () => {
    for (const factor of [0, 0.5, 0.99, 1, 1.4, 2]) {
      expect(roadDistanceKm(80, factor)).toBeGreaterThanOrEqual(80)
    }
    expect(roadDistanceKm(80, 0.5)).toBe(80)
  })
})

describe('estimateEtaMinutes', () => {
  it('includes the fixed overhead even at zero distance', () => {
    expect(estimateEtaMinutes(0, 'critical', TRANSPORT)).toBe(
      TRANSPORT.fixedTransportOverheadMinutes,
    )
  })

  it('applies the road factor and the urgency speed', () => {
    // 20 km * 1.3 = 26 road km at 60 km/h = 26 min, + 10 min overhead.
    expect(estimateEtaMinutes(20, 'critical', TRANSPORT)).toBeCloseTo(36, 9)
    // Routine transport is assumed slower, so the same trip takes longer.
    const routineTravel = (20 * 1.3) / URGENCY_TRANSPORT_SPEED_KMH.routine
    expect(estimateEtaMinutes(20, 'routine', TRANSPORT)).toBeCloseTo(10 + routineTravel * 60, 9)
  })

  it('is monotonically increasing in distance', () => {
    let previous = -1
    for (const km of [0, 5, 20, 60, 150, 400]) {
      const eta = estimateEtaMinutes(km, 'urgent', TRANSPORT)
      expect(eta).toBeGreaterThan(previous)
      previous = eta
    }
  })

  it('is inversely related to the assumed urgency speed', () => {
    const critical = estimateEtaMinutes(100, 'critical', TRANSPORT)
    const urgent = estimateEtaMinutes(100, 'urgent', TRANSPORT)
    const routine = estimateEtaMinutes(100, 'routine', TRANSPORT)

    expect(URGENCY_TRANSPORT_SPEED_KMH.critical).toBeGreaterThan(
      URGENCY_TRANSPORT_SPEED_KMH.routine,
    )
    expect(critical).toBeLessThan(urgent)
    expect(urgent).toBeLessThan(routine)
  })
})

describe('proximityScore', () => {
  it('is 100 for a co-located facility', () => {
    expect(proximityScore(0, 180)).toBe(100)
  })

  it('is 0 at and beyond the maximum ETA', () => {
    expect(proximityScore(180, 180)).toBe(0)
    expect(proximityScore(240, 180)).toBe(0)
    expect(proximityScore(Number.POSITIVE_INFINITY, 180)).toBe(0)
  })

  it('decays linearly and monotonically', () => {
    expect(proximityScore(90, 180)).toBeCloseTo(50, 9)
    expect(proximityScore(36, 180)).toBeCloseTo(80, 9)

    let previous = 101
    for (const eta of [0, 10, 45, 90, 135, 179, 180]) {
      const score = proximityScore(eta, 180)
      expect(score).toBeLessThan(previous)
      previous = score
    }
  })

  it('is 0 when no maximum ETA is configured', () => {
    expect(proximityScore(10, 0)).toBe(0)
    expect(proximityScore(10, -5)).toBe(0)
  })
})

describe('clamp', () => {
  it('bounds a value to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(42, 0, 10)).toBe(10)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('collapses NaN to the minimum rather than propagating it', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0)
    expect(clamp(Number.NaN, -20, 20)).toBe(-20)
  })

  it('handles infinities', () => {
    expect(clamp(Number.POSITIVE_INFINITY, 0, 1)).toBe(1)
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 1)).toBe(0)
  })
})

describe('isValidLatLng', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(ACCRA)).toBe(true)
    expect(isValidLatLng({ latitude: -90, longitude: 180 })).toBe(true)
    expect(isValidLatLng({ latitude: 90, longitude: -180 })).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(isValidLatLng({ latitude: 91, longitude: 0 })).toBe(false)
    expect(isValidLatLng({ latitude: -91, longitude: 0 })).toBe(false)
    expect(isValidLatLng({ latitude: 0, longitude: 181 })).toBe(false)
    expect(isValidLatLng({ latitude: 0, longitude: -181 })).toBe(false)
  })

  it('rejects NaN, infinity and missing halves', () => {
    expect(isValidLatLng({ latitude: Number.NaN, longitude: 0.5 })).toBe(false)
    expect(isValidLatLng({ latitude: 5, longitude: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidLatLng({ latitude: 5 })).toBe(false)
    expect(isValidLatLng({})).toBe(false)
  })

  it('rejects null island, which is almost always an unset field', () => {
    expect(isValidLatLng({ latitude: 0, longitude: 0 })).toBe(false)
    // ...but a real coordinate on either axis alone is fine.
    expect(isValidLatLng({ latitude: 0, longitude: -0.187 })).toBe(true)
    expect(isValidLatLng({ latitude: 5.6037, longitude: 0 })).toBe(true)
  })
})

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(0.82)).toBe('820 m')
    expect(formatDistance(0.9994)).toBe('999 m')
  })

  it('uses one decimal below 10 km and whole kilometres above', () => {
    expect(formatDistance(1)).toBe('1.0 km')
    expect(formatDistance(9.94)).toBe('9.9 km')
    expect(formatDistance(37.4)).toBe('37 km')
    expect(formatDistance(199.5)).toBe('200 km')
  })

  it('renders a dash for a non-finite distance', () => {
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('-')
    expect(formatDistance(Number.NaN)).toBe('-')
  })
})

describe('formatDuration', () => {
  it('uses minutes below an hour', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(59.4)).toBe('59 min')
  })

  it('uses hours and minutes above', () => {
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(130)).toBe('2 h 10 min')
    expect(formatDuration(120)).toBe('2 h')
  })

  it('renders a dash for negative or non-finite input', () => {
    expect(formatDuration(-1)).toBe('-')
    expect(formatDuration(Number.NaN)).toBe('-')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('-')
  })
})
