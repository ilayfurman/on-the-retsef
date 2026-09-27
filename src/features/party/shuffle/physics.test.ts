import { describe, it, expect } from 'vitest'
import { stepBalls, type Ball } from './physics'

const opts = { radius: 100, gravity: 1500, restitution: 0.55, friction: 0.985 }

function makeBalls(n: number, r = 18): Ball[] {
  return Array.from({ length: n }, (_, i) => ({ x: (i - n / 2) * 10, y: -60, vx: (i % 2 ? 1 : -1) * 300, vy: 0, r, rot: 0 }))
}

describe('Team-o-Matic physics', () => {
  it('never lets a ball escape the globe', () => {
    const balls = makeBalls(12)
    for (let f = 0; f < 600; f++) {
      if (f % 30 === 0) balls.forEach((b) => ((b.vy -= 700), (b.vx += (f % 60 ? 1 : -1) * 400)))
      stepBalls(balls, 1 / 60, opts)
      for (const b of balls) expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(opts.radius - b.r + 0.5)
    }
  })

  it('settles into a resting pile at the bottom without agitation', () => {
    const balls = makeBalls(6)
    for (let f = 0; f < 900; f++) stepBalls(balls, 1 / 60, opts)
    for (const b of balls) {
      expect(b.y).toBeGreaterThan(0)
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(60)
    }
  })

  it('resolves overlaps between balls', () => {
    const balls: Ball[] = [
      { x: 0, y: 40, vx: 0, vy: 0, r: 20, rot: 0 },
      { x: 5, y: 40, vx: 0, vy: 0, r: 20, rot: 0 },
    ]
    for (let f = 0; f < 120; f++) stepBalls(balls, 1 / 60, opts)
    const d = Math.hypot(balls[1].x - balls[0].x, balls[1].y - balls[0].y)
    expect(d).toBeGreaterThan(39)
  })
})
