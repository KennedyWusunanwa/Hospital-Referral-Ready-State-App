import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Building2, ClipboardList, ScrollText, SlidersHorizontal, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Gate } from '@/auth/RequireAuth'
import { Card, PageHeader, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Capability } from '@/lib/constants'

const HospitalSettings = lazy(() => import('./HospitalSettings'))
const DepartmentManager = lazy(() => import('./DepartmentManager'))
const StaffManager = lazy(() => import('./StaffManager'))
const ScoringSettings = lazy(() => import('./ScoringSettings'))
const AuditLogViewer = lazy(() => import('./AuditLogViewer'))

interface AdminTab {
  to: string
  label: string
  icon: typeof Building2
  capability?: Capability
}

const TABS: AdminTab[] = [
  { to: '/admin/hospital', label: 'Hospital', icon: Building2 },
  { to: '/admin/departments', label: 'Departments', icon: ClipboardList },
  { to: '/admin/staff', label: 'Staff', icon: Users },
  { to: '/admin/scoring', label: 'Scoring', icon: SlidersHorizontal, capability: 'admin:system' },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText, capability: 'audit:view' },
]

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

/** Shown instead of a screen the current role may not open. */
function NotPermitted() {
  return (
    <Card className="p-8 text-center">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Restricted to system administrators
      </p>
      <p className="mx-auto mt-1 max-w-md hint">
        These settings change how referrals are ranked for every hospital on the network, so they
        are only editable by a system administrator.
      </p>
    </Card>
  )
}

export default function AdminPage() {
  const { can, hospital } = useAuth()
  const tabs = TABS.filter((tab) => !tab.capability || can(tab.capability))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration"
        description={
          hospital
            ? `Settings, departments and staff for ${hospital.name}.`
            : 'Settings, departments and staff.'
        }
      />

      <nav
        aria-label="Administration sections"
        className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
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
          <Route index element={<Navigate to="/admin/hospital" replace />} />
          <Route path="hospital" element={<HospitalSettings />} />
          <Route path="departments" element={<DepartmentManager />} />
          <Route path="staff" element={<StaffManager />} />
          <Route
            path="scoring"
            element={
              <Gate capability="admin:system" fallback={<NotPermitted />}>
                <ScoringSettings />
              </Gate>
            }
          />
          <Route
            path="audit"
            element={
              <Gate capability="audit:view" fallback={<NotPermitted />}>
                <AuditLogViewer />
              </Gate>
            }
          />
          <Route path="*" element={<Navigate to="/admin/hospital" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}
