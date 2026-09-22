/**
 * Central TanStack Query key registry.
 *
 * Keeping every key in one place means an invalidation after a mutation can be
 * written against a namespace (`queryKeys.referrals.all`) instead of guessing
 * at an array literal that some other feature also has to match.
 */

export const queryKeys = {
  session: ['session'] as const,
  profile: (userId: string | undefined) => ['profile', userId] as const,

  hospitals: {
    all: ['hospitals'] as const,
    list: (filters?: Record<string, unknown>) => ['hospitals', 'list', filters ?? {}] as const,
    detail: (id: string) => ['hospitals', 'detail', id] as const,
    resources: (id: string) => ['hospitals', 'resources', id] as const,
    bloodStock: (id: string) => ['hospitals', 'blood-stock', id] as const,
  },

  departments: {
    all: ['departments'] as const,
    byHospital: (hospitalId: string) => ['departments', 'hospital', hospitalId] as const,
    readiness: (hospitalId: string) => ['departments', 'readiness', hospitalId] as const,
    detail: (id: string) => ['departments', 'detail', id] as const,
  },

  readiness: {
    all: ['readiness'] as const,
    history: (departmentId: string, days: number) =>
      ['readiness', 'history', departmentId, days] as const,
    currentShift: (departmentId: string) => ['readiness', 'current-shift', departmentId] as const,
  },

  emergencyTypes: {
    all: ['emergency-types'] as const,
    requirements: (emergencyTypeId: string) =>
      ['emergency-types', 'requirements', emergencyTypeId] as const,
  },

  referrals: {
    all: ['referrals'] as const,
    list: (filters?: Record<string, unknown>) => ['referrals', 'list', filters ?? {}] as const,
    detail: (id: string) => ['referrals', 'detail', id] as const,
    events: (id: string) => ['referrals', 'events', id] as const,
    candidates: (params: Record<string, unknown>) => ['referrals', 'candidates', params] as const,
    inbox: (hospitalId: string) => ['referrals', 'inbox', hospitalId] as const,
    outbox: (hospitalId: string) => ['referrals', 'outbox', hospitalId] as const,
  },

  messages: {
    byReferral: (referralId: string) => ['messages', referralId] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },

  reports: {
    analytics: (filters: Record<string, unknown>) => ['reports', 'analytics', filters] as const,
    performance: (filters: Record<string, unknown>) => ['reports', 'performance', filters] as const,
    compliance: (filters: Record<string, unknown>) => ['reports', 'compliance', filters] as const,
  },

  /** Branding is readable by anon, so it sits outside the admin namespace. */
  appSettings: ['app-settings'] as const,

  admin: {
    users: (hospitalId?: string | null) => ['admin', 'users', hospitalId ?? 'all'] as const,
    invites: (hospitalId?: string | null) => ['admin', 'invites', hospitalId ?? 'all'] as const,
    auditLogs: (filters: Record<string, unknown>) => ['admin', 'audit-logs', filters] as const,
    scoringConfig: ['admin', 'scoring-config'] as const,
  },
} as const
