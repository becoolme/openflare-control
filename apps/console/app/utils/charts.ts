import series from '../fixtures/chart-series.json'

const SERIES: Readonly<Record<string, readonly number[]>> = series

function lookup(key: string): readonly number[] {
  const values = SERIES[key]
  if (!values) throw new Error(`Unknown chart series: ${key}`)
  return values
}

const f1 = (value: number) => value.toFixed(1)

export function sparklinePath(seed: string, width: number, height: number): string {
  return lookup(`${seed}:24`)
    .map(
      (y, i) => `${i === 0 ? 'M' : 'L'}${f1((i * width) / 23)} ${f1(height - 1 - y * (height - 2))}`
    )
    .join(' ')
}

export interface AreaPaths {
  grid: string[]
  line: string
  fill: string
}

export function areaPaths(seed: string, width: number, height: number): AreaPaths {
  const line = lookup(`${seed}:60`)
    .map(
      (y, i) =>
        `${i === 0 ? 'M' : 'L'}${f1((i * width) / 59)} ${f1(height - 4 - y * (height - 10))}`
    )
    .join(' ')
  return {
    grid: [1, 2, 3].map((k) => `M0 ${f1((height * k) / 4)}H${width}`),
    line,
    fill: `${line} L${width} ${height} L0 ${height}Z`,
  }
}

export interface BarRect {
  x: string
  y: string
  width: string
  height: string
}

export function barRects(seed: string, count: number, width: number, height: number): BarRect[] {
  const barWidth = width / count
  return lookup(`${seed}:${count}:bars`).map((y, i) => ({
    x: f1(i * barWidth + 1),
    y: f1(height - y * height),
    width: f1(barWidth - 2),
    height: f1(y * height),
  }))
}
