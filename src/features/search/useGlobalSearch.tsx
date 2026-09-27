/**
 * The data behind the command palette.
 *
 * Local sources (pages, the hospital directory, the user's own departments)
 * are matched in memory so they answer on the first keystroke. Referrals and
 * people are looked up server-side once there are two characters to go on,
 * because both tables are scoped by row-level security and can be large.
 */

import { useMemo, type ReactNode } from 'react'
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardCheck,
  Hospital as HospitalIcon,
  Inbox,
  LogOut,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar, Badge } from '@/components/ui'
import { useStaffSearch } from '@/features/admin/useAdmin'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { useHospitals } from '@/features/hospitals/useHospitals'
import { useDepartments } from '@/features/readiness/useReadiness'
import { ReferralStatusBadge } from '@/features/referrals/ReferralStatusBadge'
import { useReferralSearch } from '@/features/referrals/useReferrals'
import {
  DEPARTMENT_TEMPLATES,
  HOSPITAL_LEVEL_LABELS,
  ROLE_LABELS,
  type Capability,
} from '@/lib/constants'
import { useTheme } from '@/lib/theme'
import { matchRank, matchesQuery } from '@/lib/textMatch'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export interface SearchItem {
  id: string
  title: string
  subtitle?: string
  icon?: ReactNode
  trailing?: ReactNode
  /** Navigate here on select. */
  to?: string
  /** Or run this instead. */
  run?: () => void
  /** Extra words the item should match on. */
  keywords?: string
}

export interface SearchGroup {
  key: string
  label: string
  items: SearchItem[]
}

interface PageEntry {
  id: string
  title: string
  subtitle: string
  to: string
  icon: ReactNode
  keywords: string
  capability?: Capability
  requiresHospital?: boolean
}

const PAGES: PageEntry[] = [
  {
    id: 'page:dashboard',
    title: 'Dashboard',
    subtitle: 'What needs you right now',
    to: '/',
    icon: <Activity className="h-4 w-4" aria-hidden />,
    keywords: 'home overview',
  },
  {
    id: 'page:readiness',
    title: 'Readiness board',
    subtitle: 'Department traffic lights for this shift',
    to: '/readiness',
    icon: <ClipboardCheck className="h-4 w-4" aria-hidden />,
    keywords: 'shift update green yellow red departments',
    capability: 'readiness:view',
  },
  {
    id: 'page:new-referral',
    title: 'New referral',
    subtitle: 'Rank receiving hospitals for a patient',
    to: '/referrals/new',
    icon: <Plus className="h-4 w-4" aria-hidden />,
    keywords: 'refer transfer patient send',
    capability: 'referral:create',
    requiresHospital: true,
  },
  {
    id: 'page:referrals',
    title: 'Referrals',
    subtitle: 'Incoming and outgoing transfer requests',
    to: '/referrals',
    icon: <Inbox className="h-4 w-4" aria-hidden />,
    keywords: 'inbox outbox transfers',
    capability: 'referral:view',
  },
  {
    id: 'page:hospitals',
    title: 'Hospital directory',
    subtitle: 'Every facility on the network',
    to: '/hospitals',
    icon: <HospitalIcon className="h-4 w-4" aria-hidden />,
    keywords: 'facilities directory map',
    capability: 'readiness:view',
  },
  {
    id: 'page:reports',
    title: 'Reports',
    subtitle: 'Referral outcomes, response times, compliance',
    to: '/reports',
    icon: <BarChart3 className="h-4 w-4" aria-hidden />,
    keywords: 'analytics statistics export csv',
    capability: 'reports:view',
  },
  {
    id: 'page:notifications',
    title: 'Notifications',
    subtitle: 'Alerts addressed to you',
    to: '/notifications',
    icon: <Bell className="h-4 w-4" aria-hidden />,
    keywords: 'alerts inbox unread',
  },
  {
    id: 'page:admin',
    title: 'Administration',
    subtitle: 'Your hospital, departments and staff',
    to: '/admin',
    icon: <Settings className="h-4 w-4" aria-hidden />,
    keywords: 'settings staff departments invite',
    capability: 'admin:hospital',
    requiresHospital: true,
  },
  {
    id: 'page:admin-staff',
    title: 'Staff and invitations',
    subtitle: 'Accounts at your hospital',
    to: '/admin/staff',
    icon: <Users className="h-4 w-4" aria-hidden />,
    keywords: 'users people invite roles',
    capability: 'admin:hospital',
    requiresHospital: true,
  },
  {
    id: 'page:console',
    title: 'System console',
    subtitle: 'Network-wide administration',
    to: '/console',
    icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
    keywords: 'platform developer moderate stats sign-ins users hospitals catalogue',
    capability: 'admin:system',
  },
  {
    id: 'page:console-users',
    title: 'All users',
    subtitle: 'Every account across the network',
    to: '/console/users',
    icon: <Users className="h-4 w-4" aria-hidden />,
    keywords: 'accounts people roles deactivate',
    capability: 'admin:system',
  },
  {
    id: 'page:console-signins',
    title: 'Sign-ins',
    subtitle: 'Who signed in, when and from where',
    to: '/console/sign-ins',
    icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
    keywords: 'logins sessions audit security',
    capability: 'admin:system',
  },
]

const RECENT_KEY = 'fern.search-recent'
const RECENT_LIMIT = 6

export interface RecentItem {
  id: string
  title: string
  subtitle?: string
  to: string
}

export function readRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is RecentItem =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RecentItem).id === 'string' &&
        typeof (entry as RecentItem).title === 'string' &&
        typeof (entry as RecentItem).to === 'string',
    )
  } catch {
    return []
  }
}

export function rememberRecent(item: RecentItem): void {
  try {
    const next = [item, ...readRecent().filter((entry) => entry.id !== item.id)].slice(
      0,
      RECENT_LIMIT,
    )
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Blocked storage only costs the "recent" list.
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // Nothing to do.
  }
}

export interface GlobalSearchResult {
  groups: SearchGroup[]
  /** True while a server-side lookup is still in flight. */
  loading: boolean
  empty: boolean
}

/** `revision` bumps when the recent list changes, so an empty query re-reads it. */
export function useGlobalSearch(term: string, open: boolean, revision = 0): GlobalSearchResult {
  const { can, hospital, signOut } = useAuth()
  const { theme, toggle } = useTheme()
  const query = term.trim()
  const debounced = useDebouncedValue(query, 150)
  const canSeePeople = can('admin:hospital')

  const hospitals = useHospitals({ onlyActive: false, enabled: open })
  const departments = useDepartments(open ? (hospital?.id ?? null) : null)
  const referrals = useReferralSearch(open ? debounced : '')
  const people = useStaffSearch(open ? debounced : '', canSeePeople)

  const groups = useMemo<SearchGroup[]>(() => {
    const result: SearchGroup[] = []

    if (!query) {
      const recent = readRecent()
      if (recent.length > 0) {
        result.push({
          key: 'recent',
          label: 'Recent',
          items: recent.map((entry) => ({ ...entry })),
        })
      }
    }

    const pages = PAGES.filter(
      (page) =>
        (!page.capability || can(page.capability)) &&
        (!page.requiresHospital || Boolean(hospital)) &&
        matchesQuery(`${page.title} ${page.subtitle} ${page.keywords}`, query),
    )
      .sort((a, b) => matchRank(a.title, query) - matchRank(b.title, query))
      .slice(0, query ? 6 : 5)
    if (pages.length > 0) {
      result.push({
        key: 'pages',
        label: query ? 'Pages' : 'Go to',
        items: pages.map((page) => ({
          id: page.id,
          title: page.title,
          subtitle: page.subtitle,
          icon: page.icon,
          to: page.to,
        })),
      })
    }

    if (query) {
      const facilities = (hospitals.data ?? [])
        .filter((row) =>
          matchesQuery(
            `${row.name} ${row.code} ${row.city ?? ''} ${row.region ?? ''} ${HOSPITAL_LEVEL_LABELS[row.level] ?? ''}`,
            query,
          ),
        )
        .sort((a, b) => matchRank(a.name, query) - matchRank(b.name, query))
        .slice(0, 6)
      if (facilities.length > 0) {
        result.push({
          key: 'hospitals',
          label: 'Hospitals',
          items: facilities.map((row) => ({
            id: `hospital:${row.id}`,
            title: row.name,
            subtitle: [row.code, HOSPITAL_LEVEL_LABELS[row.level], row.city]
              .filter(Boolean)
              .join(' · '),
            icon: <HospitalLogo hospital={row} size="sm" />,
            trailing: !row.is_active ? (
              <Badge tone="neutral">Inactive</Badge>
            ) : !row.accepts_referrals ? (
              <Badge tone="danger">Diverting</Badge>
            ) : undefined,
            to: `/hospitals/${row.id}`,
          })),
        })
      }

      const units = (departments.data ?? [])
        .filter((row) =>
          matchesQuery(
            `${row.name} ${DEPARTMENT_TEMPLATES[row.template_key]?.label ?? ''} department`,
            query,
          ),
        )
        .slice(0, 5)
      if (units.length > 0) {
        result.push({
          key: 'departments',
          label: 'Your departments',
          items: units.map((row) => ({
            id: `department:${row.id}`,
            title: row.name,
            subtitle: DEPARTMENT_TEMPLATES[row.template_key]?.label ?? 'Department',
            icon: <ClipboardCheck className="h-4 w-4" aria-hidden />,
            to: can('readiness:submit') ? `/readiness/${row.id}` : '/readiness',
          })),
        })
      }

      const hits = referrals.data ?? []
      if (hits.length > 0) {
        result.push({
          key: 'referrals',
          label: 'Referrals',
          items: hits.map((row) => {
            const from = row.requesting_hospital?.name ?? 'Unknown'
            const to = row.receiving_hospital?.name ?? 'Unassigned'
            return {
              id: `referral:${row.id}`,
              title: row.reference_number,
              subtitle: `${row.patient_ref} · ${from} → ${to}`,
              icon: <Inbox className="h-4 w-4" aria-hidden />,
              trailing: <ReferralStatusBadge status={row.status} />,
              to: `/referrals/${row.id}`,
            }
          }),
        })
      }

      const staff = people.data ?? []
      if (canSeePeople && staff.length > 0) {
        const target = can('admin:system') ? '/console/users' : '/admin/staff'
        result.push({
          key: 'people',
          label: 'People',
          items: staff.map((row) => ({
            id: `person:${row.id}`,
            title: row.full_name || row.email,
            subtitle: `${row.email} · ${ROLE_LABELS[row.role] ?? row.role}${row.is_active ? '' : ' · deactivated'}`,
            icon: <Avatar name={row.full_name} size="sm" />,
            to: `${target}?q=${encodeURIComponent(row.email)}`,
          })),
        })
      }
    }

    const actions: SearchItem[] = [
      {
        id: 'action:theme',
        title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        subtitle: 'Applies to this device only',
        icon:
          theme === 'dark' ? (
            <Sun className="h-4 w-4" aria-hidden />
          ) : (
            <Moon className="h-4 w-4" aria-hidden />
          ),
        keywords: 'appearance dark light mode theme',
        run: toggle,
      },
      {
        id: 'action:sign-out',
        title: 'Sign out',
        icon: <LogOut className="h-4 w-4" aria-hidden />,
        keywords: 'logout leave',
        run: () => void signOut(),
      },
    ].filter((action) => matchesQuery(`${action.title} ${action.keywords ?? ''}`, query))
    if (actions.length > 0 && (query || result.length > 0)) {
      result.push({ key: 'actions', label: 'Actions', items: actions })
    }

    return result
  }, [
    query,
    can,
    hospital,
    hospitals.data,
    departments.data,
    referrals.data,
    people.data,
    canSeePeople,
    theme,
    toggle,
    signOut,
    revision,
  ])

  const loading =
    query.length >= 2 && (referrals.isFetching || people.isFetching || query !== debounced)

  return { groups, loading, empty: groups.length === 0 }
}
