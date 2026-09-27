/**
 * The system console: the whole network from one place, for the people who run
 * the platform rather than one facility -- developers, the programme office and
 * the ministry. Every screen here is network-wide and super-administrator only.
 */

import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  Activity,
  Building2,
  KeyRound,
  Palette,
  ScrollText,
  Siren,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import { PageHeader, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'

const ConsoleOverview = lazy(() => import('./ConsoleOverview'))
const ConsoleHospitals = lazy(() => import('./ConsoleHospitals'))
const ConsoleUsers = lazy(() => import('./ConsoleUsers'))
const ConsoleSignIns = lazy(() => import('./ConsoleSignIns'))
const ConsoleCatalogue = lazy(() => import('./ConsoleCatalogue'))
const ScoringSettings = lazy(() => import('@/features/admin/ScoringSettings'))
const AppearanceSettings = lazy(() => import('@/features/admin/AppearanceSettings'))
const AuditLogViewer = lazy(() => import('@/features/admin/AuditLogViewer'))

const TABS = [
  { to: '/console', label: 'Overview', icon: Activity, end: true },
  { to: '/console/hospitals', label: 'Hospitals', icon: Building2 },
  { to: '/console/users', label: 'Users', icon: Users },
  { to: '/console/sign-ins', label: 'Sign-ins', icon: KeyRound },
  { to: '/console/catalogue', label: 'Emergency catalogue', icon: Siren },
  { to: '/console/scoring', label: 'Scoring', icon: SlidersHorizontal },
  { to: '/console/appearance', label: 'Appearance', icon: Palette },
  { to: '/console/audit', label: 'Audit log', icon: ScrollText },
] as const

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

export default function ConsolePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="System console"
        description="Every hospital, account and setting on the network. Changes here apply to everyone."
      />

      <nav
        aria-label="Console sections"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800 sm:mx-0 sm:px-0"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={'end' in tab ? tab.end : false}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )
            }
          >
            <tab.icon className="h-4 w-4" aria-hidden />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<TabFallback />}>
        <Routes>
          <Route index element={<ConsoleOverview />} />
          <Route path="hospitals" element={<ConsoleHospitals />} />
          <Route path="users" element={<ConsoleUsers />} />
          <Route path="sign-ins" element={<ConsoleSignIns />} />
          <Route path="catalogue" element={<ConsoleCatalogue />} />
          <Route path="scoring" element={<ScoringSettings />} />
          <Route path="appearance" element={<AppearanceSettings />} />
          <Route path="audit" element={<AuditLogViewer networkWide />} />
          <Route path="*" element={<Navigate to="/console" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}
