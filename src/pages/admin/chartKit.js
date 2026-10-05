import { useEffect, useState } from 'react'

// Shared by the dashboard charts. Formatting only - every number they draw
// comes from the database as it is.

// The chart colours from the design tokens (src/styles/tokens.css), read as
// real colour values: the chart library needs those, not CSS variables.
function readColors() {
  const style = getComputedStyle(document.documentElement)
  const token = (name) => style.getPropertyValue(name).trim()
  return {
    labour: token('--chart-1'),
    ownedPlant: token('--chart-2'),
    receipts: token('--chart-3'),
    over: token('--destructive'),
    text: token('--label-2'),
    grid: token('--separator'),
    cursor: token('--fill'),
    tooltipBackground: token('--sheet-cell'),
    tooltipText: token('--label'),
  }
}

// Re-reads the colours when the phone switches Dark Mode or Increase Contrast.
export function useChartColors() {
  const [colors, setColors] = useState(readColors)
  useEffect(() => {
    const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'].map((query) =>
      window.matchMedia(query),
    )
    const update = () => setColors(readColors())
    queries.forEach((query) => query.addEventListener('change', update))
    return () => queries.forEach((query) => query.removeEventListener('change', update))
  }, [])
  return colors
}

// "R 12,5 k" on a chart's side.
const compactFormat = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  notation: 'compact',
  maximumFractionDigits: 1,
})
export const compactRand = (value) => compactFormat.format(value)

// "2026-03-02" -> "2 Mar"
export function shortDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function tooltipStyle(colors) {
  return {
    background: colors.tooltipBackground,
    border: 0,
    borderRadius: 10,
    color: colors.tooltipText,
    boxShadow: '0 4px 16px rgb(0 0 0 / 0.12)',
  }
}
