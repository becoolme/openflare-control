import { describe, expect, it } from 'vitest'
import series from '~/fixtures/chart-series.json'
import { areaPaths, barRects, sparklinePath } from '~/utils/charts'

describe('chart geometry', () => {
  it('draws a 24-point sparkline inside the box', () => {
    const path = sparklinePath('a1', 120, 24)
    const points = path.split(/[ML]/).filter(Boolean)
    expect(points).toHaveLength(24)
    expect(path.startsWith('M0.0 ')).toBe(true)
    for (const point of points) {
      const [x, y] = point.trim().split(' ').map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(120)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(24)
    }
  })

  it('is deterministic for a seed', () => {
    expect(sparklinePath('a1', 80, 20)).toBe(sparklinePath('a1', 80, 20))
    expect(sparklinePath('a1', 80, 20)).not.toBe(sparklinePath('b2', 80, 20))
  })

  it('builds area line, closed fill and three grid lines', () => {
    const { grid, line, fill } = areaPaths('c1', 600, 160)
    expect(grid).toEqual(['M0 40.0H600', 'M0 80.0H600', 'M0 120.0H600'])
    expect(fill.startsWith(line)).toBe(true)
    expect(fill.endsWith('Z')).toBe(true)
  })

  it('lays bars side by side within the height', () => {
    const key = Object.keys(series).find((name) => name.endsWith(':bars'))
    expect(key).toBeDefined()
    const [seed, count] = key!.split(':')
    const bars = barRects(seed!, Number(count), 200, 40)
    expect(bars).toHaveLength(Number(count))
    for (const bar of bars) {
      expect(Number(bar.y) + Number(bar.height)).toBeCloseTo(40, 0)
    }
  })

  it('rejects unknown series instead of drawing nothing', () => {
    expect(() => sparklinePath('missing', 10, 10)).toThrow('Unknown chart series: missing:24')
  })
})
