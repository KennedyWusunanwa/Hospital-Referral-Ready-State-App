/**
 * Distance and transport-time estimation.
 *
 * FERN deliberately avoids a routing API dependency: hospitals in the target
 * deployments are often offline-adjacent and a great-circle distance inflated
 * by a road factor is accurate enough to rank candidates. The factor and the
 * assumed speeds are configuration, not constants, so a deployment can tune
 * them against observed transfer times.
 */

import { URGENCY_TRANSPORT_SPEED_KMH, type ScoringConfig, type UrgencyLevel } from '@/lib/constants'

export const EARTH_RADIUS_KM = 6371.0088

export interface LatLng {
  latitude: number
  longitude: number
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Straight-line distance inflated to approximate real road distance. */
export function roadDistanceKm(straightLineKm: number, factor: number): number {
  return straightLineKm * Math.max(1, factor)
}

/**
 * Estimated door-to-door transport time in minutes, including a fixed
 * dispatch/handover overhead.
 */
export function estimateEtaMinutes(
  straightLineKm: number,
  urgency: UrgencyLevel,
  config: Pick<ScoringConfig, 'roadDistanceFactor' | 'fixedTransportOverheadMinutes'>,
): number {
  const speed = URGENCY_TRANSPORT_SPEED_KMH[urgency] ?? URGENCY_TRANSPORT_SPEED_KMH.urgent
  const km = roadDistanceKm(straightLineKm, config.roadDistanceFactor)
  const travelMinutes = (km / speed) * 60
  return config.fixedTransportOverheadMinutes + travelMinutes
}

/**
 * Proximity sub-score, 0-100. Linear decay from a co-located facility down to
 * `maxEtaMinutes`, past which proximity contributes nothing.
 */
export function proximityScore(etaMinutes: number, maxEtaMinutes: number): number {
  if (maxEtaMinutes <= 0) return 0
  const ratio = 1 - etaMinutes / maxEtaMinutes
  return clamp(ratio, 0, 1) * 100
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Human-readable distance, e.g. "820 m" or "37.4 km". */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '-'
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

/** Human-readable duration, e.g. "45 min" or "2 h 10 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '-'
  const rounded = Math.round(minutes)
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Basic sanity check for coordinates entered by an administrator. */
export function isValidLatLng(point: Partial<LatLng>): point is LatLng {
  return (
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    !(point.latitude === 0 && point.longitude === 0)
  )
}
