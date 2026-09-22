import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import type { Capability } from '@/lib/constants'

function FullScreenLoader() {
  return (
    <div className="flex h-full min-h-dvh items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

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

  if (loading) return <FullScreenLoader />

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

  if (loading) return <FullScreenLoader />

  if (!can(capability)) {
    return (
      <>
        {fallback ?? (
          <Card className="mx-auto mt-10 max-w-md p-8 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
            <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
              Not available for your role
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              You do not have permission to open this page. If you believe this is wrong, ask your
              hospital administrator to review your role.
            </p>
          </Card>
        )}
      </>
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

/** Redirects an already-signed-in user away from the login screen. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }
  return <>{children}</>
}
