import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDate, formatRand } from '../../lib/labels'
import { compactRand, reduceMotion, shortDate, tooltipStyle, useChartColors } from './chartKit'
import s from './Dashboard.module.css'

// The dashboard's charts (recharts). They draw the database's numbers as they
// are - no totals or percentages are worked out here.

// Spend vs budget over the whole job: the running total as a filled curve,
// and the budget as a dashed line. Red once spend has passed the budget.
//   rows: from dashboard_cumulative
export function CumulativeChart({ rows }) {
  const colors = useChartColors()
  const data = rows.map((row) => ({ week: row.week_start, cumulative: Number(row.cumulative_spent) }))
  const budget = rows[0]?.budget === null || rows[0]?.budget === undefined ? null : Number(rows[0].budget)
  const latest = data.at(-1)?.cumulative ?? 0
  const over = budget !== null && latest > budget
  const line = over ? colors.over : colors.labour

  return (
    <div className={s.chartBox} role="img" aria-label="Spend to date against the budget, week by week">
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={colors.grid} />
          <XAxis dataKey="week" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={16} tick={{ fill: colors.text, fontSize: 12 }} />
          <YAxis tickFormatter={compactRand} tickLine={false} axisLine={false} width={60} tick={{ fill: colors.text, fontSize: 12 }} />
          <Tooltip
            cursor={{ stroke: colors.grid }}
            contentStyle={tooltipStyle(colors)}
            labelFormatter={(week) => `Week of ${formatDate(week)}`}
            formatter={(value) => [formatRand(value), 'Spent to date']}
          />
          {budget !== null && (
            <ReferenceLine
              y={budget}
              ifOverflow="extendDomain"
              stroke={colors.over}
              strokeDasharray="6 4"
              label={{ value: `Budget ${compactRand(budget)}`, position: 'insideTopLeft', fill: colors.over, fontSize: 12 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={line}
            strokeWidth={2.5}
            fill={line}
            fillOpacity={0.14}
            isAnimationActive={!reduceMotion()}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// Spend per week, stacked: labour, owned plant, receipts.
//   weeks: from dashboard_weekly_mix
export function WeeklyMixChart({ weeks }) {
  const colors = useChartColors()
  const data = weeks.map((week) => ({
    week: week.week_start,
    labour: Number(week.labour),
    ownedPlant: Number(week.owned_plant),
    receipts: Number(week.receipts),
  }))
  const animate = !reduceMotion()

  return (
    <div className={s.chartBox} role="img" aria-label="Spend per week, split into labour, owned plant and receipts">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={colors.grid} />
          <XAxis dataKey="week" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={12} tick={{ fill: colors.text, fontSize: 12 }} />
          <YAxis tickFormatter={compactRand} tickLine={false} axisLine={false} width={60} tick={{ fill: colors.text, fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: colors.cursor }}
            contentStyle={tooltipStyle(colors)}
            labelFormatter={(week) => `Week of ${formatDate(week)}`}
            formatter={(value, name) => [formatRand(value), name]}
          />
          <Bar dataKey="labour" name="Labour" stackId="spend" fill={colors.labour} maxBarSize={44} isAnimationActive={animate} />
          <Bar dataKey="ownedPlant" name="Owned plant" stackId="spend" fill={colors.ownedPlant} maxBarSize={44} isAnimationActive={animate} />
          <Bar
            dataKey="receipts"
            name="Receipts"
            stackId="spend"
            fill={colors.receipts}
            maxBarSize={44}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// A tiny trend line for a key-number tile: spend per week, no axes.
//   weeks: from dashboard_weekly_mix (uses each week's total)
export function Sparkline({ weeks }) {
  const colors = useChartColors()
  const data = weeks.map((week) => ({ week: week.week_start, total: Number(week.total) }))
  return (
    <div className={s.sparkline} aria-hidden="true">
      <ResponsiveContainer width="100%" height={36}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <Area
            type="monotone"
            dataKey="total"
            stroke={colors.labour}
            strokeWidth={2}
            fill={colors.labour}
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
