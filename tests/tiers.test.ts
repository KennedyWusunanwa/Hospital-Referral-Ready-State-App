import { describe, expect, it } from 'vitest'
import {
  GHANA_REGIONS,
  ROLE_CAPABILITIES,
  ROLE_TIERS,
  ROLE_TIER_OF,
  ROLES_BY_TIER,
  USER_ROLES,
  roleTierLabel,
} from '@/lib/constants'

describe('access tiers', () => {
  it('assigns every role to exactly one tier', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_TIERS).toContain(ROLE_TIER_OF[role])
    }
    const listed = ROLE_TIERS.flatMap((tier) => [...ROLES_BY_TIER[tier]])
    expect([...listed].sort()).toEqual([...USER_ROLES].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('keeps the system tier to the role that holds admin:system', () => {
    for (const role of USER_ROLES) {
      const capabilities: readonly string[] = ROLE_CAPABILITIES[role]
      const holdsSystem = capabilities.includes('admin:system')
      expect(ROLE_TIER_OF[role] === 'system').toBe(holdsSystem)
    }
  })

  it('puts the shift in-charge alone at department level', () => {
    expect(ROLES_BY_TIER.department).toEqual(['shift_in_charge'])
  })

  it('labels a role with its tier', () => {
    expect(roleTierLabel('hospital_admin')).toBe('Hospital · Hospital Administrator')
    expect(roleTierLabel('super_admin')).toBe('System · System Administrator')
  })
})

describe('regions', () => {
  it('lists the sixteen regions once each, alphabetically', () => {
    expect(GHANA_REGIONS).toHaveLength(16)
    expect(new Set(GHANA_REGIONS).size).toBe(16)
    expect([...GHANA_REGIONS]).toEqual([...GHANA_REGIONS].sort((a, b) => a.localeCompare(b)))
  })
})
