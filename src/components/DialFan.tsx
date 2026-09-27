import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { WEDGE_THRESHOLDS } from '../lib/scoringConstants'

// Geometry constants from docs/design/reference/Dial.dc.html's renderVals().
const CX = 180
const CY = 178
const RO = 150 // outer radius of the ring / bands
const RI = 98 // inner radius of the ring / bands
const RM = 124 // radius at which score labels sit

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x))
}

/** Scales a spectrum end label down as it gets longer, matching the same
 * idea as ClueCard's clue text — a long label wraps onto a second line
 * instead of running off the edge of the dial at a fixed size meant for a
 * short word. */
function endLabelFontSize(text: string): number {
  const len = text.length
  if (len <= 10) return 17
  if (len <= 16) return 15
  if (len <= 24) return 13
  return 11
}

/** P(v, r) — a point at value v (0..1) on a circle of radius r around the pivot. */
function P(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - v)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}

function f(q: [number, number]) {
  return `${q[0].toFixed(1)} ${q[1].toFixed(1)}`
}

/** An annular-sector path between radius RI and RO, spanning values [a,b]. */
function band(a: number, b: number) {
  a = clamp01(a)
  b = clamp01(b)
  if (b - a < 0.001) return ''
  return `M${f(P(a, RO))} A${RO} ${RO} 0 0 1 ${f(P(b, RO))} L${f(P(b, RI))} A${RI} ${RI} 0 0 0 ${f(P(a, RI))} Z`
}

/**
 * Pure angle-to-value conversion, ported from the reference's `setFrom()`.
 * Given a point (x, y) in the dial's local 360x250 coordinate space and the
 * pivot (cx, cy), returns the value in [0,1] that a pointer at that position
 * corresponds to. Angles below the semicircle (a < 0, i.e. the pointer is
 * below the pivot line) are clamped to whichever end of the dial (0 or 1)
 * they're nearest to, so a drag that overshoots past either tip still
 * produces a sane in-range value instead of jumping to the opposite end.
 */
export function angleToValue(x: number, y: number, cx: number, cy: number): number {
  let a = Math.atan2(cy - y, x - cx)
  if (a < 0) a = x < cx ? Math.PI : 0
  return Math.round((1 - a / Math.PI) * 100) / 100
}

/** Label position + rotation for the score number at value m along radius RM. */
function lbl(m: number) {
  const q = P(m, RM)
  return {
    x: q[0].toFixed(1),
    y: q[1].toFixed(1),
    tf: `rotate(${((m - 0.5) * 180).toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)})`,
    op: m > 0.02 && m < 0.98 ? 1 : 0,
  }
}

export function DialFan({
  value,
  interactive = false,
  onChange,
  onDragStart,
  onDragEnd,
  revealedTarget,
  left,
  right,
  showNeedle = true,
  animateReveal = true,
  glowWinner = true,
  revealHoldMs = 0,
  activeMover,
}: {
  value: number
  interactive?: boolean
  onChange?: (v: number) => void
  /** Fires when a drag begins (pointer down on an interactive dial). */
  onDragStart?: () => void
  /** Fires when a drag ends (pointer up) — used to clear the "who's dragging" indicator. */
  onDragEnd?: () => void
  revealedTarget?: number
  left?: string
  right?: string
  /** False hides the needle/pivot entirely — for a placeholder dial before any real value (guess/target) exists yet. */
  showNeedle?: boolean
  /** False shows bands instantly with no cover-slide animation. */
  animateReveal?: boolean
  /** False skips the "which band did it land in" pulsing glow — for the psychic's own dial, where "value" IS the target, so it would always trivially "win" the center band, which isn't a real score. */
  glowWinner?: boolean
  /** How long the cover stays fully closed before it starts retracting — a beat of suspense for the real in-game reveal. 0 (default) starts retracting immediately. */
  revealHoldMs?: number
  /** Shows this player's avatar floating out past the needle tip, following it live — whoever is currently dragging the shared guess. */
  activeMover?: { avatar: string } | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)
  const isInteractive = interactive && !!onChange
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  function valueFromPointer(e: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return value
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) * 360) / rect.width
    const y = ((e.clientY - rect.top) * 250) / rect.height
    return angleToValue(x, y, CX, CY)
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!isInteractive) return
    draggingRef.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    onDragStart?.()
    onChange?.(valueFromPointer(e))
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!isInteractive || !draggingRef.current) return
    onChange?.(valueFromPointer(e))
  }

  function handlePointerUp() {
    if (draggingRef.current) onDragEnd?.()
    draggingRef.current = false
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isInteractive) return
    if (e.key === 'ArrowRight') onChange?.(Math.min(1, Math.round((value + 0.01) * 100) / 100))
    if (e.key === 'ArrowLeft') onChange?.(Math.max(0, Math.round((value - 0.01) * 100) / 100))
  }

  const t = WEDGE_THRESHOLDS
  const showBands = revealedTarget !== undefined
  const target = revealedTarget ?? 0

  // Needle: tapered polygon per reference. Stays exactly where it was
  // locked in — no sweep/animation — only the reveal cover below moves.
  const a = Math.PI * (1 - value)
  const tip = P(value, RO + 2)
  const qx = Math.sin(a) * 8
  const qy = Math.cos(a) * 8
  // The base's two corners rotate with the needle (perpendicular to its
  // shaft) — at the resting middle value that offset is purely horizontal,
  // so both corners sit exactly on the pivot line, flush with the dome's
  // flat edge and the arcs' own baseline. Near either end, though, it swings
  // toward vertical, and one corner would dip BELOW that shared baseline —
  // poking out past the dome instead of staying tucked under it. Clamping
  // each corner to the baseline keeps the base visually anchored there at
  // every angle instead of only at the middle.
  const baseY1 = Math.min(CY + qy, CY)
  const baseY2 = Math.min(CY - qy, CY)
  const needle = `${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${(CX + qx).toFixed(1)},${baseY1.toFixed(1)} ${(CX - qx).toFixed(1)},${baseY2.toFixed(1)}`

  // Active-mover avatar floats further out past the tip (not right on it) so
  // it doesn't obscure the needle itself, and tracks the same angle live.
  const moverPoint = activeMover ? P(value, RO + 2 + 40) : null

  const bandDefs = [
    { d: band(target - t.outer, target - t.inner), fill: '#8C6BFF' },
    { d: band(target - t.inner, target - t.center), fill: '#FF6FA3' },
    { d: band(target - t.center, target + t.center), fill: '#FFD166' },
    { d: band(target + t.center, target + t.inner), fill: '#FF6FA3' },
    { d: band(target + t.inner, target + t.outer), fill: '#8C6BFF' },
  ]
  // Which band the guess actually landed in, so it can glow — same
  // thresholds compute_score uses server-side, so this always matches score.
  // Skipped when glowWinner is off (e.g. the psychic's own dial, where
  // "value" IS the target — it would always "win" the center band, which is
  // meaningless, not an actual score).
  const diff = Math.abs(value - target)
  const winningBandIndex = !glowWinner
    ? null
    : diff <= t.center
      ? 2
      : diff <= t.inner
        ? (value < target ? 1 : 3)
        : diff <= t.outer
          ? (value < target ? 0 : 4)
          : null

  // Like the physical game's sliding scoring window: the colors and numbers
  // are already there, just covered by a panel that looks like the plain
  // ring. Reveal is that cover retracting left→right, not the bands
  // appearing — matches the real board more closely than a fade-in would.
  const shouldAnimate = showBands && animateReveal
  const [revealProgress, setRevealProgress] = useState(shouldAnimate ? 0 : 1)
  useEffect(() => {
    if (!shouldAnimate) return
    let raf: number
    const duration = 900
    // Holds the cover fully closed for a beat before it starts retracting,
    // so the reveal has a moment of suspense instead of starting instantly.
    const timer = setTimeout(() => {
      const start = performance.now()
      function step(now: number) {
        const progress = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - progress, 3)
        setRevealProgress(eased)
        if (progress < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, revealHoldMs)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
    // Runs once per mount only — a fresh DialFan instance is mounted per turn
    // reveal (see GameScreen's key={turn.id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Sweeps the full dial (0..1), not just the scoring-wedge strip — the
  // physical slider passes over the whole board edge-to-edge regardless of
  // where the numbers happen to sit, so this ignores `target`/thresholds
  // entirely and only the wedge geometry above cares about those.
  const coverLeft = 0
  const coverRight = 1
  const coverBoundary = coverLeft + revealProgress * (coverRight - coverLeft)
  const coverPath = band(coverBoundary, coverRight)
  // Little pull-tab riding the cover's leading edge, like the physical
  // game's handle — sits just past the rim, at whatever angle the cover's
  // edge currently is.
  const handlePoint = shouldAnimate && revealProgress < 1 ? P(clamp01(coverBoundary), RO + 6) : null

  return (
    <div style={{ position: 'relative', width: '100%' }}>
    <svg
      ref={svgRef}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-readonly={!isInteractive}
      tabIndex={isInteractive ? 0 : -1}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      viewBox="0 0 360 250"
      className="dialfan-svg"
      style={{
        width: '100%',
        height: 'auto',
        touchAction: 'none',
        overflow: 'visible',
        filter: 'drop-shadow(0 0 28px rgba(140,110,255,.4))',
        cursor: isInteractive ? 'grab' : 'default',
        outline: 'none',
      }}
    >
      <defs>
        <linearGradient id={`rg${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2E2266" />
          <stop offset="1" stopColor="#15103A" />
        </linearGradient>
        <radialGradient id={`nd${uid}`} cx="40%" cy="38%" r="60%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".45" stopColor="#FFE9A8" />
          <stop offset="1" stopColor="#F2A93B" />
        </radialGradient>
        <radialGradient id={`pl${uid}`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".5" stopColor="#D9D3F2" />
          <stop offset="1" stopColor="#7E73B8" />
        </radialGradient>
      </defs>

      {/* Ring background: filled annular arc from RI to RO. */}
      <path
        d="M30 178 A150 150 0 0 1 330 178 L278 178 A98 98 0 0 0 82 178 Z"
        fill={`url(#rg${uid})`}
        stroke="rgba(190,170,255,.4)"
        strokeWidth={1.5}
      />

      {showBands && (
        <>
          {bandDefs.map((b, i) => {
            const isWinner = i === winningBandIndex
            return (
              <path
                key={i}
                d={b.d}
                fill={b.fill}
                style={isWinner ? { animation: `band-glow 1.3s ease-in-out 900ms infinite` } : undefined}
              />
            )
          })}
          {[
            { m: target - (t.outer + t.inner) / 2, label: '2' },
            { m: target - (t.inner + t.center) / 2, label: '3' },
            { m: target, label: '4' },
            { m: target + (t.inner + t.center) / 2, label: '3' },
            { m: target + (t.outer + t.inner) / 2, label: '2' },
          ].map(({ m, label }, i) => {
            const o = lbl(m)
            return (
              <text
                key={i}
                x={o.x}
                y={o.y}
                transform={o.tf}
                opacity={o.op}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ font: '700 16px Rubik, sans-serif' }}
                fill="#1A1233"
              >
                {label}
              </text>
            )
          })}
          {/* Sliding cover — a distinct panel (not just the ring's own
              background) that retracts left→right to reveal the real colors
              and numbers underneath, like the physical game's scoring window. */}
          {shouldAnimate && revealProgress < 1 && (
            <path d={coverPath} fill="#17B0A8" stroke="#0E7B75" strokeWidth={1.5} />
          )}
          {handlePoint && (
            <g transform={`translate(${handlePoint[0].toFixed(1)} ${handlePoint[1].toFixed(1)})`}>
              <circle r={9} fill="#0E7B75" stroke="#1A1233" strokeWidth={1.5} />
              <circle r={3} fill="#F4F2FB" />
            </g>
          )}
        </>
      )}

      {showNeedle && (
        <>
          {/* Needle drop shadow, drawn underneath the main needle. */}
          <polygon points={needle} fill="#FFD166" opacity={0.25} transform="translate(0 3)" />
          <polygon points={needle} fill={`url(#nd${uid})`} stroke="#FFF4D6" strokeWidth={1} strokeLinejoin="round" />

          {/* Pivot cap. */}
          <path d="M148 181 A32 32 0 0 1 212 181 Z" fill={`url(#pl${uid})`} />
          <ellipse cx={172} cy={162} rx={10} ry={5} fill="#fff" opacity={0.6} transform="rotate(-20 172 162)" />
        </>
      )}
    </svg>
    {left !== undefined && (
      <div
        style={{
          position: 'absolute',
          left: '15.5%',
          bottom: '5%',
          maxWidth: '40%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          color: 'var(--text)',
          font: `600 ${endLabelFontSize(left)}px/1.2 var(--font-body)`,
          pointerEvents: 'none',
          textAlign: 'center',
          overflowWrap: 'break-word',
        }}
      >
        <span style={{ font: '400 22px/1 var(--font-body)' }}>&larr;</span>
        <span>{left}</span>
      </div>
    )}
    {right !== undefined && (
      <div
        style={{
          position: 'absolute',
          left: '84.5%',
          bottom: '5%',
          maxWidth: '40%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          color: 'var(--text)',
          font: `600 ${endLabelFontSize(right)}px/1.2 var(--font-body)`,
          pointerEvents: 'none',
          textAlign: 'center',
          overflowWrap: 'break-word',
        }}
      >
        <span style={{ font: '400 22px/1 var(--font-body)' }}>&rarr;</span>
        <span>{right}</span>
      </div>
    )}
    {activeMover && moverPoint && (
      <div
        style={{
          position: 'absolute',
          left: `${(moverPoint[0] / 360) * 100}%`,
          top: `${(moverPoint[1] / 250) * 100}%`,
          transform: 'translate(-50%, -50%)',
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.08)',
          border: '2px solid #FFD166',
          boxShadow: '0 0 12px rgba(255,209,102,.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          pointerEvents: 'none',
          transition: 'left 0.05s linear, top 0.05s linear',
        }}
      >
        {activeMover.avatar}
      </div>
    )}
    </div>
  )
}
