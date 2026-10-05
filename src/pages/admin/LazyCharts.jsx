import { lazy, Suspense } from 'react'
import s from './Dashboard.module.css'

// The dashboard's charts, downloaded only when a chart is first drawn - so
// the dashboard's figures show first and the chart library (recharts) follows.
// Until then each chart keeps its space, so nothing jumps. Same props as the
// charts in DashboardCharts.jsx.

const charts = () => import('./DashboardCharts')
const Cumulative = lazy(() => charts().then((module) => ({ default: module.CumulativeChart })))
const WeeklyMix = lazy(() => charts().then((module) => ({ default: module.WeeklyMixChart })))
const Spark = lazy(() => charts().then((module) => ({ default: module.Sparkline })))

// The space a chart will take (its box and height in DashboardCharts.jsx).
function ChartSpace({ height, boxed = true }) {
  return <div className={boxed ? s.chartBox : s.sparkline} style={{ height }} aria-busy="true" />
}

export function CumulativeChart(props) {
  return (
    <Suspense fallback={<ChartSpace height={210} />}>
      <Cumulative {...props} />
    </Suspense>
  )
}

export function WeeklyMixChart(props) {
  return (
    <Suspense fallback={<ChartSpace height={200} />}>
      <WeeklyMix {...props} />
    </Suspense>
  )
}

export function Sparkline(props) {
  return (
    <Suspense fallback={<ChartSpace height={36} boxed={false} />}>
      <Spark {...props} />
    </Suspense>
  )
}
