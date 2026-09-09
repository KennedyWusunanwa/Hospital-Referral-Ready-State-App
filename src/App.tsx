import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RedirectIfAuthenticated, RequireCapability } from '@/auth/RequireAuth'
import { Spinner } from '@/components/ui'

const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))

const ReadinessPage = lazy(() => import('@/features/readiness/ReadinessPage'))
const ReadinessUpdatePage = lazy(() => import('@/features/readiness/ReadinessUpdatePage'))

const ReferralListPage = lazy(() => import('@/features/referrals/ReferralListPage'))
const NewReferralPage = lazy(() => import('@/features/referrals/NewReferralPage'))
const ReferralDetailPage = lazy(() => import('@/features/referrals/ReferralDetailPage'))
const ReferralFormPrintPage = lazy(() => import('@/features/referrals/ReferralFormPrintPage'))

const HospitalListPage = lazy(() => import('@/features/hospitals/HospitalListPage'))
const HospitalDetailPage = lazy(() => import('@/features/hospitals/HospitalDetailPage'))

const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))

const AdminPage = lazy(() => import('@/features/admin/AdminPage'))
const NotFoundPage = lazy(() => import('@/features/misc/NotFoundPage'))

function PageFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center py-20">
      <Spinner className="h-7 w-7" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />

          <Route
            path="readiness"
            element={
              <RequireCapability capability="readiness:view">
                <ReadinessPage />
              </RequireCapability>
            }
          />
          <Route
            path="readiness/:departmentId"
            element={
              <RequireCapability capability="readiness:submit">
                <ReadinessUpdatePage />
              </RequireCapability>
            }
          />

          <Route
            path="referrals"
            element={
              <RequireCapability capability="referral:view">
                <ReferralListPage />
              </RequireCapability>
            }
          />
          <Route
            path="referrals/new"
            element={
              <RequireCapability capability="referral:create">
                <NewReferralPage />
              </RequireCapability>
            }
          />
          <Route
            path="referrals/:referralId"
            element={
              <RequireCapability capability="referral:view">
                <ReferralDetailPage />
              </RequireCapability>
            }
          />

          <Route
            path="hospitals"
            element={
              <RequireCapability capability="readiness:view">
                <HospitalListPage />
              </RequireCapability>
            }
          />
          <Route
            path="hospitals/:hospitalId"
            element={
              <RequireCapability capability="readiness:view">
                <HospitalDetailPage />
              </RequireCapability>
            }
          />

          <Route
            path="reports"
            element={
              <RequireCapability capability="reports:view">
                <ReportsPage />
              </RequireCapability>
            }
          />

          <Route path="notifications" element={<NotificationsPage />} />

          <Route
            path="admin/*"
            element={
              <RequireCapability capability="admin:hospital">
                <AdminPage />
              </RequireCapability>
            }
          />

          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Route>

        {/* Printable referral form renders outside the app chrome. */}
        <Route
          path="/referrals/:referralId/form"
          element={
            <RequireAuth>
              <ReferralFormPrintPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  )
}
