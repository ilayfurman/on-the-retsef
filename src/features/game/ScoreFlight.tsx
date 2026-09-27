import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { burst, sparkle } from '../../components/fx/particles'
import { clamp01, dampedSpring, ease, prefersReducedMotion, quadBezier } from '../../lib/motion'

// Must stay in sync with GameScreen's scorePopupDurationMs (the host's
// auto-advance timer waits on these).
export const SCORE_EMERGE_HOLD_MS = 600
export const SCORE_FLY_MS = 650
export const SCORE_MISS_EXTRA_MS = 1200

const EMERGE_MS = 260
const MISS_DROP_MS = 300
const MISS_SHIVER_AT = 850
const MISS_CRACK_AT = 1020
const MISS_SHATTER_AT = 1260

export type ScoreFlightSpec = {
  /** Screen point the number bursts out of (where the needle landed, or the side that was bet on). */
  from: { x: number; y: number }
  points: number
  color: string
  /** Whose scoreboard card it flies into. */
  teamId: string
  kind: 'guess' | 'bet'
}

function caption(spec: ScoreFlightSpec) {
  if (spec.kind === 'bet') return spec.points > 0 ? 'Called it!' : 'Wrong side'
  if (spec.points >= 4) return 'BULLSEYE!'
  if (spec.points === 3) return 'So close!'
  if (spec.points === 2) return 'On the board'
  return 'Nothing this time'
}

/**
 * The points a viewer earned this turn, as a physical object: bursts out of
 * the dial where it was earned, hangs for a beat, then arcs up into that
 * team's scoreboard card, leaving a sparkle trail — the card "catches" it
 * (bump + glow + burst) and only then does the total roll up. A miss has no
 * flight: it shatters in place (see missFrame). Entirely imperative (one rAF loop
 * writing transforms) so the motion never waits on React renders.
 */
export function ScoreFlight({ spec, onArrive }: { spec: ScoreFlightSpec; onArrive: () => void }) {
  const elRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const zeroRef = useRef<HTMLSpanElement>(null)
  const crackRef = useRef<SVGSVGElement>(null)
  const captionRef = useRef<HTMLSpanElement>(null)
  const [reduced] = useState(prefersReducedMotion)
  const arriveRef = useRef(onArrive)
  arriveRef.current = onArrive

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const isHit = spec.points > 0
    const target = document.querySelector<HTMLElement>(`[data-score-target="${spec.teamId}"]`)
    const card = document.querySelector<HTMLElement>(`[data-score-card="${spec.teamId}"]`)
    const tr = target?.getBoundingClientRect()
    const to = tr ? { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 } : null
    const flies = isHit && !!to && !reduced
    const total = isHit ? SCORE_EMERGE_HOLD_MS + SCORE_FLY_MS : SCORE_EMERGE_HOLD_MS + SCORE_FLY_MS + SCORE_MISS_EXTRA_MS
    const lift = 34
    const start = { x: spec.from.x, y: spec.from.y - lift }
    // Arc apex sits well above both ends, drifting slightly toward the card,
    // so the flight reads as a lob rather than a straight slide.
    const ctrl = to ? { x: (start.x + to.x) / 2 + (to.x - start.x) * 0.12, y: Math.min(start.y, to.y) - 150 } : start

    // Launch burst — the moment of earning it.
    if (spec.kind === 'bet' && isHit) {
      burst({ x: spec.from.x, y: spec.from.y, count: 34, colors: [spec.color, '#FFFFFF', '#FFD166'], speed: [160, 420], gravity: 700, life: [0.7, 1.2], shapes: ['confetti', 'dot'] })
    }
    if (spec.kind === 'guess' && spec.points >= 4 && !reduced && flashRef.current?.animate) {
      flashRef.current.animate([{ opacity: 0 }, { opacity: 0.42, offset: 0.2 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' })
    }

    let raf = 0
    let arrived = false
    let landed = false
    let shattered = false
    const t0 = performance.now()
    function arrive() {
      if (arrived) return
      arrived = true
      if (flies && to) {
        burst({ x: to.x, y: to.y, count: 26, colors: [spec.color, '#FFFFFF'], speed: [120, 320], gravity: 300, drag: 3, life: [0.4, 0.8], size: [3, 6], shapes: ['spark', 'dot', 'star'] })
        if (card && typeof card.animate === 'function') {
          card.animate(
            [
              { transform: 'scale(1)', boxShadow: `0 0 0 ${spec.color}00` },
              { transform: 'scale(1.1)', boxShadow: `0 0 38px ${spec.color}`, offset: 0.3 },
              { transform: 'scale(1)', boxShadow: `0 0 0 ${spec.color}00` },
            ],
            { duration: 620, easing: 'cubic-bezier(.3,1.4,.5,1)' },
          )
        }
      }
      arriveRef.current()
    }

    // A miss as an object that fails: a heavy zero drops in and squashes on
    // landing, shivers, cracks down the middle, and shatters into falling
    // shards — leaving just the caption behind to fade.
    function missFrame(e: number) {
      const zero = zeroRef.current
      const crack = crackRef.current
      const cap = captionRef.current
      if (!zero || !crack || !cap) return
      if (!landed && e >= MISS_DROP_MS) {
        landed = true
        const r = zero.getBoundingClientRect()
        burst({ x: r.left + r.width / 2, y: r.bottom - 6, count: 10, colors: ['#C9C2E8', '#FFFFFF'], speed: [60, 170], angle: -Math.PI / 2, spread: Math.PI * 1.1, gravity: 500, drag: 2, life: [0.3, 0.55], size: [2, 3], shapes: ['dot'] })
      }
      let sx = 1
      let sy = 1
      let rot = 0
      if (e >= MISS_DROP_MS) {
        const sp = dampedSpring(e - MISS_DROP_MS, 0.24, 3.4, 6)
        sx = 1 + sp
        sy = 1 - sp
      }
      if (e >= MISS_SHIVER_AT && e < MISS_SHATTER_AT) {
        rot = Math.sin((e - MISS_SHIVER_AT) / 20) * 3 * clamp01((e - MISS_SHIVER_AT) / 200)
      }
      zero.style.transform = `rotate(${rot}deg) scale(${sx}, ${sy})`
      const crackK = clamp01((e - MISS_CRACK_AT) / 170)
      crack.style.setProperty('--crack', String(1 - ease.outCubic(crackK)))
      if (!shattered && e >= MISS_SHATTER_AT) {
        shattered = true
        const r = zero.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        burst({ x: cx, y: cy, count: 34, colors: ['#C9C2E8', '#9A93C4', '#7A72A8', '#E4E0F5'], speed: [120, 400], spread: Math.PI * 2, gravity: 1150, drag: 0.6, life: [0.9, 1.4], size: [6, 14], shapes: ['shard'] })
        burst({ x: cx, y: cy, count: 12, colors: ['#FFFFFF'], speed: [200, 520], gravity: 100, drag: 3, life: [0.2, 0.4], size: [1.5, 2.5], shapes: ['spark'] })
        zero.style.opacity = '0'
        crack.style.opacity = '0'
      }
      // Caption: fades in under the zero, stays after it's gone, then sinks away.
      const inK = clamp01((e - 380) / 240)
      const outK = clamp01((e - (total - 450)) / 450)
      cap.style.opacity = String(inK * (1 - outK))
      cap.style.transform = `translateY(${outK * 10}px)`
    }

    function frame(now: number) {
      if (!el) return
      const e = now - t0
      let x = start.x
      let y = start.y
      let scale = 1
      let rot = 0
      let opacity = 1

      if (reduced) {
        opacity = e < 200 ? e / 200 : e > total - 300 ? clamp01((total - e) / 300) : 1
        y = spec.from.y - lift
        if (captionRef.current) captionRef.current.style.opacity = '1'
      } else if (!isHit) {
        missFrame(e)
        y = start.y - (e < MISS_DROP_MS ? 70 * (1 - ease.inCubic(e / MISS_DROP_MS)) : 0)
        opacity = clamp01(e / 120)
      } else if (e < EMERGE_MS) {
        // Pops out of the dial with an overshoot, rising as it goes.
        const k = e / EMERGE_MS
        scale = Math.max(0, ease.outBack(k, 2.4))
        y = spec.from.y - lift * ease.outCubic(k)
      } else if (!flies || e < SCORE_EMERGE_HOLD_MS) {
        // Hang in the air for a beat with a gentle bob.
        y = start.y + Math.sin((e - EMERGE_MS) / 140) * 3
      } else if (to) {
        // The lob: wind up a hair, then accelerate along the arc, shrinking
        // into the card as if it's being absorbed rather than landing on top.
        const k = clamp01((e - SCORE_EMERGE_HOLD_MS) / SCORE_FLY_MS)
        const p = ease.inOutCubic(k)
        x = quadBezier(start.x, ctrl.x, to.x, p)
        y = quadBezier(start.y, ctrl.y, to.y, p)
        scale = k < 0.12 ? 1 + 0.12 * (k / 0.12) : 1.12 - 0.74 * ease.inCubic((k - 0.12) / 0.88)
        rot = Math.sin(k * Math.PI) * (to.x > start.x ? 10 : -10)
        opacity = k > 0.9 ? clamp01((1 - k) / 0.1) : 1
        if (k > 0.05 && k < 0.98) sparkle(x, y, spec.color)
      }

      if (isHit && !flies && !reduced && e > total - 300) opacity = clamp01((total - e) / 300)

      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale}) rotate(${rot}deg)`
      el.style.opacity = String(opacity)

      if (e >= total) {
        arrive()
        el.style.opacity = '0'
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // One flight per mount — GameScreen keys this per turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isHit = spec.points > 0
  const big = spec.kind === 'guess' && spec.points >= 4
  return createPortal(
    <>
      <div
        ref={flashRef}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 88,
          opacity: 0,
          background: 'radial-gradient(60% 45% at 50% 55%, rgba(255,209,102,.9), rgba(255,111,163,.35) 55%, transparent 80%)',
        }}
      />
      <div
        ref={elRef}
        role="status"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 95,
          pointerEvents: 'none',
          opacity: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          willChange: 'transform, opacity',
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {isHit ? (
          <>
            <span
              style={{
                font: `800 ${big ? 68 : 56}px/1 var(--font-display)`,
                color: spec.color,
                textShadow: `0 0 28px ${spec.color}, 0 2px 0 rgba(0,0,0,.25)`,
                WebkitTextStroke: '1.5px rgba(255,255,255,.35)',
              }}
            >
              +{spec.points}
            </span>
            <span
              style={{
                font: `800 ${big ? 15 : 13}px/1 var(--font-body)`,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: '#fff',
                textShadow: `0 0 12px ${spec.color}`,
              }}
            >
              {caption(spec)}
            </span>
          </>
        ) : (
          <>
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span
                ref={zeroRef}
                style={{
                  display: 'inline-block',
                  transformOrigin: '50% 100%',
                  font: '800 84px/1 var(--font-display)',
                  color: '#C9C2E8',
                  WebkitTextStroke: '1.5px rgba(255,255,255,.45)',
                  textShadow: '0 0 26px rgba(160,150,210,.5), 0 3px 0 rgba(0,0,0,.25)',
                }}
              >
                0
              </span>
              {/* Crack: drawn in by animating --crack (dash offset) from 1 to 0. */}
              <svg
                ref={crackRef}
                viewBox="0 0 60 84"
                aria-hidden
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', ['--crack' as string]: 1 }}
              >
                {['31,6 27,24 35,37 25,51 33,63 28,80', '27,24 17,30', '25,51 38,56'].map((pts) => (
                  <polyline
                    key={pts}
                    points={pts}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray="1"
                    style={{ strokeDashoffset: 'var(--crack)', filter: 'drop-shadow(0 0 3px rgba(255,255,255,.8))' }}
                  />
                ))}
              </svg>
            </span>
            <span
              ref={captionRef}
              style={{ font: '700 15px var(--font-body)', color: 'var(--text-muted)', letterSpacing: '.02em', opacity: 0 }}
            >
              {caption(spec)}
            </span>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
