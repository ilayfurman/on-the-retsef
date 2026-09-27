import { prefersReducedMotion } from '../../lib/motion'

/**
 * Tiny time-based particle engine drawing into one full-screen canvas
 * (mounted by <ParticleLayer />). Deliberately imperative and outside React:
 * hundreds of particles updating every frame would be a re-render storm as
 * component state. The loop only runs while particles are alive, so it costs
 * nothing between reveals.
 */

type Shape = 'confetti' | 'dot' | 'star' | 'spark' | 'dust' | 'shard'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: string
  shape: Shape
  rot: number
  vr: number
  flip: number
  vflip: number
  gravity: number
  drag: number
}

export type BurstOptions = {
  x: number
  y: number
  count: number
  colors: string[]
  /** px per second, [min, max]. */
  speed: [number, number]
  /** Center direction in radians (screen space: -π/2 is straight up). */
  angle?: number
  /** Total cone width in radians (2π = all directions). */
  spread?: number
  /** px/s². */
  gravity?: number
  /** Fraction of velocity lost per second (0 = none). */
  drag?: number
  /** Seconds, [min, max]. */
  life?: [number, number]
  /** px, [min, max]. */
  size?: [number, number]
  shapes?: Shape[]
}

const MAX_PARTICLES = 700
const particles: Particle[] = []
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let lastTime = 0
let dpr = 1

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function resize() {
  if (!canvas) return
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export function attachCanvas(el: HTMLCanvasElement) {
  canvas = el
  ctx = el.getContext('2d')
  resize()
  window.addEventListener('resize', resize)
  return () => {
    window.removeEventListener('resize', resize)
    cancelAnimationFrame(raf)
    raf = 0
    particles.length = 0
    if (canvas === el) {
      canvas = null
      ctx = null
    }
  }
}

function drawStar(c: CanvasRenderingContext2D, r: number) {
  c.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
  }
  c.closePath()
  c.fill()
}

function frame(now: number) {
  if (!ctx || !canvas) {
    raf = 0
    return
  }
  // Clamp dt so a backgrounded tab resuming doesn't teleport everything.
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016)
  lastTime = now
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.age += dt
    if (p.age >= p.life) {
      particles.splice(i, 1)
      continue
    }
    const dragFactor = Math.max(0, 1 - p.drag * dt)
    p.vx *= dragFactor
    p.vy = p.vy * dragFactor + p.gravity * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot += p.vr * dt
    p.flip += p.vflip * dt

    const t = p.age / p.life
    // Pop in over the first few frames, fade over the last 35%.
    const alpha = Math.min(1, t / 0.06) * (t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1)
    ctx.globalAlpha = alpha
    ctx.fillStyle = p.color
    ctx.strokeStyle = p.color

    if (p.shape === 'spark') {
      ctx.lineWidth = p.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035)
      ctx.stroke()
      continue
    }

    ctx.save()
    ctx.translate(p.x, p.y)
    if (p.shape === 'confetti') {
      ctx.rotate(p.rot)
      // cos(flip) squashes one axis — reads as a paper flake tumbling in 3D.
      ctx.scale(1, Math.cos(p.flip))
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6)
    } else if (p.shape === 'shard') {
      // Jagged glass-like fragment, tumbling in 3D like the confetti, with a
      // bright edge so it catches the light as it falls.
      ctx.rotate(p.rot)
      ctx.scale(1, Math.cos(p.flip))
      const s = p.size
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(s * 0.75, s * 0.35)
      ctx.lineTo(s * 0.1, s * 0.8)
      ctx.lineTo(-s * 0.55, s * 0.3)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = alpha * 0.8
      ctx.strokeStyle = 'rgba(255,255,255,.85)'
      ctx.lineWidth = 1
      ctx.stroke()
    } else if (p.shape === 'star') {
      ctx.rotate(p.rot)
      drawStar(ctx, p.size)
    } else if (p.shape === 'dust') {
      const r = p.size * (1 + t * 1.6)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      g.addColorStop(0, p.color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = alpha * 0.55
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1

  if (particles.length > 0) {
    raf = requestAnimationFrame(frame)
  } else {
    raf = 0
  }
}

function ensureRunning() {
  if (raf || !ctx) return
  lastTime = performance.now()
  raf = requestAnimationFrame(frame)
}

export function burst(o: BurstOptions) {
  if (!ctx || prefersReducedMotion()) return
  const angle = o.angle ?? -Math.PI / 2
  const spread = o.spread ?? Math.PI * 2
  const shapes = o.shapes ?? ['confetti']
  for (let i = 0; i < o.count && particles.length < MAX_PARTICLES; i++) {
    const a = angle + (Math.random() - 0.5) * spread
    const v = rand(o.speed[0], o.speed[1])
    particles.push({
      x: o.x,
      y: o.y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      age: 0,
      life: rand(...(o.life ?? [0.9, 1.6])),
      size: rand(...(o.size ?? [6, 11])),
      color: pick(o.colors),
      shape: pick(shapes),
      rot: Math.random() * Math.PI * 2,
      vr: rand(-9, 9),
      flip: Math.random() * Math.PI * 2,
      vflip: rand(6, 16),
      gravity: o.gravity ?? 900,
      drag: o.drag ?? 1.4,
    })
  }
  ensureRunning()
}

/** A couple of short-lived glints — called every frame along a moving path to leave a trail. */
export function sparkle(x: number, y: number, color: string) {
  burst({
    x,
    y,
    count: 2,
    colors: [color, '#FFFFFF'],
    speed: [20, 90],
    gravity: 60,
    drag: 3,
    life: [0.25, 0.5],
    size: [2, 4],
    shapes: ['dot', 'dot', 'star'],
  })
}
