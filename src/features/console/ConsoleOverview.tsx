/**
 * The console landing screen: is the network healthy right now, and what needs
 * a person? Numbers first, trends second, then the list of things to act on.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardList,
  Inbox,
  KeyRound,
  RefreshCw,
  ScrollText,
  Users,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Meter,
  Skeleton,
  Stat,
  StatusDot,
} from '@/components/ui'
import { useAuditLogs, useStaff } from '@/features/admin/useAdmin'
import { useHospitals } from '@/features/hospitals/useHospitals'
import {
  LOGIN_METHOD_LABELS,
  ROLE_LABELS,
  ROLE_TIERS,
  ROLE_TIER_LABELS,
  ROLES_BY_TIER,
  type LoginMethod,
  type UserRole,
} from '@/lib/constants'
import { cn, formatDateTime, formatPercent, formatSeconds, relativeTime } from '@/lib/utils'
import { LoginTrendChart, ReferralsDailyChart, RegionBarsChart } from './consoleCharts'
import {
  describeUserAgent,
  useLoginEvents,
  usePlatformStats,
  type PlatformStats,
} from './useConsole'

interface AttentionItem {
  key: string
  count: number
  title: string
  detail: string
  to: string
  tone: 'danger' | 'warning' | 'info'
}

function attentionItems(stats: PlatformStats): AttentionItem[] {
  const items: AttentionItem[] = [
    {
      key: 'overdue',
      count: stats.referrals.pendingOverdue,
      title: 'Referrals waiting past the response target',
      detail: 'Pending for more than 15 minutes with no decision from the receiving hospital.',
      to: '/referrals?status=pending&sort=waiting',
      tone: 'danger',
    },
    {
      key: 'red',
      count: stats.hospitals.readiness.red,
      title: 'Hospitals with a stale department',
      detail: 'At least one department has not reported for three shifts or more.',
      to: '/readiness?status=red',
      tone: 'danger',
    },
    {
      key: 'diversion',
      count: stats.hospitals.onDiversion,
      title: 'Emergency units on diversion',
      detail: 'Their emergency room is flagged closed to new arrivals.',
      to: '/console/hospitals?accepting=no',
      tone: 'warning',
    },
    {
      key: 'unattached',
      count: stats.users.unattached,
      title: 'Accounts with no hospital',
      detail: 'These people can sign in but see nothing until a facility is attached.',
      to: '/console/users?hospital=none',
      tone: 'warning',
    },
    {
      key: 'never',
      count: stats.users.neverSignedIn,
      title: 'Accounts that have never signed in',
      detail: 'Invited or created, but not yet used.',
      to: '/console/users?sort=last_login&dir=asc',
      tone: 'info',
    },
    {
      key: 'invites',
      count: stats.users.pendingInvites,
      title: 'Invitations waiting to be accepted',
      detail: 'Each expires thirty days after it was created.',
      to: '/console/users',
      tone: 'info',
    },
    {
      key: 'unconfigured',
      count: stats.hospitals.readiness.unconfigured,
      title: 'Hospitals with no reporting departments',
      detail: 'They cannot turn green until departments are added.',
      to: '/console/hospitals',
      tone: 'warning',
    },
    {
      key: 'logos',
      count: Math.max(0, stats.hospitals.active - stats.hospitals.withLogo),
      title: 'Hospitals without a logo',
      detail: 'They show a monogram until one is uploaded.',
      to: '/console/hospitals',
      tone: 'info',
    },
  ]
  return items.filter((item) => item.count > 0)
}

const TONE_CLASSES = {
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-slate-400 dark:text-slate-500',
}

function ReadinessSummary({ stats }: { stats: PlatformStats }) {
  const { green, yellow, red, unconfigured } = stats.hospitals.readiness
  const total = green + yellow + red + unconfigured
  const departments = stats.departments
  const rate = departments.reporting > 0 ? (departments.green / departments.reporting) * 100 : 0

  const segments = [
    { key: 'green', label: 'Current', count: green, className: 'bg-emerald-500' },
    { key: 'yellow', label: 'Overdue', count: yellow, className: 'bg-amber-500' },
    { key: 'red', label: 'Stale', count: red, className: 'bg-red-500' },
    {
      key: 'unconfigured',
      label: 'No departments',
      count: unconfigured,
      className: 'bg-slate-300 dark:bg-slate-600',
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {formatPercent(rate)}
          </p>
          <p className="hint">
            {departments.green} of {departments.reporting} departments current
          </p>
        </div>
        <Meter
          className="mt-2"
          value={rate}
          tone={rate >= 85 ? 'success' : rate >= 60 ? 'warning' : 'danger'}
          label="Departments current across the network"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          Hospitals by status
        </p>
        {total === 0 ? (
          <p className="hint">No hospitals yet.</p>
        ) : (
          <>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {segments
                .filter((segment) => segment.count > 0)
                .map((segment) => (
                  <span
                    key={segment.key}
                    className={cn('h-full', segment.className)}
                    style={{ width: `${(segment.count / total) * 100}%` }}
                    title={`${segment.label}: ${segment.count}`}
                  />
                ))}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {segments.map((segment) => (
                <li key={segment.key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <span className={cn('h-2 w-2 rounded-full', segment.className)} aria-hidden />
                    {segment.label}
                  </span>
                  <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {segment.count}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Link
        to="/readiness"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
      >
        Open the network board
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  )
}

function RolesBreakdown({ stats }: { stats: PlatformStats }) {
  const total = Object.values(stats.users.byRole).reduce((sum, n) => sum + n, 0)
  return (
    <div className="space-y-4">
      {ROLE_TIERS.map((tier) => {
        const roles = ROLES_BY_TIER[tier]
        const tierTotal = roles.reduce((sum, role) => sum + (stats.users.byRole[role] ?? 0), 0)
        return (
          <div key={tier}>
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {ROLE_TIER_LABELS[tier]} level
              </p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {tierTotal}
              </p>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {roles.map((role: UserRole) => {
                const count = stats.users.byRole[role] ?? 0
                return (
                  <li key={role}>
                    <div className="flex items-center justify-between text-xs">
                      <Link
                        to={`/console/users?role=${role}`}
                        className="text-slate-700 hover:underline dark:text-slate-300"
                      >
                        {ROLE_LABELS[role]}
                      </Link>
                      <span className="tabular-nums text-slate-600 dark:text-slate-400">
                        {count}
                      </span>
                    </div>
                    <Meter
                      className="mt-1 h-1.5"
                      value={total > 0 ? (count / total) * 100 : 0}
                      label={`${ROLE_LABELS[role]} share of accounts`}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function RecentSignIns() {
  const events = useLoginEvents({ page: 1, pageSize: 8 })
  const people = useStaff(null)
  const hospitals = useHospitals({ onlyActive: false })
  const names = useMemo(
    () => new Map((people.data ?? []).map((p) => [p.id, p.full_name])),
    [people.data],
  )
  const hospitalNames = useMemo(
    () => new Map((hospitals.data ?? []).map((h) => [h.id, h.name])),
    [hospitals.data],
  )

  return (
    <Card>
      <CardHeader
        title="Latest sign-ins"
        description="Who came in most recently, and how."
        action={
          <Link
            to="/console/sign-ins"
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            All sign-ins
          </Link>
        }
      />
      {events.isPending ? (
        <LoadingBlock rows={4} />
      ) : events.isError ? (
        <CardBody>
          <ErrorBlock error={events.error} onRetry={() => void events.refetch()} />
        </CardBody>
      ) : events.data.rows.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-7 w-7" />}
          title="No sign-ins recorded yet"
          description="Recording starts once migration 0006 is applied."
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {events.data.rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar name={names.get(row.user_id ?? '') ?? row.email} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {names.get(row.user_id ?? '') ?? row.email ?? 'Unknown'}
                </p>
                <p className="truncate hint">
                  {row.hospital_id
                    ? (hospitalNames.get(row.hospital_id) ?? 'Hospital')
                    : 'Network-wide'}{' '}
                  · {describeUserAgent(row.user_agent)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Badge tone="neutral">
                  {LOGIN_METHOD_LABELS[(row.method as LoginMethod) ?? 'unknown']}
                </Badge>
                <p className="mt-0.5 hint" title={formatDateTime(row.created_at)}>
                  {relativeTime(row.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RecentAudit() {
  const logs = useAuditLogs({ hospitalId: null, page: 1, pageSize: 8 })
  return (
    <Card>
      <CardHeader
        title="Latest audit events"
        description="Administrative changes and clinical actions, network-wide."
        action={
          <Link
            to="/console/audit"
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            Full audit log
          </Link>
        }
      />
      {logs.isPending ? (
        <LoadingBlock rows={4} />
      ) : logs.isError ? (
        <CardBody>
          <ErrorBlock error={logs.error} onRetry={() => void logs.refetch()} />
        </CardBody>
      ) : logs.data.rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-7 w-7" />} title="Nothing recorded yet" />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {logs.data.rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="neutral">{row.action}</Badge>
                  <span className="truncate text-slate-700 dark:text-slate-300">
                    {row.actor_name ?? row.actor_email ?? 'System'}
                  </span>
                </p>
                <p className="mt-0.5 truncate hint">
                  {row.entity_type ?? ''}
                  {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ''}
                </p>
              </div>
              <span className="shrink-0 hint" title={formatDateTime(row.created_at)}>
                {relativeTime(row.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function ConsoleOverview() {
  const stats = usePlatformStats()

  if (stats.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Card>
          <LoadingBlock label="Loading platform statistics" rows={5} />
        </Card>
      </div>
    )
  }

  if (stats.isError) {
    return <ErrorBlock error={stats.error} onRetry={() => void stats.refetch()} />
  }

  const data = stats.data
  const attention = attentionItems(data)
  const departmentRate =
    data.departments.reporting > 0 ? (data.departments.green / data.departments.reporting) * 100 : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hint">
          Figures as of {data.generatedAt ? formatDateTime(data.generatedAt) : 'now'}
          {stats.isFetching ? ' · refreshing…' : ''}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void stats.refetch()}
          loading={stats.isFetching}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat
          label="Active hospitals"
          value={data.hospitals.active}
          sublabel={`${data.hospitals.accepting} accepting · ${data.hospitals.onDiversion} on diversion`}
          tone={data.hospitals.onDiversion > 0 ? 'warning' : undefined}
          icon={<Building2 className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Departments current"
          value={formatPercent(departmentRate)}
          sublabel={`${data.departments.green}/${data.departments.reporting} reporting · ${data.departments.updates24h} updates in 24 h`}
          tone={departmentRate >= 85 ? 'success' : departmentRate >= 60 ? 'warning' : 'danger'}
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Referrals, 7 days"
          value={data.referrals.last7d}
          sublabel={`${data.referrals.pending} pending now · ${data.referrals.inTransit} in transit`}
          tone={data.referrals.pendingOverdue > 0 ? 'danger' : undefined}
          icon={<Inbox className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Active accounts"
          value={data.users.active}
          sublabel={`${data.users.signedIn24h} signed in today · ${data.users.signedIn7d} this week`}
          icon={<Users className="h-4 w-4" aria-hidden />}
        />
        <Stat
          label="Avg response, 7 days"
          value={
            data.referrals.avgResponseSeconds7d === null
              ? 'n/a'
              : formatSeconds(data.referrals.avgResponseSeconds7d)
          }
          sublabel={`${data.referrals.accepted7d} accepted · ${data.referrals.declined7d} declined · ${data.referrals.completed7d} completed`}
          icon={<KeyRound className="h-4 w-4" aria-hidden />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Sign-ins, last 14 days"
            description="Every successful sign-in, and how many different people that was."
          />
          <CardBody>
            <LoginTrendChart data={data.loginsDaily} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Referrals, last 14 days"
            description="Raised across the network, and how many reached completion."
          />
          <CardBody>
            <ReferralsDailyChart data={data.referralsDaily} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Network readiness now"
            description="Evaluated in each hospital's own timezone."
          />
          <CardBody>
            <ReadinessSummary stats={data} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Hospitals by region" description="Active facilities." />
          <CardBody>
            <RegionBarsChart data={data.hospitals.byRegion} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Accounts by level"
            description="Active accounts, grouped the way access is granted."
          />
          <CardBody>
            <RolesBreakdown stats={data} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Needs attention"
          description={
            attention.length === 0
              ? 'Nothing outstanding across the network.'
              : `${attention.length} thing${attention.length === 1 ? '' : 's'} worth a look.`
          }
          action={
            <AlertTriangle
              className={cn(
                'h-5 w-5',
                attention.length ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600',
              )}
              aria-hidden
            />
          }
        />
        {attention.length === 0 ? (
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <StatusDot status="green" />
              Every check is clear. Well done, everyone.
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span
                    className={cn(
                      'w-10 shrink-0 text-2xl font-semibold tabular-nums',
                      TONE_CLASSES[item.tone],
                    )}
                  >
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                      {item.title}
                    </span>
                    <span className="block hint">{item.detail}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentSignIns />
        <RecentAudit />
      </div>

      <p className="hint">
        Activity in the last 24 hours: {data.activity.auditEvents24h} audit events,{' '}
        {data.activity.messages24h} messages, {data.activity.notifications24h} notifications sent (
        {data.activity.unreadNotifications} still unread), {data.activity.logins24h} sign-ins.
        Referrals since launch: {data.referrals.allTime}.
      </p>
    </div>
  )
}
