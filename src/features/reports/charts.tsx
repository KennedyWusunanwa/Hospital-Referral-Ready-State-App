/**
 * Recharts wrappers for the reporting tabs.
 *
 * Recharts draws SVG that Tailwind never sees, so nothing here can inherit the
 * app palette: every colour is resolved from the active theme and handed to
 * recharts as a concrete hex value. The palette is Okabe-Ito derived so series
 * stay distinguishable under the common colour-vision deficiencies -- and every
 * series is still named on an axis, a legend or a tooltip, so colour is never
 * the only carrier of meaning.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatPercent, formatSeconds } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Theme plumbing
// ---------------------------------------------------------------------------

/** Tracks the `dark` class that AppLayout toggles on <html>. */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

interface ChartTokens {
  axis: string
  grid: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  reference: string
}

function tokensFor(dark: boolean): ChartTokens {
  return dark
    ? {
        axis: '#94a3b8',
        grid: '#1e293b',
        tooltipBg: '#0f172a',
        tooltipBorder: '#334155',
        tooltipText: '#e2e8f0',
        reference: '#64748b',
      }
    : {
        axis: '#64748b',
        grid: '#e2e8f0',
        tooltipBg: '#ffffff',
        tooltipBorder: '#cbd5e1',
        tooltipText: '#0f172a',
        reference: '#94a3b8',
      }
}

/** Categorical palette, light/dark pairs. */
const CATEGORICAL = [
  { light: '#1b5cf5', dark: '#7aa8ff' },
  { light: '#0f766e', dark: '#4ed3ab' },
  { light: '#b45309', dark: '#f0a94c' },
  { light: '#7c3aed', dark: '#b79cff' },
  { light: '#0e7490', dark: '#5ec8dd' },
  { light: '#be185d', dark: '#f472b6' },
  { light: '#4d7c0f', dark: '#a3d165' },
  { light: '#9a3412', dark: '#fb923c' },
] as const

function categorical(index: number, dark: boolean): string {
  const pair = CATEGORICAL[index % CATEGORICAL.length]
  return dark ? pair.dark : pair.light
}

const SERIES = {
  created: { light: '#1b5cf5', dark: '#7aa8ff' },
  accepted: { light: '#0f766e', dark: '#4ed3ab' },
  completed: { light: '#b45309', dark: '#f0a94c' },
} as const

/** Red / amber / green band for rate bars. Always paired with a numeric axis. */
function bandColor(rate: number, dark: boolean): string {
  if (rate >= 85) return dark ? '#4ed3ab' : '#0f766e'
  if (rate >= 60) return dark ? '#f0a94c' : '#b45309'
  return dark ? '#fb7185' : '#be123c'
}

function tooltipProps(t: ChartTokens) {
  return {
    contentStyle: {
      background: t.tooltipBg,
      border: '1px solid ' + t.tooltipBorder,
      borderRadius: 8,
      fontSize: 12,
      color: t.tooltipText,
      boxShadow: '0 4px 16px rgba(15, 23, 42, 0.12)',
    },
    labelStyle: { color: t.tooltipText, fontWeight: 600, marginBottom: 2 },
    itemStyle: { color: t.tooltipText },
    cursor: { fill: t.grid, fillOpacity: 0.35 },
  }
}

const AXIS_TICK = { fontSize: 11 }

// ---------------------------------------------------------------------------
// Shared frame
// ---------------------------------------------------------------------------

function ChartFrame({
  height,
  ariaLabel,
  children,
}: {
  height: number
  ariaLabel: string
  children: ReactElement
}) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function ChartEmpty({ height, message }: { height: number; message?: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
      style={{ height }}
    >
      {message ?? 'No data for this period'}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day labels. Day strings arrive as YYYY-MM-DD; formatting them through Date
// would shift them by the browser offset, so they are split by hand.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  const label = MONTHS[Number(month) - 1]
  return label && date ? date + ' ' + label : day
}

function longDay(day: string): string {
  const [year, month, date] = day.split('-')
  const label = MONTHS[Number(month) - 1]
  return label && date ? date + ' ' + label + ' ' + year : day
}

function truncate(value: string, max = 22): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

// ---------------------------------------------------------------------------
// Referral trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  day: string
  created: number
  accepted: number
  completed: number
}

export function ReferralTrendChart({
  data,
  dark,
  height = 300,
}: {
  data: TrendPoint[]
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  if (data.length === 0) return <ChartEmpty height={height} />

  return (
    <ChartFrame
      height={height}
      ariaLabel={'Referrals created, accepted and completed per day over ' + data.length + ' days'}
    >
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          minTickGap={16}
          label={{
            value: 'Date',
            position: 'insideBottom',
            offset: -12,
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          allowDecimals={false}
          width={44}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          label={{
            value: 'Referrals',
            angle: -90,
            position: 'insideLeft',
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <Tooltip
          {...tooltipProps(t)}
          labelFormatter={(label) => longDay(String(label))}
          formatter={(value, name) => [String(Number(value)), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: t.axis }} />
        <Area
          type="monotone"
          dataKey="created"
          name="Created"
          stroke={isDark ? SERIES.created.dark : SERIES.created.light}
          fill={isDark ? SERIES.created.dark : SERIES.created.light}
          fillOpacity={0.16}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="accepted"
          name="Accepted"
          stroke={isDark ? SERIES.accepted.dark : SERIES.accepted.light}
          strokeWidth={2}
          dot={{ r: 2.5 }}
        />
        <Line
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke={isDark ? SERIES.completed.dark : SERIES.completed.light}
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={{ r: 2.5 }}
        />
      </ComposedChart>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Status breakdown
// ---------------------------------------------------------------------------

export interface StatusSlice {
  key: string
  label: string
  count: number
}

export function StatusBreakdownChart({
  data,
  dark,
  height = 260,
}: {
  data: StatusSlice[]
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  const slices = useMemo(() => data.filter((slice) => slice.count > 0), [data])
  const total = useMemo(() => slices.reduce((acc, slice) => acc + slice.count, 0), [slices])

  if (total === 0) return <ChartEmpty height={height} />

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="sm:w-1/2">
        <ChartFrame height={height} ariaLabel={'Referrals by status, ' + total + ' in total'}>
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Tooltip
              {...tooltipProps(t)}
              cursor={false}
              formatter={(value, name) => [
                Number(value) + ' (' + formatPercent((Number(value) / total) * 100) + ')',
                String(name),
              ]}
            />
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="55%"
              outerRadius="82%"
              paddingAngle={2}
              stroke={isDark ? '#0f172a' : '#ffffff'}
              strokeWidth={2}
            >
              {slices.map((slice, index) => (
                <Cell key={slice.key} fill={categorical(index, isDark)} />
              ))}
            </Pie>
          </PieChart>
        </ChartFrame>
      </div>

      <ul className="space-y-1.5 text-sm sm:w-1/2">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: categorical(index, isDark) }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">
              {slice.label}
            </span>
            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
              {slice.count}
            </span>
            <span className="w-12 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {formatPercent((slice.count / total) * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Emergency types
// ---------------------------------------------------------------------------

export interface EmergencyTypeSlice {
  code: string
  name: string
  count: number
}

export function EmergencyTypeChart({
  data,
  dark,
  height = 300,
}: {
  data: EmergencyTypeSlice[]
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  const rows = useMemo(() => [...data].sort((a, b) => b.count - a.count).slice(0, 10), [data])

  if (rows.length === 0) return <ChartEmpty height={height} />

  return (
    <ChartFrame height={height} ariaLabel="Referral count by emergency type, highest first">
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          label={{
            value: 'Referrals',
            position: 'insideBottom',
            offset: -12,
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={150}
          tickFormatter={(value: string) => truncate(String(value))}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
        />
        <Tooltip {...tooltipProps(t)} formatter={(value) => [String(Number(value)), 'Referrals']} />
        <Bar dataKey="count" name="Referrals" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((row, index) => (
            <Cell key={row.code} fill={categorical(index, isDark)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Urgency mix
// ---------------------------------------------------------------------------

export interface UrgencySlice {
  key: string
  label: string
  count: number
}

export function UrgencyChart({
  data,
  dark,
  height = 260,
}: {
  data: UrgencySlice[]
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  const rows = data.filter((row) => row.count > 0)
  if (rows.length === 0) return <ChartEmpty height={height} />

  return (
    <ChartFrame height={height} ariaLabel="Referral count by urgency level">
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          tickFormatter={(value: string) => truncate(String(value), 18)}
          label={{
            value: 'Urgency',
            position: 'insideBottom',
            offset: -12,
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          allowDecimals={false}
          width={44}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          label={{
            value: 'Referrals',
            angle: -90,
            position: 'insideLeft',
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <Tooltip {...tooltipProps(t)} formatter={(value) => [String(Number(value)), 'Referrals']} />
        <Bar dataKey="count" name="Referrals" radius={[4, 4, 0, 0]} maxBarSize={64}>
          {rows.map((row, index) => (
            <Cell key={row.key} fill={categorical(index, isDark)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Response times
// ---------------------------------------------------------------------------

export interface ResponseTimePoint {
  hospital: string
  avgResponseMinutes: number | null
  avgCompletionMinutes: number | null
}

export function ResponseTimeChart({
  data,
  dark,
  height = 320,
}: {
  data: ResponseTimePoint[]
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  const rows = useMemo(
    () =>
      data
        .filter((row) => row.avgResponseMinutes !== null || row.avgCompletionMinutes !== null)
        .sort((a, b) => (a.avgResponseMinutes ?? Infinity) - (b.avgResponseMinutes ?? Infinity))
        .slice(0, 12),
    [data],
  )

  if (rows.length === 0) {
    return <ChartEmpty height={height} message="No timed referrals in this period" />
  }

  return (
    <ChartFrame
      height={height}
      ariaLabel="Average response and completion time in minutes, per hospital"
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          label={{
            value: 'Minutes',
            position: 'insideBottom',
            offset: -12,
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          type="category"
          dataKey="hospital"
          width={150}
          tickFormatter={(value: string) => truncate(String(value))}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
        />
        <Tooltip
          {...tooltipProps(t)}
          formatter={(value, name) => [formatSeconds(Number(value) * 60), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: t.axis }} />
        <Bar
          dataKey="avgResponseMinutes"
          name="Avg response"
          fill={isDark ? SERIES.created.dark : SERIES.created.light}
          radius={[0, 3, 3, 0]}
          maxBarSize={12}
        />
        <Bar
          dataKey="avgCompletionMinutes"
          name="Avg completion"
          fill={isDark ? SERIES.completed.dark : SERIES.completed.light}
          radius={[0, 3, 3, 0]}
          maxBarSize={12}
        />
      </BarChart>
    </ChartFrame>
  )
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export interface CompliancePoint {
  id: string
  department: string
  hospital: string
  complianceRate: number
}

export function ComplianceChart({
  data,
  target = 80,
  dark,
  height = 320,
}: {
  data: CompliancePoint[]
  target?: number
  dark?: boolean
  height?: number
}) {
  const auto = useIsDarkTheme()
  const isDark = dark ?? auto
  const t = tokensFor(isDark)

  const rows = useMemo(
    () => [...data].sort((a, b) => a.complianceRate - b.complianceRate).slice(0, 15),
    [data],
  )

  if (rows.length === 0) return <ChartEmpty height={height} message="No departments to report on" />

  return (
    <ChartFrame
      height={height}
      ariaLabel="Readiness update compliance rate per department, worst first"
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(value: number) => value + '%'}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          label={{
            value: 'Compliance rate',
            position: 'insideBottom',
            offset: -12,
            fill: t.axis,
            fontSize: 11,
          }}
        />
        <YAxis
          type="category"
          dataKey="department"
          width={150}
          tickFormatter={(value: string) => truncate(String(value))}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
        />
        <Tooltip
          {...tooltipProps(t)}
          labelFormatter={(label, payload) => {
            const point = payload?.[0]?.payload as CompliancePoint | undefined
            return point ? point.department + ' — ' + point.hospital : String(label)
          }}
          formatter={(value) => [formatPercent(Number(value), 1), 'Compliance']}
        />
        <ReferenceLine
          x={target}
          stroke={t.reference}
          strokeDasharray="4 4"
          label={{ value: 'Target ' + target + '%', position: 'top', fill: t.axis, fontSize: 11 }}
        />
        <Bar dataKey="complianceRate" name="Compliance" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {rows.map((row) => (
            <Cell key={row.id} fill={bandColor(row.complianceRate, isDark)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}
