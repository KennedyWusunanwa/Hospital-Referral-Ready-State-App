import { lazy, Suspense } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ArrowRight, Building2, ClipboardList, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Gate } from '@/auth/RequireAuth'
import { Card, CardBody, PageHeader, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Capability } from '@/lib/constants'

const HospitalSettings = lazy(() => import('./HospitalSettings'))
const DepartmentManager = lazy(() => import('./DepartmentManager'))
const StaffManager = lazy(() => import('./StaffManager'))
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
        Not available for your role
      </p>
      <p className="mx-auto mt-1 max-w-md hint">
        Ask your hospital administrator if you believe you should have access to this section.
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
        title="Hospital administration"
        description={
          hospital
            ? `Settings, departments and staff for ${hospital.name}.`
            : 'Settings, departments and staff for your facility.'
        }
      />

      {can('admin:system') && (
        <Card className="border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/30">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck
                className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400"
                aria-hidden
              />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Network-wide settings live in the system console
                </p>
                <p className="mt-0.5 hint">
                  Every hospital, every account, sign-ins, the emergency catalogue, scoring,
                  branding and the full audit trail.
                </p>
              </div>
            </div>
            <Link
              to="/console"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Open the console
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </CardBody>
        </Card>
      )}

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
            path="audit"
            element={
              <Gate capability="audit:view" fallback={<NotPermitted />}>
                <AuditLogViewer />
              </Gate>
            }
          />
          {/* Network-wide settings moved to the console; old bookmarks still land. */}
          <Route path="scoring" element={<Navigate to="/console/scoring" replace />} />
          <Route path="appearance" element={<Navigate to="/console/appearance" replace />} />
          <Route path="*" element={<Navigate to="/admin/hospital" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}
