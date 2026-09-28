/**
 * Organisational scope: WHERE an account may act.
 *
 * A role says what a person may do (`ROLE_CAPABILITIES`); scope says where.
 * The two are combined here and nowhere else, so a screen, a query, the
 * command palette and the dashboard all ask the same questions:
 *
 *   canAccessDepartment(scope, id)      may this account see this department?
 *   canSubmitReadinessFor(scope, id)    may it file this department's shift update?
 *   canCreateReferral(scope)            may it raise a referral, given the hospital's policy?
 *
 * The database enforces the same rules in `0008_department_scope.sql`
 * (`accessible_department_ids()`, `can_manage_department()`,
 * `can_create_referral()`, `can_view_referral()`); this module keeps the
 * interface honest about what will be allowed rather than being the boundary.
 *
 * Department membership is a list so that one person covering several units
 * later needs a data change, not a rewrite.
 */

import {
  DEFAULT_REFERRAL_POLICY,
  ROLE_CAPABILITIES,
  ROLE_TIER_OF,
  type Capability,
  type ReferralPolicy,
  type RoleTier,
  type UserRole,
} from './constants'

export type AccessLevel = RoleTier

export interface ScopeInput {
  role: UserRole | null | undefined
  hospitalId: string | null | undefined
  departmentId: string | null | undefined
  /** Further departments this person covers. Nothing writes these yet. */
  extraDepartmentIds?: readonly string[]
  /** The home hospital's referral initiation policy. */
  referralPolicy?: ReferralPolicy | string | null
}

export interface UserScope {
  level: AccessLevel | null
  role: UserRole | null
  hospitalId: string | null
  /** The departments a department-level account may act on. Empty for the other levels. */
  departmentIds: readonly string[]
  /** May see every department of the home hospital (system and hospital levels). */
  hospitalWide: boolean
  /** May see every hospital's internal data (system level). */
  networkWide: boolean
  referralPolicy: ReferralPolicy
}

const EMPTY: readonly string[] = []

export function toReferralPolicy(value: string | null | undefined): ReferralPolicy {
  return value === 'department_only' || value === 'hospital_and_department'
    ? value
    : DEFAULT_REFERRAL_POLICY
}

export const ANONYMOUS_SCOPE: UserScope = {
  level: null,
  role: null,
  hospitalId: null,
  departmentIds: EMPTY,
  hospitalWide: false,
  networkWide: false,
  referralPolicy: DEFAULT_REFERRAL_POLICY,
}

export function buildScope(input: ScopeInput): UserScope {
  const role = input.role ?? null
  if (!role) return ANONYMOUS_SCOPE
  const level = ROLE_TIER_OF[role]
  const departments =
    level === 'department'
      ? [input.departmentId, ...(input.extraDepartmentIds ?? [])].filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : EMPTY
  return {
    level,
    role,
    hospitalId: input.hospitalId ?? null,
    departmentIds: [...new Set(departments)],
    hospitalWide: level === 'system' || level === 'hospital',
    networkWide: level === 'system',
    referralPolicy: toReferralPolicy(input.referralPolicy),
  }
}

export function scopeHasCapability(scope: UserScope, capability: Capability): boolean {
  if (!scope.role) return false
  const capabilities: readonly string[] = ROLE_CAPABILITIES[scope.role]
  return capabilities.includes(capability)
}

/**
 * May the account see this department's readiness at all? Hospital-level
 * accounts see every hospital's departments (a referral decision needs them);
 * department-level accounts see only their own.
 */
export function canAccessDepartment(scope: UserScope, departmentId: string): boolean {
  if (!scope.level) return false
  if (scope.hospitalWide) return true
  return scope.departmentIds.includes(departmentId)
}

/**
 * May the account file a shift update for this department? The hospital match
 * is checked by the database for hospital-level accounts; here it is applied
 * when the department's hospital is known.
 */
export function canSubmitReadinessFor(
  scope: UserScope,
  department: { id: string; hospital_id?: string | null },
): boolean {
  if (!scopeHasCapability(scope, 'readiness:submit')) return false
  if (scope.networkWide) return true
  if (department.hospital_id && department.hospital_id !== scope.hospitalId) return false
  if (scope.hospitalWide) return true
  return scope.departmentIds.includes(department.id)
}

/** Which levels a hospital's referral policy lets initiate a referral. */
export function referralPolicyAllows(policy: ReferralPolicy, level: AccessLevel): boolean {
  if (level === 'system') return true
  switch (policy) {
    case 'department_only':
      return level === 'department'
    case 'hospital_and_department':
      return true
    default:
      return level === 'hospital'
  }
}

/** Role permission AND the home hospital's referral policy. */
export function canCreateReferral(scope: UserScope): boolean {
  if (!scope.level || !scopeHasCapability(scope, 'referral:create')) return false
  if (scope.level !== 'system' && !scope.hospitalId) return false
  return referralPolicyAllows(scope.referralPolicy, scope.level)
}

/**
 * Whether the account may browse the hospital directory and other facilities'
 * pages. Pending an operational decision, department-level accounts keep the
 * directory; flip the constant below to restrict them to referral contexts.
 */
export const DEPARTMENT_LEVEL_BROWSES_DIRECTORY = true

export function canBrowseHospitals(scope: UserScope): boolean {
  if (!scope.level) return false
  if (scope.level !== 'department') return true
  return DEPARTMENT_LEVEL_BROWSES_DIRECTORY || canCreateReferral(scope)
}

/** Hospital-wide readiness (the board, compliance, roll-ups) belongs to hospital and system levels. */
export function canSeeHospitalReadiness(scope: UserScope): boolean {
  return scope.hospitalWide
}

/** Filters a list of departments down to the ones the account may see. */
export function scopeDepartments<T extends { id: string }>(scope: UserScope, rows: T[]): T[] {
  if (scope.hospitalWide) return rows
  return rows.filter((row) => scope.departmentIds.includes(row.id))
}

/** The same, for readiness rows keyed on `department_id`. */
export function scopeReadinessRows<T extends { department_id: string }>(
  scope: UserScope,
  rows: T[],
): T[] {
  if (scope.hospitalWide) return rows
  return rows.filter((row) => scope.departmentIds.includes(row.department_id))
}

/** A short explanation for a department-level account that cannot raise referrals. */
export function referralPolicyNotice(scope: UserScope): string | null {
  if (scope.level !== 'department') return null
  if (!scopeHasCapability(scope, 'referral:create')) {
    return 'Your role does not raise referrals. Ask the referral desk or a department coordinator.'
  }
  if (!referralPolicyAllows(scope.referralPolicy, 'department')) {
    return 'Your hospital has set referral initiation to hospital level only. Ask the referral desk to raise it.'
  }
  return null
}
