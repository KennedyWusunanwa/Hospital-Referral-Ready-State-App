/**
 * The Green / Yellow / Red traffic light.
 *
 * Straight from the project plan:
 *   Green  - updated for the current shift
 *   Yellow - not updated in the last shift
 *   Red    - not updated in the last three shifts
 *
 * Expressed as shift-boundary counts, that is: 0 -> green, 1-2 -> yellow,
 * 3 or more -> red. A department that has never reported is red.
 */

import { DEFAULT_TIMEZONE, type ReadinessStatus } from '@/lib/constants'
import type { DepartmentReadiness, HospitalReadinessSummary } from '@/lib/types'
import { shiftsSince } from './shifts'

/** Shifts elapsed at which a department turns yellow. */
export const YELLOW_THRESHOLD = 1
/** Shifts elapsed at which a department turns red. */
export const RED_THRESHOLD = 3

export function statusFromShiftsElapsed(shiftsElapsed: number): ReadinessStatus {
  if (!Number.isFinite(shiftsElapsed)) return 'red'
  if (shiftsElapsed >= RED_THRESHOLD) return 'red'
  if (shiftsElapsed >= YELLOW_THRESHOLD) return 'yellow'
  return 'green'
}

export function readinessStatusFor(
  lastUpdatedAt: string | Date | null | undefined,
  now: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { status: ReadinessStatus; shiftsElapsed: number } {
  const shiftsElapsed = shiftsSince(lastUpdatedAt, now, timeZone)
  return { status: statusFromShiftsElapsed(shiftsElapsed), shiftsElapsed }
}

const SEVERITY: Record<ReadinessStatus, number> = { green: 0, yellow: 1, red: 2 }

/** The more alarming of two statuses. */
export function worstStatus(a: ReadinessStatus, b: ReadinessStatus): ReadinessStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b
}

/**
 * A hospital is only as ready as its least-current department. Departments
 * flagged `requires_shift_update = false` (e.g. an administrative unit) are
 * excluded from the roll-up.
 */
export function summariseHospitalReadiness(
  departments: DepartmentReadiness[],
  hospitalId: string,
): HospitalReadinessSummary {
  const reporting = departments.filter((d) => d.requires_shift_update)

  const counts = { green: 0, yellow: 0, red: 0 }
  let oldest: string | null = null
  let status: ReadinessStatus = 'green'
  let anyNeverReported = false

  for (const department of reporting) {
    counts[department.status] += 1
    status = worstStatus(status, department.status)

    if (department.last_submitted_at) {
      if (!oldest || department.last_submitted_at < oldest) oldest = department.last_submitted_at
    } else {
      anyNeverReported = true
    }
  }

  // A department that has never reported has no timestamp to be "oldest", and
  // it is older than any that does -- so the roll-up reports an unknown age
  // rather than the misleadingly recent minimum of its reporting neighbours.
  // Every department is still counted: this cannot short-circuit the loop, or
  // the dashboard's "N of M current" tally silently loses the tail.
  if (anyNeverReported) oldest = null

  return {
    hospital_id: hospitalId,
    // No reporting departments configured yet: treat as stale rather than ready,
    // so the gap is visible instead of silently passing.
    status: reporting.length === 0 ? 'red' : status,
    green: counts.green,
    yellow: counts.yellow,
    red: counts.red,
    total: reporting.length,
    oldest_update_at: oldest,
  }
}

/** Percentage of reporting departments that are current. */
export function complianceRate(summary: HospitalReadinessSummary): number {
  if (summary.total === 0) return 0
  return (summary.green / summary.total) * 100
}

export const READINESS_COLOR_CLASSES: Record<
  ReadinessStatus,
  { dot: string; text: string; bg: string; border: string; badge: string }
> = {
  green: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    border: 'border-emerald-200 dark:border-emerald-900',
    badge:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  },
  yellow: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-900',
    badge:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  },
  red: {
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-200 dark:border-red-900',
    badge:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  },
}
