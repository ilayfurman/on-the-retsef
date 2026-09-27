import type { CSSProperties, RefObject } from 'react'

/**
 * The Team-o-Matic: a glass-dome capsule machine, drawn as TWO stacked SVGs
 * so capsules (separate DOM elements) can sit between them — behind the
 * glass's shine and in front of its back wall, i.e. visibly *inside* the
 * globe. Both share one viewBox; ShuffleReveal measures the back layer to
 * map globe/chute coordinates to the screen.
 */
export const VB = { w: 240, h: 300 }
export const GLOBE = { cx: 120, cy: 106, r: 97 }
/** Where a dispensed capsule reappears — the chute mouth on the base. */
export const CHUTE = { x: 120, y: 268 }
export const CRANK = { x: 203, y: 246 }
export const BULB_COUNT = 7

const layer: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  transformOrigin: '50% 100%',
}

export function MachineBack({ svgRef }: { svgRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={svgRef} viewBox={`0 0 ${VB.w} ${VB.h}`} style={{ ...layer, zIndex: 1 }} aria-hidden>
      <defs>
        <radialGradient id="tom-glass" cx="42%" cy="34%" r="70%">
          <stop offset="0" stopColor="rgba(255,255,255,.16)" />
          <stop offset=".6" stopColor="rgba(140,107,255,.14)" />
          <stop offset="1" stopColor="rgba(60,40,140,.38)" />
        </radialGradient>
      </defs>
      {/* Soft floor shadow the whole machine sits on. */}
      <ellipse cx="120" cy="298" rx="96" ry="9" fill="rgba(0,0,0,.35)" />
      <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="url(#tom-glass)" />
    </svg>
  )
}

export function MachineFront({
  svgRef,
  crankRef,
  bulbRefs,
}: {
  svgRef: RefObject<SVGSVGElement | null>
  crankRef: RefObject<SVGGElement | null>
  bulbRefs: RefObject<(SVGCircleElement | null)[]>
}) {
  const bulbXs = Array.from({ length: BULB_COUNT }, (_, i) => 76 + (i * (164 - 76)) / (BULB_COUNT - 1))
  return (
    <svg ref={svgRef} viewBox={`0 0 ${VB.w} ${VB.h}`} style={{ ...layer, zIndex: 3 }} aria-hidden>
      <defs>
        <linearGradient id="tom-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE9A6" />
          <stop offset=".55" stopColor="#F5BE4F" />
          <stop offset="1" stopColor="#C98A1E" />
        </linearGradient>
        <linearGradient id="tom-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A98CFF" />
          <stop offset=".55" stopColor="#7457E6" />
          <stop offset="1" stopColor="#4A33B0" />
        </linearGradient>
        <clipPath id="tom-globe-clip">
          <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} />
        </clipPath>
        <filter id="tom-bulb-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* Glass: rim, big curved highlight, a sparkle, and a glint that sweeps across. */}
      <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} fill="none" stroke="rgba(235,225,255,.6)" strokeWidth="2.5" />
      <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r - 5} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
      <path d="M 44 78 A 82 82 0 0 1 104 22" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="8" strokeLinecap="round" />
      <path d="M 40 100 A 82 82 0 0 1 42 90" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="64" cy="46" r="4.5" fill="rgba(255,255,255,.75)" />
      <g clipPath="url(#tom-globe-clip)">
        <g transform="rotate(24 120 106)">
          <rect className="tom-glint" x="-60" y="-20" width="26" height="260" fill="rgba(255,255,255,.14)" />
        </g>
      </g>

      {/* Gold collar with chase lights. */}
      <rect x="62" y="194" width="116" height="22" rx="11" fill="url(#tom-gold)" stroke="#1A1233" strokeWidth="2" />
      {bulbXs.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy="205" r="5" fill="#FFF2C2" filter="url(#tom-bulb-glow)" opacity={0.5} ref={(el) => void (bulbRefs.current[i] = el as unknown as SVGCircleElement)} />
          <circle cx={x} cy="205" r="2.8" fill="#FFFBEA" stroke="#9A6A12" strokeWidth=".8" />
        </g>
      ))}

      {/* Body. */}
      <path d="M 60 216 L 180 216 L 198 290 Q 199 297 192 297 L 48 297 Q 41 297 42 290 Z" fill="url(#tom-body)" stroke="#1A1233" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M 66 222 L 52 288" stroke="rgba(255,255,255,.28)" strokeWidth="5" strokeLinecap="round" />
      <rect x="75" y="226" width="90" height="17" rx="8.5" fill="rgba(20,12,60,.55)" />
      {/* textLength pins the label's width so it can't outgrow the plate, whatever font loads. */}
      <text x="120" y="238.5" textAnchor="middle" textLength="76" lengthAdjust="spacingAndGlyphs" style={{ font: "700 9.5px 'Fredoka', 'Rubik', sans-serif" }} fill="#FFE9A6">
        TEAM-O-MATIC
      </text>

      {/* Chute mouth + flap. */}
      <rect x="99" y="254" width="42" height="28" rx="9" fill="#120C2E" stroke="#1A1233" strokeWidth="2" />
      <rect x="103" y="257" width="34" height="7" rx="3.5" fill="rgba(255,255,255,.12)" />

      {/* Crank. */}
      <circle cx={CRANK.x} cy={CRANK.y} r="11" fill="url(#tom-gold)" stroke="#1A1233" strokeWidth="2" />
      {/* Rotated each frame via its transform attribute: rotate(deg CRANK.x CRANK.y). */}
      <g ref={crankRef}>
        <rect x={CRANK.x - 3} y={CRANK.y - 24} width="6" height="24" rx="3" fill="url(#tom-gold)" stroke="#1A1233" strokeWidth="1.5" />
        <circle cx={CRANK.x} cy={CRANK.y - 25} r="7.5" fill="#FF6FA3" stroke="#1A1233" strokeWidth="2" />
        <circle cx={CRANK.x - 2} cy={CRANK.y - 27} r="2.2" fill="rgba(255,255,255,.7)" />
      </g>
      <circle cx={CRANK.x} cy={CRANK.y} r="3.5" fill="#1A1233" />
    </svg>
  )
}
