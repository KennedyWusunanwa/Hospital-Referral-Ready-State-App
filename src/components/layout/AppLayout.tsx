import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardCheck,
  Hospital as HospitalIcon,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Badge, Button, StatusDot } from '@/components/ui'
import { APP_NAME, APP_TAGLINE, ROLE_LABELS, type Capability } from '@/lib/constants'
import { useTheme } from '@/lib/theme'
import { cn, initials } from '@/lib/utils'
import {
  useNotificationRealtime,
  useUnreadNotificationCount,
} from '@/features/notifications/useNotifications'
import { useHospitalReadiness } from '@/features/readiness/useReadiness'
import { usePendingReferralCount } from '@/features/referrals/useReferrals'

interface NavItem {
  to: string
  label: string
  icon: typeof Activity
  capability?: Capability
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Activity, end: true },
  { to: '/readiness', label: 'Readiness', icon: ClipboardCheck, capability: 'readiness:view' },
  { to: '/referrals', label: 'Referrals', icon: Inbox, capability: 'referral:view' },
  { to: '/hospitals', label: 'Hospitals', icon: HospitalIcon, capability: 'readiness:view' },
  { to: '/reports', label: 'Reports', icon: BarChart3, capability: 'reports:view' },
  { to: '/admin', label: 'Administration', icon: Settings, capability: 'admin:hospital' },
]

export function AppLayout() {
  const { profile, hospital, role, signOut, can } = useAuth()
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Mounted here rather than on the notifications page: an incoming critical
  // referral has to reach whoever is signed in, wherever they are in the app.
  // The subscription is reference-counted, so the page can also subscribe.
  useNotificationRealtime()

  const unread = useUnreadNotificationCount()
  const pending = usePendingReferralCount(hospital?.id ?? null)
  const readiness = useHospitalReadiness(hospital?.id ?? null)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const visibleNav = NAV_ITEMS.filter((item) => !item.capability || can(item.capability))

  const navBody = (
    <nav className="flex flex-1 flex-col gap-0.5 p-3">
      {visibleNav.map((item) => {
        const Icon = item.icon
        const badge = item.to === '/referrals' ? pending.data : undefined
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              )
            }
          >
            <Icon className="h-4.5 w-4.5 shrink-0" style={{ width: 18, height: 18 }} aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {badge !== undefined && badge > 0 && (
              <Badge tone="danger">{badge > 99 ? '99+' : badge}</Badge>
            )}
          </NavLink>
        )
      })}
    </nav>
  )

  const brand = (
    <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
        {APP_NAME.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
          {APP_NAME}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{APP_TAGLINE}</p>
      </div>
    </div>
  )

  const footer = (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {initials(profile?.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {profile?.full_name ?? 'Signed in'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {role ? ROLE_LABELS[role] : ''}
          </p>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? 'Light' : 'Dark'}
        </Button>
        <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        {brand}
        {navBody}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="relative flex h-full w-72 flex-col bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="flex-1">{brand}</div>
              <button
                type="button"
                aria-label="Close navigation"
                className="mr-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navBody}
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 no-print">
          <button
            type="button"
            aria-label="Open navigation"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            {hospital ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                  {hospital.name}
                </span>
                {readiness.data && (
                  <StatusDot
                    status={readiness.data.status}
                    label={`${readiness.data.green}/${readiness.data.total} current`}
                    pulse
                  />
                )}
                {!hospital.accepts_referrals && <Badge tone="danger">Not accepting referrals</Badge>}
              </div>
            ) : (
              <span className="text-sm text-slate-500">All hospitals</span>
            )}
          </div>

          <NavLink
            to="/notifications"
            className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`}
          >
            <Bell className="h-5 w-5" />
            {(unread.data ?? 0) > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {(unread.data ?? 0) > 9 ? '9+' : unread.data}
              </span>
            )}
          </NavLink>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
