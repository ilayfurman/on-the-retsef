export function clamp01(x: number) {
  return Math.max(0, Math.min(1, x))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inCubic: (t: number) => t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  /** Overshoots past 1 before settling — "landed with weight". */
  outBack: (t: number, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
}

/**
 * Closed-form damped oscillation: starts at 0, kicks out to ~`amplitude`,
 * then rings down. `t` in ms. Used for anything that should feel like it
 * was physically struck (needle impact, card catching the score).
 */
export function dampedSpring(t: number, amplitude: number, frequencyHz = 6, decay = 5.5) {
  if (t < 0) return 0
  const s = t / 1000
  return amplitude * Math.exp(-decay * s) * Math.sin(2 * Math.PI * frequencyHz * s)
}

/** Point on a quadratic bezier. */
export function quadBezier(p0: number, p1: number, p2: number, t: number) {
  const u = 1 - t
  return u * u * p0 + 2 * u * t * p1 + t * t * p2
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Score tier → how hard every effect in the reveal sequence hits. */
export type ImpactTier = 0 | 2 | 3 | 4
