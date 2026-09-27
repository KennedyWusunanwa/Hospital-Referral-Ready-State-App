import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RedirectIfAuthenticated, RequireCapability } from '@/auth/RequireAuth'
import { SplashScreen } from '@/components/brand/SplashScreen'
import { Card, Spinner } from '@/components/ui'
import {
  DashboardSkeleton,
  DetailPageSkeleton,
  FormPageSkeleton,
  ListPageSkeleton,
  ListSkeleton,
  NotificationsSkeleton,
  PageHeaderSkeleton,
  ReportsSkeleton,
  StatGridSkeleton,
  TabbedPageSkeleton,
} from '@/components/ui/skeletons'

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
const ConsolePage = lazy(() => import('@/features/console/ConsolePage'))
const NotFoundPage = lazy(() => import('@/features/misc/NotFoundPage'))

function PageFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center py-20">
      <Spinner className="h-7 w-7" />
    </div>
  )
}

function ReadinessSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading readiness"
      className="space-y-5 animate-fade-in"
    >
      <PageHeaderSkeleton />
      <StatGridSkeleton count={4} />
      <Card className="p-5">
        <ListSkeleton rows={6} dense />
      </Card>
    </div>
  )
}

/**
 * Each page downloads on first use and paints its own outline while it does,
 * so the shell never collapses to a single spinner between screens.
 */
function Screen({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}

export default function App() {
  return (
    <Suspense fallback={<SplashScreen />}>
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
          <Route
            index
            element={
              <Screen fallback={<DashboardSkeleton />}>
                <DashboardPage />
              </Screen>
            }
          />

          <Route
            path="readiness"
            element={
              <RequireCapability capability="readiness:view">
                <Screen fallback={<ReadinessSkeleton />}>
                  <ReadinessPage />
                </Screen>
              </RequireCapability>
            }
          />
          <Route
            path="readiness/:departmentId"
            element={
              <RequireCapability capability="readiness:submit">
                <Screen fallback={<FormPageSkeleton />}>
                  <ReadinessUpdatePage />
                </Screen>
              </RequireCapability>
            }
          />

          <Route
            path="referrals"
            element={
              <RequireCapability capability="referral:view">
                <Screen fallback={<ListPageSkeleton view="list" filters={3} />}>
                  <ReferralListPage />
                </Screen>
              </RequireCapability>
            }
          />
          <Route
            path="referrals/new"
            element={
              <RequireCapability capability="referral:create">
                <Screen fallback={<FormPageSkeleton steps />}>
                  <NewReferralPage />
                </Screen>
              </RequireCapability>
            }
          />
          <Route
            path="referrals/:referralId"
            element={
              <RequireCapability capability="referral:view">
                <Screen fallback={<DetailPageSkeleton />}>
                  <ReferralDetailPage />
                </Screen>
              </RequireCapability>
            }
          />

          <Route
            path="hospitals"
            element={
              <RequireCapability capability="readiness:view">
                <Screen fallback={<ListPageSkeleton view="cards" filters={5} />}>
                  <HospitalListPage />
                </Screen>
              </RequireCapability>
            }
          />
          <Route
            path="hospitals/:hospitalId"
            element={
              <RequireCapability capability="readiness:view">
                <Screen fallback={<DetailPageSkeleton />}>
                  <HospitalDetailPage />
                </Screen>
              </RequireCapability>
            }
          />

          <Route
            path="reports"
            element={
              <RequireCapability capability="reports:view">
                <Screen fallback={<ReportsSkeleton />}>
                  <ReportsPage />
                </Screen>
              </RequireCapability>
            }
          />

          <Route
            path="notifications"
            element={
              <Screen fallback={<NotificationsSkeleton />}>
                <NotificationsPage />
              </Screen>
            }
          />

          <Route
            path="admin/*"
            element={
              <RequireCapability capability="admin:hospital">
                <Screen fallback={<TabbedPageSkeleton view="form" />}>
                  <AdminPage />
                </Screen>
              </RequireCapability>
            }
          />
          <Route
            path="console/*"
            element={
              <RequireCapability capability="admin:system">
                <Screen fallback={<TabbedPageSkeleton view="stats" />}>
                  <ConsolePage />
                </Screen>
              </RequireCapability>
            }
          />

          <Route
            path="404"
            element={
              <Screen fallback={<PageFallback />}>
                <NotFoundPage />
              </Screen>
            }
          />
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
