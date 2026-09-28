import { describe, expect, it } from 'vitest'
import {
  ANONYMOUS_SCOPE,
  buildScope,
  canAccessDepartment,
  canBrowseHospitals,
  canCreateReferral,
  canSeeHospitalReadiness,
  canSubmitReadinessFor,
  referralPolicyAllows,
  referralPolicyNotice,
  scopeDepartments,
  scopeReadinessRows,
  toReferralPolicy,
} from '@/lib/scope'
import { REFERRAL_POLICIES } from '@/lib/constants'

const HOSPITAL_A = 'hospital-a'
const HOSPITAL_B = 'hospital-b'
const ICU = 'dept-icu'
const THEATRE = 'dept-theatre'
const B_ICU = 'dept-b-icu'

const shiftInCharge = buildScope({
  role: 'shift_in_charge',
  hospitalId: HOSPITAL_A,
  departmentId: ICU,
})
const coordinatorDept = buildScope({
  role: 'department_coordinator',
  hospitalId: HOSPITAL_A,
  departmentId: ICU,
})
const hospitalAdmin = buildScope({
  role: 'hospital_admin',
  hospitalId: HOSPITAL_A,
  departmentId: null,
})
const referralDesk = buildScope({
  role: 'referral_coordinator',
  hospitalId: HOSPITAL_A,
  departmentId: null,
})
const viewer = buildScope({ role: 'viewer', hospitalId: HOSPITAL_A, departmentId: null })
const superAdmin = buildScope({ role: 'super_admin', hospitalId: null, departmentId: null })

describe('buildScope', () => {
  it('places each role at its level and keeps departments only for department-level roles', () => {
    expect(shiftInCharge.level).toBe('department')
    expect(shiftInCharge.departmentIds).toEqual([ICU])
    expect(shiftInCharge.hospitalWide).toBe(false)

    expect(hospitalAdmin.level).toBe('hospital')
    expect(hospitalAdmin.departmentIds).toEqual([])
    expect(hospitalAdmin.hospitalWide).toBe(true)
    expect(hospitalAdmin.networkWide).toBe(false)

    expect(superAdmin.level).toBe('system')
    expect(superAdmin.networkWide).toBe(true)
  })

  it('is empty for an anonymous or role-less account', () => {
    expect(buildScope({ role: null, hospitalId: HOSPITAL_A, departmentId: ICU })).toBe(
      ANONYMOUS_SCOPE,
    )
    expect(ANONYMOUS_SCOPE.level).toBeNull()
  })

  it('accepts several departments for one person, without duplicates', () => {
    const multi = buildScope({
      role: 'shift_in_charge',
      hospitalId: HOSPITAL_A,
      departmentId: ICU,
      extraDepartmentIds: [THEATRE, ICU],
    })
    expect(multi.departmentIds).toEqual([ICU, THEATRE])
  })

  it('defaults an unknown referral policy to hospital only', () => {
    expect(toReferralPolicy(null)).toBe('hospital_only')
    expect(toReferralPolicy('nonsense')).toBe('hospital_only')
    for (const policy of REFERRAL_POLICIES) expect(toReferralPolicy(policy)).toBe(policy)
  })
})

describe('department access (scenarios A, B, C)', () => {
  it('A: a department user cannot see or submit for another department', () => {
    expect(canAccessDepartment(shiftInCharge, THEATRE)).toBe(false)
    expect(canSubmitReadinessFor(shiftInCharge, { id: THEATRE, hospital_id: HOSPITAL_A })).toBe(
      false,
    )
    expect(canAccessDepartment(shiftInCharge, B_ICU)).toBe(false)
  })

  it('A: a department user can see and submit for their own department', () => {
    expect(canAccessDepartment(shiftInCharge, ICU)).toBe(true)
    expect(canSubmitReadinessFor(shiftInCharge, { id: ICU, hospital_id: HOSPITAL_A })).toBe(true)
  })

  it('B: a hospital admin sees every department in the hospital and submits for any of them', () => {
    expect(canAccessDepartment(hospitalAdmin, ICU)).toBe(true)
    expect(canAccessDepartment(hospitalAdmin, THEATRE)).toBe(true)
    expect(canSubmitReadinessFor(hospitalAdmin, { id: THEATRE, hospital_id: HOSPITAL_A })).toBe(
      true,
    )
    expect(canSubmitReadinessFor(hospitalAdmin, { id: B_ICU, hospital_id: HOSPITAL_B })).toBe(false)
  })

  it('B: a referral coordinator sees departments but cannot submit readiness', () => {
    expect(canAccessDepartment(referralDesk, ICU)).toBe(true)
    expect(canSubmitReadinessFor(referralDesk, { id: ICU, hospital_id: HOSPITAL_A })).toBe(false)
  })

  it('C: a super admin can act on any department anywhere', () => {
    expect(canAccessDepartment(superAdmin, B_ICU)).toBe(true)
    expect(canSubmitReadinessFor(superAdmin, { id: B_ICU, hospital_id: HOSPITAL_B })).toBe(true)
  })

  it('an account with a department-level role but no department has no scope', () => {
    const unassigned = buildScope({
      role: 'shift_in_charge',
      hospitalId: HOSPITAL_A,
      departmentId: null,
    })
    expect(unassigned.departmentIds).toEqual([])
    expect(canAccessDepartment(unassigned, ICU)).toBe(false)
    expect(canSubmitReadinessFor(unassigned, { id: ICU, hospital_id: HOSPITAL_A })).toBe(false)
  })

  it('filters lists down to the account scope', () => {
    const departments = [{ id: ICU }, { id: THEATRE }]
    expect(scopeDepartments(shiftInCharge, departments)).toEqual([{ id: ICU }])
    expect(scopeDepartments(hospitalAdmin, departments)).toEqual(departments)

    const rows = [{ department_id: ICU }, { department_id: THEATRE }]
    expect(scopeReadinessRows(coordinatorDept, rows)).toEqual([{ department_id: ICU }])
    expect(scopeReadinessRows(superAdmin, rows)).toEqual(rows)
  })

  it('reserves the hospital-wide board for hospital and system levels', () => {
    expect(canSeeHospitalReadiness(shiftInCharge)).toBe(false)
    expect(canSeeHospitalReadiness(hospitalAdmin)).toBe(true)
    expect(canSeeHospitalReadiness(superAdmin)).toBe(true)
  })
})

describe('referral initiation policy (scenarios D, E, F)', () => {
  const withPolicy = (role: Parameters<typeof buildScope>[0]['role'], policy: string) =>
    buildScope({ role, hospitalId: HOSPITAL_A, departmentId: ICU, referralPolicy: policy })

  it('D: hospital_only lets hospital-level roles refer and blocks department accounts', () => {
    expect(canCreateReferral(withPolicy('referral_coordinator', 'hospital_only'))).toBe(true)
    expect(canCreateReferral(withPolicy('hospital_admin', 'hospital_only'))).toBe(true)
    expect(canCreateReferral(withPolicy('department_coordinator', 'hospital_only'))).toBe(false)
    expect(canCreateReferral(withPolicy('shift_in_charge', 'hospital_only'))).toBe(false)
  })

  it('E: department_only lets department coordinators refer and blocks hospital-level roles', () => {
    expect(canCreateReferral(withPolicy('department_coordinator', 'department_only'))).toBe(true)
    expect(canCreateReferral(withPolicy('referral_coordinator', 'department_only'))).toBe(false)
    expect(canCreateReferral(withPolicy('hospital_admin', 'department_only'))).toBe(false)
  })

  it('F: hospital_and_department lets both levels refer', () => {
    expect(canCreateReferral(withPolicy('department_coordinator', 'hospital_and_department'))).toBe(
      true,
    )
    expect(canCreateReferral(withPolicy('referral_coordinator', 'hospital_and_department'))).toBe(
      true,
    )
  })

  it('never lets a role without referral:create refer, whatever the policy', () => {
    for (const policy of REFERRAL_POLICIES) {
      expect(canCreateReferral(withPolicy('shift_in_charge', policy))).toBe(false)
      expect(canCreateReferral(withPolicy('viewer', policy))).toBe(false)
    }
  })

  it('always lets a system administrator refer', () => {
    for (const policy of REFERRAL_POLICIES) {
      expect(referralPolicyAllows(policy, 'system')).toBe(true)
    }
    expect(canCreateReferral(superAdmin)).toBe(true)
  })

  it('needs a home hospital for anyone below system level', () => {
    const detached = buildScope({
      role: 'referral_coordinator',
      hospitalId: null,
      departmentId: null,
    })
    expect(canCreateReferral(detached)).toBe(false)
  })

  it('explains to a department account why it cannot refer', () => {
    expect(referralPolicyNotice(withPolicy('shift_in_charge', 'hospital_and_department'))).toMatch(
      /role does not raise referrals/,
    )
    expect(referralPolicyNotice(withPolicy('department_coordinator', 'hospital_only'))).toMatch(
      /hospital level only/,
    )
    expect(referralPolicyNotice(withPolicy('department_coordinator', 'department_only'))).toBeNull()
    expect(referralPolicyNotice(hospitalAdmin)).toBeNull()
  })
})

describe('directory browsing (pending decision, current default)', () => {
  it('lets every signed-in level browse the directory for now', () => {
    expect(canBrowseHospitals(shiftInCharge)).toBe(true)
    expect(canBrowseHospitals(viewer)).toBe(true)
    expect(canBrowseHospitals(ANONYMOUS_SCOPE)).toBe(false)
  })
})
