import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { SplashScreen } from '@/components/brand/SplashScreen'
import { Alert, Button, Card } from '@/components/ui'
import type { Capability } from '@/lib/constants'
import {
  canCreateReferral,
  canSubmitReadinessFor,
  referralPolicyNotice,
  type UserScope,
} from '@/lib/scope'

/**
 * Gate for every authenticated route.
 *
 * This is a UX affordance, not the security boundary -- row-level security in
 * Postgres is. A user who forges their way past this guard still cannot read a
 * row the database will not hand them.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading, profileError, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <SplashScreen label="Signing you in" />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (profileError || !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md p-6">
          <Alert tone="danger" title="Account not ready">
            {profileError ?? 'Your staff profile could not be loaded.'}
          </Alert>
          <Button variant="outline" className="mt-4" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </div>
    )
  }

  if (profile.must_change_password && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />
  }

  return <>{children}</>
}

/** The one refusal screen every guard shows, so a blocked page never looks broken. */
export function NotAllowedCard({
  title = 'Not available for your role',
  message = 'You do not have permission to open this page. If you believe this is wrong, ask your hospital administrator to review your role.',
}: {
  title?: string
  message?: string
}) {
  return (
    <Card className="mx-auto mt-10 max-w-md p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
      <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </Card>
  )
}

/** Wrap a route that only certain capabilities may open. */
export function RequireCapability({
  capability,
  children,
  fallback,
}: {
  capability: Capability
  children: ReactNode
  fallback?: ReactNode
}) {
  const { can, loading } = useAuth()

  if (loading) return <SplashScreen label="Loading" />

  if (!can(capability)) {
    return <>{fallback ?? <NotAllowedCard />}</>
  }

  return <>{children}</>
}

/**
 * Wrap a route whose answer depends on scope rather than capability alone:
 * "may this account act on THIS department", not "may this role act on any".
 */
export function RequireScope({
  allow,
  children,
  title,
  message,
}: {
  allow: (scope: UserScope) => boolean
  children: ReactNode
  title?: string
  message?: string
}) {
  const { scope, loading } = useAuth()
  if (loading) return <SplashScreen label="Loading" />
  if (!allow(scope)) return <NotAllowedCard title={title} message={message} />
  return <>{children}</>
}

/**
 * The readiness update form for `:departmentId`. A department-level account
 * may only open its own department's form; the database repeats the check when
 * the form is submitted, so a guessed address gets the same refusal both ways.
 */
export function RequireDepartmentAccess({ children }: { children: ReactNode }) {
  const { departmentId } = useParams<{ departmentId: string }>()
  return (
    <RequireScope
      allow={(scope) =>
        Boolean(departmentId) && canSubmitReadinessFor(scope, { id: departmentId! })
      }
      title="Not your department"
      message="You can only file readiness for the department assigned to your account. If you cover another unit as well, ask your hospital administrator to add it."
    >
      {children}
    </RequireScope>
  )
}

/** The new-referral wizard: role permission combined with the hospital's referral policy. */
export function RequireReferralCreate({ children }: { children: ReactNode }) {
  const { scope, loading } = useAuth()
  if (loading) return <SplashScreen label="Loading" />
  if (!canCreateReferral(scope)) {
    return (
      <NotAllowedCard
        title="Referrals are not raised from this account"
        message={
          referralPolicyNotice(scope) ??
          'Your role does not raise referrals. If you believe this is wrong, ask your hospital administrator to review your role.'
        }
      />
    )
  }
  return <>{children}</>
}

/** Renders children only when the current role holds the capability. */
export function Gate({
  capability,
  children,
  fallback = null,
}: {
  capability: Capability
  children: ReactNode
  fallback?: ReactNode
}) {
  const { can } = useAuth()
  return <>{can(capability) ? children : fallback}</>
}

/** Renders children only when the scope test passes. */
export function ScopeGate({
  allow,
  children,
  fallback = null,
}: {
  allow: (scope: UserScope) => boolean
  children: ReactNode
  fallback?: ReactNode
}) {
  const { scope } = useAuth()
  return <>{allow(scope) ? children : fallback}</>
}

/** Redirects an already-signed-in user away from the login screen. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <SplashScreen label="Checking your session" />
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }
  return <>{children}</>
}
