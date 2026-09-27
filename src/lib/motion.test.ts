import { describe, it, expect } from 'vitest'
import { dampedSpring, ease, quadBezier } from './motion'

describe('motion helpers', () => {
  it('dampedSpring starts at rest and rings down toward zero', () => {
    expect(dampedSpring(0, 10)).toBe(0)
    expect(dampedSpring(-50, 10)).toBe(0)
    const early = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(dampedSpring(i * 5, 10))))
    const late = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(dampedSpring(1200 + i * 5, 10))))
    expect(early).toBeGreaterThan(3)
    expect(late).toBeLessThan(0.1)
  })

  it('easings hit their endpoints', () => {
    for (const fn of [ease.outCubic, ease.inOutCubic, ease.inCubic, ease.outQuart]) {
      expect(fn(0)).toBeCloseTo(0)
      expect(fn(1)).toBeCloseTo(1)
    }
    expect(ease.outBack(1)).toBeCloseTo(1)
  })

  it('outBack overshoots past 1 before settling', () => {
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => ease.outBack(i / 100)))
    expect(peak).toBeGreaterThan(1)
  })

  it('quadBezier passes through both endpoints', () => {
    expect(quadBezier(0, 50, 100, 0)).toBe(0)
    expect(quadBezier(0, 50, 100, 1)).toBe(100)
  })
})
