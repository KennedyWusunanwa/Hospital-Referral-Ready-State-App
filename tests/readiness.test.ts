import { describe, expect, it } from 'vitest'
import { READINESS_STATUSES, type ReadinessStatus } from '@/lib/constants'
import type { DepartmentReadiness, HospitalReadinessSummary } from '@/lib/types'
import {
  READINESS_COLOR_CLASSES,
  RED_THRESHOLD,
  YELLOW_THRESHOLD,
  complianceRate,
  readinessStatusFor,
  statusFromShiftsElapsed,
  summariseHospitalReadiness,
  worstStatus,
} from '@/domain/readiness'

const TZ = 'Africa/Accra'
const HOSPITAL = 'hosp-1'

let departmentSeq = 0

function makeDepartment(overrides: Partial<DepartmentReadiness> = {}): DepartmentReadiness {
  departmentSeq += 1
  return {
    department_id: 'dept-' + departmentSeq,
    hospital_id: HOSPITAL,
    department_name: 'Department ' + departmentSeq,
    template_key: 'general',
    requires_shift_update: true,
    last_submitted_at: '2025-06-15T08:00:00Z',
    last_shift_date: '2025-06-15',
    last_shift_type: 'morning',
    last_submitted_by_name: 'A. Mensah',
    status: 'green',
    shifts_since_update: 0,
    ...overrides,
  }
}

describe('statusFromShiftsElapsed', () => {
  it('matches the spec mapping exactly', () => {
    expect(statusFromShiftsElapsed(0)).toBe('green')
    expect(statusFromShiftsElapsed(1)).toBe('yellow')
    expect(statusFromShiftsElapsed(2)).toBe('yellow')
    expect(statusFromShiftsElapsed(3)).toBe('red')
    expect(statusFromShiftsElapsed(4)).toBe('red')
    expect(statusFromShiftsElapsed(99)).toBe('red')
  })

  it('treats "never reported" as red, not green', () => {
    expect(statusFromShiftsElapsed(Number.POSITIVE_INFINITY)).toBe('red')
    expect(statusFromShiftsElapsed(Number.NaN)).toBe('red')
  })

  it('uses the exported thresholds', () => {
    expect(YELLOW_THRESHOLD).toBe(1)
    expect(RED_THRESHOLD).toBe(3)
    expect(statusFromShiftsElapsed(YELLOW_THRESHOLD)).toBe('yellow')
    expect(statusFromShiftsElapsed(YELLOW_THRESHOLD - 1)).toBe('green')
    expect(statusFromShiftsElapsed(RED_THRESHOLD)).toBe('red')
    expect(statusFromShiftsElapsed(RED_THRESHOLD - 1)).toBe('yellow')
  })
})

describe('readinessStatusFor', () => {
  const now = new Date('2025-06-15T10:00:00Z') // morning shift of the 15th

  it('is green inside the current shift', () => {
    expect(readinessStatusFor('2025-06-15T07:30:00Z', now, TZ)).toEqual({
      status: 'green',
      shiftsElapsed: 0,
    })
  })

  it('is yellow one and two shifts back', () => {
    expect(readinessStatusFor('2025-06-15T02:00:00Z', now, TZ)).toEqual({
      status: 'yellow',
      shiftsElapsed: 1,
    })
    expect(readinessStatusFor('2025-06-14T20:00:00Z', now, TZ)).toEqual({
      status: 'yellow',
      shiftsElapsed: 2,
    })
  })

  it('is red three shifts back and beyond', () => {
    expect(readinessStatusFor('2025-06-14T10:00:00Z', now, TZ)).toEqual({
      status: 'red',
      shiftsElapsed: 3,
    })
    expect(readinessStatusFor('2025-06-10T10:00:00Z', now, TZ)).toEqual({
      status: 'red',
      shiftsElapsed: 15,
    })
  })

  it('is red with an infinite gap when nothing was ever submitted', () => {
    expect(readinessStatusFor(null, now, TZ)).toEqual({
      status: 'red',
      shiftsElapsed: Number.POSITIVE_INFINITY,
    })
  })
})

describe('worstStatus', () => {
  const expected: Record<string, ReadinessStatus> = {
    'green|green': 'green',
    'green|yellow': 'yellow',
    'green|red': 'red',
    'yellow|green': 'yellow',
    'yellow|yellow': 'yellow',
    'yellow|red': 'red',
    'red|green': 'red',
    'red|yellow': 'red',
    'red|red': 'red',
  }

  it('returns the more alarming of every pair', () => {
    for (const a of READINESS_STATUSES) {
      for (const b of READINESS_STATUSES) {
        expect(worstStatus(a, b)).toBe(expected[a + '|' + b])
      }
    }
  })

  it('is commutative', () => {
    for (const a of READINESS_STATUSES) {
      for (const b of READINESS_STATUSES) {
        expect(worstStatus(a, b)).toBe(worstStatus(b, a))
      }
    }
  })
})

describe('summariseHospitalReadiness', () => {
  it('rolls up to the worst reporting department', () => {
    const summary = summariseHospitalReadiness(
      [
        makeDepartment({ status: 'green', last_submitted_at: '2025-06-15T08:00:00Z' }),
        makeDepartment({ status: 'green', last_submitted_at: '2025-06-15T09:00:00Z' }),
        makeDepartment({ status: 'yellow', last_submitted_at: '2025-06-15T02:00:00Z' }),
      ],
      HOSPITAL,
    )

    expect(summary.status).toBe('yellow')
    expect(summary.hospital_id).toBe(HOSPITAL)
  })

  it('counts each status and reports the oldest update', () => {
    const summary = summariseHospitalReadiness(
      [
        makeDepartment({ status: 'green', last_submitted_at: '2025-06-15T09:00:00Z' }),
        makeDepartment({ status: 'yellow', last_submitted_at: '2025-06-15T02:00:00Z' }),
        makeDepartment({ status: 'yellow', last_submitted_at: '2025-06-15T03:00:00Z' }),
        makeDepartment({ status: 'red', last_submitted_at: '2025-06-13T08:00:00Z' }),
      ],
      HOSPITAL,
    )

    expect(summary).toEqual<HospitalReadinessSummary>({
      hospital_id: HOSPITAL,
      status: 'red',
      green: 1,
      yellow: 2,
      red: 1,
      total: 4,
      oldest_update_at: '2025-06-13T08:00:00Z',
    })
  })

  it('ignores departments that do not owe a shift update', () => {
    const summary = summariseHospitalReadiness(
      [
        makeDepartment({ status: 'green' }),
        makeDepartment({
          status: 'red',
          requires_shift_update: false,
          last_submitted_at: null,
        }),
      ],
      HOSPITAL,
    )

    expect(summary.status).toBe('green')
    expect(summary.total).toBe(1)
    expect(summary.green).toBe(1)
    expect(summary.red).toBe(0)
  })

  it('reports a null oldest update when a department has never reported', () => {
    const summary = summariseHospitalReadiness(
      [
        makeDepartment({ status: 'green', last_submitted_at: '2025-06-15T09:00:00Z' }),
        makeDepartment({ status: 'red', last_submitted_at: null }),
      ],
      HOSPITAL,
    )

    expect(summary.status).toBe('red')
    expect(summary.total).toBe(2)
    expect(summary.oldest_update_at).toBeNull()
  })

  // Regression: an early exit here used to drop every department ordered after
  // the first never-reported one, under-counting the dashboard's tally.
  it('counts every reporting department even after a never-reported one', () => {
    const summary = summariseHospitalReadiness(
      [
        makeDepartment({ status: 'red', last_submitted_at: null }),
        makeDepartment({ status: 'green', last_submitted_at: '2025-06-15T09:00:00Z' }),
        makeDepartment({ status: 'yellow', last_submitted_at: '2025-06-15T02:00:00Z' }),
      ],
      HOSPITAL,
    )

    expect(summary.green + summary.yellow + summary.red).toBe(summary.total)
    expect(summary).toMatchObject({ green: 1, yellow: 1, red: 1, total: 3, status: 'red' })
  })

  it('is red, not green, when no department reports at all', () => {
    expect(summariseHospitalReadiness([], HOSPITAL)).toEqual<HospitalReadinessSummary>({
      hospital_id: HOSPITAL,
      status: 'red',
      green: 0,
      yellow: 0,
      red: 0,
      total: 0,
      oldest_update_at: null,
    })

    const onlyNonReporting = summariseHospitalReadiness(
      [makeDepartment({ requires_shift_update: false })],
      HOSPITAL,
    )
    expect(onlyNonReporting.status).toBe('red')
    expect(onlyNonReporting.total).toBe(0)
  })
})

describe('complianceRate', () => {
  const summary = (over: Partial<HospitalReadinessSummary>): HospitalReadinessSummary => ({
    hospital_id: HOSPITAL,
    status: 'green',
    green: 0,
    yellow: 0,
    red: 0,
    total: 0,
    oldest_update_at: null,
    ...over,
  })

  it('is the percentage of current departments', () => {
    expect(complianceRate(summary({ green: 4, total: 4 }))).toBe(100)
    expect(complianceRate(summary({ green: 3, yellow: 1, total: 4 }))).toBe(75)
    expect(complianceRate(summary({ green: 1, red: 3, total: 4 }))).toBe(25)
    expect(complianceRate(summary({ red: 2, total: 2 }))).toBe(0)
  })

  it('is 0 rather than NaN when nothing reports', () => {
    expect(complianceRate(summary({ total: 0 }))).toBe(0)
  })
})

describe('READINESS_COLOR_CLASSES', () => {
  it('defines a full class set for every status', () => {
    for (const status of READINESS_STATUSES) {
      const classes = READINESS_COLOR_CLASSES[status]
      expect(classes.dot).toBeTruthy()
      expect(classes.text).toContain('dark:')
      expect(classes.bg).toContain('dark:')
      expect(classes.border).toContain('dark:')
      expect(classes.badge).toContain('dark:')
    }
  })
})
