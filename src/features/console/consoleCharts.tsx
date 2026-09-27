/**
 * Charts for the system console overview.
 *
 * Series colours are a three-slot categorical palette validated for both
 * surfaces (lightness band, chroma floor, colour-vision separation and 3:1
 * contrast) with the data-viz validator; slot order is fixed and never cycled.
 * Every chart with two series carries a legend, so identity never rests on
 * colour alone, and every mark has a hover tooltip.
 */

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AXIS_TICK,
  ChartEmpty,
  ChartFrame,
  longDay,
  shortDay,
  tokensFor,
  tooltipProps,
  useIsDarkTheme,
} from '@/features/reports/charts'
import type { DailyLogins, DailyReferrals } from './useConsole'

/**
 * Slot 1 blue, slot 2 orange -- light / dark steps of the same hues. The third
 * slot (aqua) is validated but sits below 3:1 on white, so it is kept in
 * reserve for charts that carry direct labels.
 */
export const CONSOLE_SERIES = {
  one: { light: '#2a78d6', dark: '#3987e5' },
  two: { light: '#eb6834', dark: '#d95926' },
  three: { light: '#1baf7a', dark: '#199e70' },
} as const

function slot(key: keyof typeof CONSOLE_SERIES, dark: boolean): string {
  return dark ? CONSOLE_SERIES[key].dark : CONSOLE_SERIES[key].light
}

export function LoginTrendChart({ data, height = 240 }: { data: DailyLogins[]; height?: number }) {
  const dark = useIsDarkTheme()
  const t = tokensFor(dark)
  if (data.length === 0 || data.every((row) => row.logins === 0)) {
    return <ChartEmpty height={height} message="No sign-ins recorded in the last 14 days" />
  }
  return (
    <ChartFrame
      height={height}
      ariaLabel={`Sign-ins per day and distinct people signing in, over ${data.length} days`}
    >
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          width={36}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
        />
        <Tooltip
          {...tooltipProps(t)}
          labelFormatter={(label) => longDay(String(label))}
          formatter={(value, name) => [String(Number(value)), String(name)]}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconSize={10}
          wrapperStyle={{ fontSize: 12, color: t.axis, paddingBottom: 8 }}
        />
        <Bar
          dataKey="logins"
          name="Sign-ins"
          fill={slot('one', dark)}
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
        <Line
          type="monotone"
          dataKey="uniqueUsers"
          name="Distinct people"
          stroke={slot('two', dark)}
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: slot('two', dark) }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartFrame>
  )
}

export function ReferralsDailyChart({
  data,
  height = 240,
}: {
  data: DailyReferrals[]
  height?: number
}) {
  const dark = useIsDarkTheme()
  const t = tokensFor(dark)
  if (data.length === 0 || data.every((row) => row.created === 0 && row.completed === 0)) {
    return <ChartEmpty height={height} message="No referrals raised in the last 14 days" />
  }
  return (
    <ChartFrame
      height={height}
      ariaLabel={`Referrals raised and completed per day over ${data.length} days`}
    >
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          width={36}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
        />
        <Tooltip
          {...tooltipProps(t)}
          labelFormatter={(label) => longDay(String(label))}
          formatter={(value, name) => [String(Number(value)), String(name)]}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconSize={10}
          wrapperStyle={{ fontSize: 12, color: t.axis, paddingBottom: 8 }}
        />
        <Area
          type="monotone"
          dataKey="created"
          name="Raised"
          stroke={slot('one', dark)}
          fill={slot('one', dark)}
          fillOpacity={0.14}
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke={slot('two', dark)}
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: slot('two', dark) }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartFrame>
  )
}

export function RegionBarsChart({
  data,
  height,
}: {
  data: Array<{ region: string; count: number }>
  height?: number
}) {
  const dark = useIsDarkTheme()
  const t = tokensFor(dark)
  const rows = data.slice(0, 10)
  const resolvedHeight = height ?? Math.max(120, rows.length * 30 + 24)
  if (rows.length === 0) return <ChartEmpty height={resolvedHeight} message="No hospitals yet" />
  return (
    <ChartFrame
      height={resolvedHeight}
      ariaLabel={`Active hospitals by region, ${rows.length} regions`}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          hide
        />
        <YAxis
          type="category"
          dataKey="region"
          width={112}
          tick={{ ...AXIS_TICK, fill: t.axis }}
          stroke={t.axis}
          tickLine={false}
        />
        <Tooltip {...tooltipProps(t)} formatter={(value) => [String(Number(value)), 'Hospitals']} />
        <Bar
          dataKey="count"
          name="Hospitals"
          fill={slot('one', dark)}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
        >
          <LabelList dataKey="count" position="right" style={{ fill: t.axis, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}
