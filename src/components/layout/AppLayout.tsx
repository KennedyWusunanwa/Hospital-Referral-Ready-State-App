import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardCheck,
  Download,
  Hospital as HospitalIcon,
  Inbox,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  MoreHorizontal,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { BrandLogo } from '@/components/brand/BrandLogo'
import {
  Avatar,
  Badge,
  Button,
  IconButton,
  Kbd,
  SegmentedControl,
  StatusDot,
} from '@/components/ui'
import { ROLE_LABELS, ROLE_TIER_LABELS, ROLE_TIER_OF, type Capability } from '@/lib/constants'
import { useBranding } from '@/features/branding/useBranding'
import { HospitalLogo } from '@/features/hospitals/HospitalLogo'
import { CommandPalette, isApplePlatform } from '@/features/search/CommandPalette'
import { useInstallPrompt } from '@/lib/installPrompt'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import {
  useNotificationRealtime,
  useUnreadNotificationCount,
} from '@/features/notifications/useNotifications'
import { useHospitalReadiness } from '@/features/readiness/useReadiness'
import { usePendingReferralCount } from '@/features/referrals/useReferrals'

interface NavItem {
  to: string
  label: string
  /** Shorter label for the mobile tab bar, where ~72px is all there is. */
  shortLabel?: string
  icon: typeof Activity
  capability?: Capability
  /** Hidden for accounts with no home facility (a system administrator, typically). */
  requiresHospital?: boolean
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', shortLabel: 'Home', icon: Activity, end: true },
  { to: '/readiness', label: 'Readiness', icon: ClipboardCheck, capability: 'readiness:view' },
  { to: '/referrals', label: 'Referrals', icon: Inbox, capability: 'referral:view' },
  { to: '/hospitals', label: 'Hospitals', icon: HospitalIcon, capability: 'readiness:view' },
  { to: '/reports', label: 'Reports', icon: BarChart3, capability: 'reports:view' },
  {
    to: '/admin',
    label: 'Administration',
    shortLabel: 'Admin',
    icon: Settings,
    capability: 'admin:hospital',
    requiresHospital: true,
  },
  {
    to: '/console',
    label: 'System console',
    shortLabel: 'Console',
    icon: ShieldCheck,
    capability: 'admin:system',
  },
]

/** How many destinations fit in the phone tab bar before the "More" tab. */
const BOTTOM_NAV_SLOTS = 4

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: typeof Sun
}> = [
  { value: 'system', label: 'Follow the device', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

// ---------------------------------------------------------------------------
// Behaviour hooks
// ---------------------------------------------------------------------------

/** Freezes the page behind a drawer or sheet, restoring the prior value after. */
function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [active])
}

/**
 * Keeps Tab cycling inside the drawer, closes on Escape, and hands focus back
 * to whatever opened it. Without this a keyboard or screen-reader user tabs
 * straight out of an open drawer into the page behind it.
 */
function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    const opener = document.activeElement as HTMLElement | null
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
      )

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus?.()
    }
  }, [ref, active, onClose])
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[role="dialog"]') !== null
  )
}

/** Ctrl/⌘+K anywhere, or "/" when no field has focus, opens the palette. */
function useSearchShortcut(open: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open()
        return
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target)) return
        event.preventDefault()
        open()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
}

// ---------------------------------------------------------------------------
// Global activity
// ---------------------------------------------------------------------------

/**
 * A thin bar under the top edge while a screen is waiting on its first data or
 * a save is in flight. Background refreshes do not show it: a poll every
 * minute must not make the app look permanently busy.
 */
function GlobalLoadingBar() {
  const fetching = useIsFetching({ predicate: (query) => query.state.status === 'pending' })
  const mutating = useIsMutating()
  const busy = fetching + mutating > 0
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!busy) {
      setVisible(false)
      return
    }
    // Anything that answers within a beat needs no indicator at all.
    const timer = window.setTimeout(() => setVisible(true), 250)
    return () => window.clearTimeout(timer)
  }, [busy])

  if (!visible) return null

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-valuetext="Loading"
      className="pointer-events-none fixed inset-x-0 z-[45] h-0.5 overflow-hidden bg-brand-100/70 no-print dark:bg-brand-950/70"
      style={{ top: 'var(--titlebar-h, 0px)' }}
    >
      <div className="h-full w-1/4 rounded-full bg-brand-600 animate-loading-bar dark:bg-brand-400" />
    </div>
  )
}

/**
 * The strip the installed desktop app draws inside the window's title bar
 * (window-controls-overlay). Hidden everywhere else by CSS.
 */
function WindowTitleBar({ hospitalName }: { hospitalName: string | null }) {
  const { appName } = useBranding()
  return (
    <div
      className="wco-titlebar items-center gap-2 border-b border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      aria-hidden
    >
      <BrandLogo kind="mark" className="h-4 w-4" decorative />
      <span>{appName}</span>
      {hospitalName && <span className="truncate text-slate-400">· {hospitalName}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar pieces
// ---------------------------------------------------------------------------

/**
 * Logo and tagline. Shared by the desktop sidebar and the mobile drawer so the
 * two cannot drift apart. The wordmark carries the name, so only the tagline
 * is printed as text.
 */
function BrandIdentity() {
  const { appTagline } = useBranding()
  return (
    <Link to="/" className="flex min-w-0 flex-col gap-1 rounded-lg" aria-label="Dashboard">
      <BrandLogo className="h-8 w-auto max-w-[9.5rem]" />
      <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {appTagline}
      </span>
    </Link>
  )
}

function Brand() {
  return (
    <div className="flex h-[4.25rem] shrink-0 items-center border-b border-slate-200 px-4 dark:border-slate-800">
      <BrandIdentity />
    </div>
  )
}

function NavList({ items, pendingCount }: { items: NavItem[]; pendingCount?: number }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-none-y scrollbar-slim p-3">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon
          const badge = item.to === '/referrals' ? pendingCount : undefined
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'tap-target group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Colour alone should not carry the active state. */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full transition-all',
                        isActive ? 'bg-brand-600 dark:bg-brand-400' : 'bg-transparent',
                      )}
                    />
                    <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== undefined && badge > 0 && (
                      <Badge tone="danger">{badge > 99 ? '99+' : badge}</Badge>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function ThemeSwitch() {
  const { preference, setPreference } = useTheme()
  return (
    <SegmentedControl
      size="sm"
      ariaLabel="Theme"
      value={preference}
      onChange={setPreference}
      className="w-full justify-between [&>button]:flex-1 [&>button]:justify-center"
      options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <>
            <Icon className="h-4 w-4" aria-hidden />
            <span className="sr-only">{label}</span>
          </>
        ),
      }))}
    />
  )
}

/** Offered wherever the browser can install the app, and explained on iOS. */
function InstallButton() {
  const { appName } = useBranding()
  const { canInstall, needsManualInstall, install } = useInstallPrompt()
  if (!canInstall && !needsManualInstall) return null

  const onClick = async () => {
    if (canInstall) {
      const outcome = await install()
      if (outcome === 'accepted') toast.success(`${appName} is being installed`)
      return
    }
    toast(`Add ${appName} to your Home Screen`, {
      description: 'Tap the Share button in Safari, then choose "Add to Home Screen".',
    })
  }

  return (
    <Button variant="outline" size="sm" fullWidth className="mb-1.5" onClick={() => void onClick()}>
      <Download className="h-4 w-4" aria-hidden />
      Install app
    </Button>
  )
}

function SidebarFooter() {
  const { profile, role, signOut } = useAuth()
  const tier = role ? ROLE_TIER_LABELS[ROLE_TIER_OF[role]] : null

  return (
    <div className="shrink-0 border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
        <Avatar name={profile?.full_name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {profile?.full_name ?? 'Signed in'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {role ? `${tier} · ${ROLE_LABELS[role]}` : ''}
          </p>
        </div>
      </div>
      <InstallButton />
      <div className="mt-1 flex items-center gap-1.5">
        <ThemeSwitch />
        <IconButton
          label="Sign out"
          onClick={() => void signOut()}
          className="h-9 w-9 min-h-0 min-w-0"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

function MobileDrawer({
  open,
  onClose,
  items,
  pendingCount,
}: {
  open: boolean
  onClose: () => void
  items: NavItem[]
  pendingCount?: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useBodyScrollLock(open)
  useFocusTrap(panelRef, open, onClose)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
    >
      <div
        className="absolute inset-0 bg-slate-900/60 animate-overlay-in backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        className="relative flex h-full w-[min(19rem,85vw)] flex-col bg-white pt-[var(--titlebar-h)] shadow-2xl animate-drawer-in dark:bg-slate-900"
      >
        <div className="flex h-[4.25rem] shrink-0 items-center gap-2.5 border-b border-slate-200 pl-4 pr-2 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <BrandIdentity />
          </div>
          <IconButton label="Close navigation" onClick={onClose}>
            <X className="h-5 w-5" aria-hidden />
          </IconButton>
        </div>

        <NavList items={items} pendingCount={pendingCount} />
        <SidebarFooter />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phone tab bar
// ---------------------------------------------------------------------------

function BottomNav({
  items,
  pendingCount,
  onMore,
  moreActive,
}: {
  items: NavItem[]
  pendingCount?: number
  onMore: () => void
  moreActive: boolean
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-safe-b backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-900/95 no-print"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = item.icon
          const badge = item.to === '/referrals' ? pendingCount : undefined
          return (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
                    isActive
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-slate-500 dark:text-slate-400',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon className="h-5 w-5" aria-hidden />
                      {badge !== undefined && badge > 0 && (
                        <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                          {badge > 9 ? '9+' : badge}
                        </span>
                      )}
                    </span>
                    <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-x-3 top-0 h-0.5 rounded-b-full transition-colors',
                        isActive ? 'bg-brand-600 dark:bg-brand-400' : 'bg-transparent',
                      )}
                    />
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
        <li className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreActive}
            aria-haspopup="dialog"
            className={cn(
              'flex h-16 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors',
              moreActive
                ? 'text-brand-700 dark:text-brand-300'
                : 'text-slate-500 dark:text-slate-400',
            )}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function AppLayout() {
  const { hospital, can } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  // Mounted here rather than on the notifications page: an incoming critical
  // referral has to reach whoever is signed in, wherever they are in the app.
  // The subscription is reference-counted, so the page can also subscribe.
  useNotificationRealtime()

  const unread = useUnreadNotificationCount()
  const pending = usePendingReferralCount(hospital?.id ?? null)
  const readiness = useHospitalReadiness(hospital?.id ?? null)

  useEffect(() => {
    setDrawerOpen(false)
    setPaletteOpen(false)
  }, [location.pathname])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useSearchShortcut(openPalette)

  const visibleNav = NAV_ITEMS.filter(
    (item) =>
      (!item.capability || can(item.capability)) && (!item.requiresHospital || Boolean(hospital)),
  )
  const bottomNav = visibleNav.slice(0, BOTTOM_NAV_SLOTS)
  const unreadCount = unread.data ?? 0
  const shortcut = isApplePlatform() ? '⌘K' : 'Ctrl K'

  return (
    <div className="min-h-dvh bg-slate-50 pt-[var(--titlebar-h)] dark:bg-slate-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg"
      >
        Skip to content
      </a>

      <WindowTitleBar hospitalName={hospital?.name ?? null} />
      <GlobalLoadingBar />

      {/*
        Fixed rather than sticky. A sticky sidebar only stays put while its
        containing block is taller than it is, which made it dependent on the
        rest of the shell; fixed pins it to the viewport unconditionally. The
        content column is inset by the same width instead.
      */}
      <aside className="fixed bottom-0 left-0 top-[var(--titlebar-h)] z-40 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900 no-print">
        <Brand />
        <NavList items={visibleNav} pendingCount={pending.data} />
        <SidebarFooter />
      </aside>

      <MobileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        items={visibleNav}
        pendingCount={pending.data}
      />

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-[var(--titlebar-h)] z-30 border-b border-slate-200 bg-white/90 pt-safe-t backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 no-print">
          <div className="flex h-14 items-center gap-2 px-gutter">
            {/* Phones reach the full nav through the tab bar's More tab, so
                the hamburger is only needed at tablet widths. */}
            <IconButton
              label="Open navigation"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className="-ml-2 hidden md:grid lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon className="h-5 w-5" aria-hidden />
            </IconButton>

            <div className="min-w-0 flex-1">
              {hospital ? (
                <div className="flex min-w-0 items-center gap-2.5">
                  <HospitalLogo hospital={hospital} size="sm" className="hidden xs:inline-flex" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {hospital.name}
                      </span>
                      {!hospital.accepts_referrals && (
                        <Badge tone="danger" className="hidden sm:inline-flex">
                          Not accepting referrals
                        </Badge>
                      )}
                    </div>
                    {readiness.data && (
                      <StatusDot
                        status={readiness.data.status}
                        label={`${readiness.data.green}/${readiness.data.total} departments current`}
                        pulse
                        className="hidden xs:inline-flex"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">
                    Network-wide view
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openPalette}
              aria-label={`Search (${shortcut})`}
              aria-keyshortcuts="Control+K Meta+K"
              className="hidden h-9 w-60 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white md:flex xl:w-72 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate text-left">Search hospitals, referrals…</span>
              <Kbd>{shortcut}</Kbd>
            </button>
            <IconButton label="Search" className="md:hidden" onClick={openPalette}>
              <Search className="h-5 w-5" aria-hidden />
            </IconButton>

            <NavLink
              to="/notifications"
              className="tap-target relative -mr-2 grid shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={
                unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
              }
            >
              <Bell className="h-5 w-5" aria-hidden />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </NavLink>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-gutter pt-4 pb-[calc(4rem+env(safe-area-inset-bottom))] focus:outline-none sm:pt-6 md:pb-6"
        >
          <Outlet />
        </main>
      </div>

      <BottomNav
        items={bottomNav}
        pendingCount={pending.data}
        onMore={() => setDrawerOpen(true)}
        moreActive={drawerOpen}
      />

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  )
}
