/**
 * Minimal 2D rigid-circle physics for the Team-o-Matic's capsules: balls
 * under gravity, bouncing off each other and off the inside of a circular
 * globe. Coordinates are relative to the globe's center (+y is down).
 * Deliberately tiny — a dozen balls, a few substeps, no broadphase.
 */
export type Ball = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** Visual spin in degrees, derived from rolling. */
  rot: number
}

export type StepOptions = {
  /** Inner radius of the containing globe. */
  radius: number
  gravity: number
  /** 0 = dead stop on impact, 1 = perfectly elastic. */
  restitution: number
  /** Tangential velocity kept on each wall contact (1 = frictionless). */
  friction: number
}

const SUBSTEPS = 4

export function stepBalls(balls: Ball[], dt: number, o: StepOptions) {
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const b of balls) {
      b.vy += o.gravity * h
      b.x += b.vx * h
      b.y += b.vy * h
      // Rolling: spin tracks horizontal travel, so capsules visibly tumble.
      b.rot += ((b.vx * h) / b.r) * (180 / Math.PI)
    }

    // Ball ↔ ball: push apart along the contact normal, then exchange the
    // approaching part of their velocity (equal masses).
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = a.r + b.r
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min) continue
        const d = Math.sqrt(d2) || 0.0001
        const nx = dx / d
        const ny = dy / d
        const push = (min - d) / 2
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (rv < 0) {
          const imp = (-(1 + o.restitution) * rv) / 2
          a.vx -= imp * nx
          a.vy -= imp * ny
          b.vx += imp * nx
          b.vy += imp * ny
        }
      }
    }

    // Ball ↔ globe wall: clamp back inside, bounce the outward component.
    for (const b of balls) {
      const lim = o.radius - b.r
      const d = Math.hypot(b.x, b.y)
      if (d <= lim) continue
      const nx = b.x / d
      const ny = b.y / d
      b.x = nx * lim
      b.y = ny * lim
      const vn = b.vx * nx + b.vy * ny
      if (vn > 0) {
        const tx = b.vx - vn * nx
        const ty = b.vy - vn * ny
        b.vx = tx * o.friction - o.restitution * vn * nx
        b.vy = ty * o.friction - o.restitution * vn * ny
      }
    }
  }
}
