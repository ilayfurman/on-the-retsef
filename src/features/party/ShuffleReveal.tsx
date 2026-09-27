import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Starfield } from '../../components/Starfield'
import { Btn } from '../../components/Btn'
import { ParticleLayer } from '../../components/fx/ParticleLayer'
import { burst, sparkle } from '../../components/fx/particles'
import { clamp01, dampedSpring, ease, lerp, prefersReducedMotion } from '../../lib/motion'
import { stepBalls, type Ball } from './shuffle/physics'
import { BULB_COUNT, CHUTE, CRANK, GLOBE, MachineBack, MachineFront, VB } from './shuffle/TeamOMatic'

type Player = { id: string; display_name: string; avatar: string }
type Team = { id: string; name: string }

// Mirrors shuffle_teams' own naming/order, so predicted "shell" boxes shown
// before real data arrives use the same names/colors the real teams land on.
const TEAM_NAMES = ['Pink Team', 'Sky Team', 'Violet Team', 'Gold Team']
const TEAM_COLORS = ['#FF6FA3', '#5BD6FF', '#8C6BFF', '#FFD166']
const CAPSULE_COLORS = ['#FF6FA3', '#5BD6FF', '#FFD166', '#8C6BFF', '#7ED3A4', '#F4A259']
const SLOT = 40

// ── Choreography (ms) ────────────────────────────────────────────────────
const INTRO_MS = 620 // machine drops in and settles
const FLY_IN_MS = 540 // avatar leaps from the lobby into the globe
const MIN_TUMBLE_MS = 950 // minimum mixing after the last capsule is in
const WHOOSH_MS = 470 // air-jet burst cadence
const EXIT_MS = 170 // capsule sucked down to the globe's exit
const CHUTE_MS = 170 // hidden inside the machine
const POPOUT_MS = 340 // pops out of the chute onto the tray
const WOBBLE_MS = 150
const MY_WOBBLE_MS = 800 // yours shakes longer — the suspense beat
const OPEN_MS = 300
const HOP_MS = 460
const MY_HOP_MS = 720 // with a somersault
const MY_SUSPENSE_GAP_MS = 650 // everyone else has landed; just yours, rattling alone
const FINALE_DELAY_MS = 420

type Mode = 'waiting' | 'flyin' | 'ball' | 'exit' | 'chute' | 'popout' | 'wobble' | 'open' | 'hop' | 'done'

type Actor = {
  id: string
  isMe: boolean
  seed: number
  mode: Mode
  t: number
  enterAt: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  startScale: number
  ball: Ball
  exitAt: number | null
  trayDir: -1 | 0 | 1
  spin: 1 | -1
  teamId: string | null
  teamColor: string
  opened: boolean
  slotSize: number
}

type ActorEls = { root: HTMLDivElement | null; top: HTMLDivElement | null; bottom: HTMLDivElement | null; face: HTMLDivElement | null }

/** Cheap deterministic hash of a string into [0, 1). */
function seedFrom(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0
  return (h % 10000) / 10000
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgba(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
function shade(hex: string, f: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`
}

function WaveTitle({ text, variant }: { text: string; variant: 'wave' | 'pop' }) {
  return (
    <span aria-label={text} style={{ display: 'inline-flex', font: '800 22px/1 var(--font-display)', letterSpacing: '.06em', color: 'var(--text)' }}>
      {text.split('').map((ch, i) => (
        <span
          key={`${variant}${i}`}
          aria-hidden
          style={{
            display: 'inline-block',
            whiteSpace: 'pre',
            textShadow: '0 0 14px rgba(255,209,102,.45)',
            animation:
              variant === 'wave'
                ? `title-wave 1.1s ease-in-out ${i * 70}ms infinite`
                : `title-pop .5s cubic-bezier(.3,1.7,.5,1) ${i * 32}ms both`,
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}

/**
 * The team shuffle, as a show: the Team-o-Matic capsule machine.
 *
 *   drop-in → everyone leaps into the globe as capsules → physics tumble
 *   (air jets, collisions, crank, chase lights) held until the real result
 *   arrives → capsules dispensed one by one down the chute, cracked open in
 *   their team's color, avatars hop into their team box → the viewer's own
 *   capsule last, alone, with a suspense beat and a somersault into a box
 *   that zooms up with a "YOU'RE ON" badge → machine sinks away.
 *
 * All per-frame motion is imperative (one rAF loop writing transforms onto
 * refs); React state only changes a handful of times per run.
 */
export function ShuffleReveal({
  open,
  shuffleRequestId,
  players,
  startRects,
  numTeamsPredicted,
  teams,
  playersByTeam,
  myPlayerId,
  myTeamId,
  canAct,
  skipAnimation,
  resultsReady = true,
  onStartGame,
  onReshuffle,
  onDismiss,
  starting,
  shuffling,
  startError,
}: {
  open: boolean
  /** Bumped by the parent the instant Shuffle/Reshuffle is clicked — restarts the whole show. */
  shuffleRequestId: number
  players: Player[]
  /** Each player's on-screen position the instant Shuffle was clicked, so they leap from where they were. */
  startRects: Record<string, DOMRect>
  numTeamsPredicted: number
  teams: Team[]
  playersByTeam: Map<string, Player[]>
  myPlayerId?: string | null
  myTeamId?: string | null
  /** Only the host can start/reshuffle — everyone else gets a "waiting" note instead. */
  canAct: boolean
  /** One possible team (fewer than 4 players) — nothing to shuffle, so no machine: everyone just pops into the one box. */
  skipAnimation?: boolean
  /** False until `teams`/`playersByTeam` reflect THIS shuffle's result (not the previous one) — the machine keeps mixing until then. */
  resultsReady?: boolean
  onStartGame: () => void
  onReshuffle: () => void
  onDismiss: () => void
  starting?: boolean
  shuffling?: boolean
  startError?: string | null
}) {
  const [reduced] = useState(prefersReducedMotion)
  const mode: 'gacha' | 'quick' | 'calm' = skipAnimation ? 'quick' : reduced ? 'calm' : 'gacha'
  const [stage, setStage] = useState<'run' | 'done'>('run')
  const [landed, setLanded] = useState<Record<string, true>>({})
  const [myLanded, setMyLanded] = useState(false)
  const [machineGone, setMachineGone] = useState(false)
  const [subtitle, setSubtitle] = useState<'mixing' | 'dealing' | 'suspense' | 'none'>('mixing')
  // Huddle (single team) only: the "TEAM!" moment has happened / the box has appeared.
  const [cheered, setCheered] = useState(false)
  const [boxShown, setBoxShown] = useState(mode !== 'quick')

  const backRef = useRef<SVGSVGElement | null>(null)
  const frontRef = useRef<SVGSVGElement | null>(null)
  const crankRef = useRef<SVGGElement | null>(null)
  const bulbRefs = useRef<(SVGCircleElement | null)[]>([])
  const actorEls = useRef<Record<string, ActorEls>>({})
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const boxRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const huddleEls = useRef<Record<string, HTMLDivElement | null>>({})
  const chantRef = useRef<HTMLDivElement | null>(null)

  // Latest async data, read from inside the animation loop without restarting it.
  const live = useRef({ resultsReady, teams, playersByTeam })
  live.current = { resultsReady, teams, playersByTeam }

  useEffect(() => {
    if (!open) return
    setStage('run')
    setLanded({})
    setMyLanded(false)
    setMachineGone(false)
    setSubtitle('mixing')
    setCheered(false)
    setBoxShown(mode !== 'quick')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shuffleRequestId])

  // Reduced motion: no show at all — everyone lands the moment the result is in.
  useEffect(() => {
    if (!open || mode !== 'calm' || !resultsReady) return
    setLanded(Object.fromEntries(players.map((p) => [p.id, true as const])))
    setMyLanded(true)
    setSubtitle('none')
    setStage('done')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, resultsReady, shuffleRequestId])

  // ── The Huddle: the single-team version. There's nothing to decide, so no
  // suspense — it's a team cheer instead: everyone runs in and huddles up,
  // bounces to a "1… 2… 3…" chant (leaning in tighter each beat), jumps
  // together on "TEAM!" as the huddle bursts open, then hops into the box.
  useEffect(() => {
    if (!open || mode !== 'quick' || !resultsReady) return
    const roster = [...players]
    const n = Math.max(roster.length, 1)
    const A = n > 6 ? 46 : 56
    const color = TEAM_COLORS[0]
    const stagger = Math.min(90, 400 / n)
    const GATHER = 560
    const gatherEnd = GATHER + (n - 1) * stagger
    const beats = [gatherEnd + 160, gatherEnd + 460, gatherEnd + 760]
    const BEAT_HOP = 260
    const cheerAt = gatherEnd + 1060
    const JUMP = 560
    const settleAt = cheerAt + JUMP + 140
    const SETTLE = 480
    const R0 = n === 1 ? 0 : Math.max(46, Math.min(110, 28 + n * 11))
    const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.3 })
    const c0 = center()
    const t0 = performance.now()

    const actors = roster.map((p, i) => {
      const r = startRects[p.id]
      const seed = seedFrom(p.id + shuffleRequestId)
      return {
        id: p.id,
        i,
        // From their lobby spot if we have one; otherwise run in from alternating sides.
        from: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: i % 2 === 0 ? -A : window.innerWidth + A, y: c0.y + (seed - 0.5) * 240 },
        spin: (i % 2 === 0 ? -1 : 1) as 1 | -1,
        startAt: i * stagger,
        settleStart: settleAt + i * 70,
        settleFrom: null as null | { x: number; y: number },
        target: null as null | { x: number; y: number; size: number },
        done: false,
      }
    })
    for (const a of actors) {
      const el = huddleEls.current[a.id]
      if (!el) continue
      el.style.width = `${A}px`
      el.style.height = `${A}px`
      el.style.fontSize = `${Math.round(A * 0.52)}px`
      el.style.opacity = '0'
    }

    const chant = chantRef.current
    function showChant(text: string, big: boolean) {
      if (!chant) return
      chant.textContent = text
      chant.style.fontSize = big ? '66px' : n > 3 ? '48px' : '38px'
      chant.style.opacity = '1'
      chant.style.transform = 'translate(-50%, -50%) scale(1)'
      if (typeof chant.animate === 'function') {
        chant.animate(
          [
            { transform: 'translate(-50%, -50%) scale(2.3)', opacity: 0 },
            { transform: 'translate(-50%, -50%) scale(.9)', opacity: 1, offset: 0.55 },
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          ],
          { duration: big ? 440 : 300, easing: 'cubic-bezier(.3,1.4,.5,1)' },
        )
      }
    }

    function ringPos(i: number, radius: number, c: { x: number; y: number }) {
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0)
      return { x: c.x + Math.cos(ang) * radius, y: c.y + Math.sin(ang) * radius }
    }

    let beatShown = 0
    let chantBig = false
    let cheerDone = false
    let finished = false
    let raf = 0

    function frame(now: number) {
      const e = now - t0
      const c = center()
      const k = beats.filter((b) => e >= b).length
      const jp = clamp01((e - cheerAt) / JUMP)
      // Leans in a little tighter on every beat, then bursts open on the jump.
      const radius = e < cheerAt ? R0 * (1 - 0.08 * k) : R0 * 0.76 + R0 * 0.5 * Math.sin(Math.PI * jp)

      if (chant) {
        // Count-in numbers pop in the middle of the huddle (everyone gathered
        // around them); "TEAM!" goes above, where it has room to slam in.
        chant.style.left = `${c.x}px`
        chant.style.top = `${chantBig || n < 2 ? c.y - R0 - A / 2 - 44 : c.y}px`
      }
      if (k > beatShown) {
        beatShown = k
        showChant(String(k), false)
        burst({ x: c.x, y: c.y, count: 8, colors: [color, '#FFFFFF'], speed: [80, 220], gravity: 200, drag: 2.5, life: [0.3, 0.5], size: [2, 3.5], shapes: ['dot', 'star'] })
      }
      if (!cheerDone && e >= cheerAt + JUMP * 0.45) {
        cheerDone = true
        chantBig = true
        showChant('TEAM!', true)
        burst({ x: c.x, y: c.y, count: 130, colors: ['#FF6FA3', '#5BD6FF', '#8C6BFF', '#FFD166', '#FFFFFF', '#7ED3A4'], speed: [380, 980], spread: Math.PI * 2, gravity: 900, life: [1.2, 2], size: [7, 12], shapes: ['confetti', 'confetti', 'star'] })
        burst({ x: c.x, y: c.y, count: 44, colors: ['#FFFFFF', '#FFE9A6'], speed: [500, 1100], gravity: 120, drag: 2.5, life: [0.3, 0.6], size: [2, 3.5], shapes: ['spark'] })
        setCheered(true)
        setBoxShown(true)
      }
      if (chant && e >= settleAt + 200) chant.style.opacity = String(clamp01(1 - (e - settleAt - 200) / 320))

      for (const a of actors) {
        const el = huddleEls.current[a.id]
        if (!el || a.done) continue
        const le = e - a.startAt
        if (le < 0) continue
        const home = ringPos(a.i, radius, c)
        let x: number
        let y: number
        let sx = 1
        let sy = 1
        let rot = 0
        if (le < GATHER) {
          // Run-and-flip into the huddle.
          const p = le / GATHER
          const kk = ease.inOutCubic(p)
          x = lerp(a.from.x, home.x, kk)
          y = lerp(a.from.y, home.y, kk) - Math.sin(Math.PI * p) * 100
          rot = a.spin * 360 * kk
          const st = Math.sin(Math.PI * p) * 0.12
          sx = 1 - st
          sy = 1 + st
        } else if (e < a.settleStart) {
          x = home.x
          y = home.y
          const land = dampedSpring(le - GATHER, 0.2, 4.5, 8)
          sx = 1 + land
          sy = 1 - land
          for (const b of beats) {
            const bh = e - b
            if (bh >= 0 && bh < BEAT_HOP) {
              const q = bh / BEAT_HOP
              y -= Math.sin(Math.PI * q) * 16
              const s2 = Math.sin(Math.PI * q) * 0.08
              sx *= 1 - s2
              sy *= 1 + s2
            }
          }
          if (e >= cheerAt && e < cheerAt + JUMP) {
            // Everyone jumps together, spinning.
            y -= Math.sin(Math.PI * jp) * 88
            rot = a.spin * 360 * ease.inOutCubic(jp)
            const s3 = Math.sin(Math.PI * jp) * 0.12
            sx *= 1 - s3
            sy *= 1 + s3
          } else if (e >= cheerAt + JUMP) {
            const sq = dampedSpring(e - cheerAt - JUMP, 0.22, 4.5, 8)
            sx *= 1 + sq
            sy *= 1 - sq
          }
        } else {
          // Hop from the huddle into their spot in the box.
          if (!a.settleFrom) {
            a.settleFrom = home
            const slot = slotRefs.current[a.id]
            if (slot) {
              const r = slot.getBoundingClientRect()
              a.target = { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width }
            }
          }
          if (!a.target) {
            a.done = true
            el.style.opacity = '0'
            continue
          }
          const p = clamp01((e - a.settleStart) / SETTLE)
          const kk = ease.inOutCubic(p)
          x = lerp(a.settleFrom.x, a.target.x, kk)
          y = lerp(a.settleFrom.y, a.target.y, kk) - Math.sin(Math.PI * p) * 80
          sx = sy = lerp(1, a.target.size / A, kk)
          rot = Math.sin(Math.PI * p) * 14 * a.spin
          if (p >= 1) {
            a.done = true
            el.style.opacity = '0'
            setLanded((prev) => ({ ...prev, [a.id]: true }))
            burst({ x: a.target.x, y: a.target.y, count: 14, colors: [color, '#FFFFFF'], speed: [90, 260], gravity: 250, drag: 3, life: [0.3, 0.6], size: [2, 4], shapes: ['spark', 'dot', 'star'] })
            continue
          }
        }
        el.style.opacity = '1'
        el.style.transform = `translate(${(x - A / 2).toFixed(1)}px, ${(y - A / 2).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      }

      if (!finished && actors.every((a) => a.done)) {
        finished = true
        setMyLanded(true)
        setStage('done')
      }
      if (!finished) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // One run per shuffle; players/startRects are snapshotted at its start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, resultsReady, shuffleRequestId])

  useEffect(() => {
    if (!open || mode !== 'gacha') return
    if (!backRef.current || !frontRef.current) return
    const back: SVGSVGElement = backRef.current
    const front: SVGSVGElement = frontRef.current

    const t0 = performance.now()
    const roster = [...players].sort((a, b) => seedFrom(a.id + shuffleRequestId) - seedFrom(b.id + shuffleRequestId))
    const n = Math.max(roster.length, 1)

    const measure = () => {
      const r = back.getBoundingClientRect()
      const s = r.width / VB.w
      return {
        s,
        cx: r.left + GLOBE.cx * s,
        cy: r.top + GLOBE.cy * s,
        R: GLOBE.r * s - 3,
        chuteX: r.left + CHUTE.x * s,
        chuteY: r.top + CHUTE.y * s,
        bottom: r.top + VB.h * s,
      }
    }
    const g0 = measure()
    // Capsule size: fill ~40% of the globe regardless of player count (a big
    // group gets smaller capsules, down to a floor where the emoji still read).
    const rc = Math.max(12, Math.min(26, Math.round(g0.R * Math.sqrt(0.4 / n))))
    const D = rc * 2

    const enterStagger = Math.max(55, Math.min(120, 700 / n))
    const actors: Actor[] = roster.map((p, i) => {
      const seed = seedFrom(p.id + shuffleRequestId)
      const el = actorEls.current[p.id]
      if (el?.root) {
        el.root.style.width = `${D}px`
        el.root.style.height = `${D}px`
        el.root.style.opacity = '0'
        el.root.style.boxShadow = 'none'
      }
      if (el?.face) {
        el.face.style.fontSize = `${Math.round(rc * 1.05)}px`
        el.face.style.background = 'transparent'
        el.face.style.border = '0'
        el.face.style.transform = ''
      }
      for (const shell of [el?.top, el?.bottom]) {
        if (shell) {
          shell.style.opacity = '0'
          shell.style.transform = ''
        }
      }
      return {
        id: p.id,
        isMe: !!myPlayerId && p.id === myPlayerId,
        seed,
        mode: 'waiting',
        t: 0,
        enterAt: t0 + INTRO_MS - 140 + i * enterStagger,
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        startScale: 1,
        ball: { x: 0, y: 0, vx: 0, vy: 0, r: rc, rot: 0 },
        exitAt: null,
        trayDir: 0,
        spin: seed > 0.5 ? 1 : -1,
        teamId: null,
        teamColor: '#FFFFFF',
        opened: false,
        slotSize: SLOT,
      }
    })

    // Machine drops in with squash & stretch.
    const drop: Keyframe[] = [
      { transform: 'translateY(-115%) scale(.92, 1.06)', opacity: 0 },
      { transform: 'translateY(3%) scale(1.06, .9)', opacity: 1, offset: 0.58 },
      { transform: 'translateY(-2%) scale(.98, 1.03)', offset: 0.8 },
      { transform: 'translateY(0) scale(1, 1)', opacity: 1 },
    ]
    for (const el of [back, front]) {
      if (typeof el.animate === 'function') el.animate(drop, { duration: INTRO_MS, easing: 'cubic-bezier(.3,.7,.4,1)' })
    }

    let raf = 0
    let last = t0
    let dustDone = false
    let dispenseStart: number | null = null
    let lastBallInAt = t0 + INTRO_MS
    let subtitleNow: 'mixing' | 'dealing' | 'suspense' | 'none' = 'mixing'
    const showSubtitle = (v: typeof subtitleNow) => {
      if (subtitleNow === v) return
      subtitleNow = v
      setSubtitle(v)
    }
    let lastWhoosh = 0
    let shakeKickAt = -1e9
    let shakeAmp = 0
    let crankAngle = 0
    let crankSpeed = 120
    let suspense = false
    let finaleAt: number | null = null
    let finished = false

    function plan(now: number) {
      const L = live.current
      const teamOf = new Map<string, { teamId: string; color: string }>()
      L.teams.forEach((t, i) => {
        for (const p of L.playersByTeam.get(t.id) ?? []) teamOf.set(p.id, { teamId: t.id, color: TEAM_COLORS[i % TEAM_COLORS.length] })
      })
      // Big groups deal faster so the show doesn't drag.
      const stagger = Math.max(n > 12 ? 105 : 140, Math.min(300, 1300 / n))
      const others = actors.filter((a) => !a.isMe)
      let at = now + 240
      others.forEach((a, k) => {
        a.exitAt = at
        a.trayDir = k % 2 === 0 ? -1 : 1
        at += stagger
      })
      // Yours isn't scheduled here — it waits until everyone else has landed
      // (see the frame loop), so the stage is clear for its moment.
      for (const a of actors) {
        const info = teamOf.get(a.id)
        a.teamId = info?.teamId ?? null
        a.teamColor = info?.color ?? '#FFFFFF'
      }
      dispenseStart = now
      showSubtitle('dealing')
    }

    function landActor(a: Actor, now: number) {
      a.mode = 'done'
      a.t = now
      const el = actorEls.current[a.id]
      if (el?.root) el.root.style.opacity = '0'
      const slot = slotRefs.current[a.id]
      const box = a.teamId ? boxRefs.current[a.teamId] : null
      if (slot) {
        const r = slot.getBoundingClientRect()
        burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: a.isMe ? 30 : 14, colors: [a.teamColor, '#FFFFFF'], speed: [90, a.isMe ? 360 : 240], gravity: 250, drag: 3, life: [0.35, 0.7], size: [2, 4.5], shapes: ['spark', 'dot', 'star'] })
      }
      if (box && typeof box.animate === 'function' && !a.isMe) {
        box.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.045)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)' })
      }
      setLanded((prev) => ({ ...prev, [a.id]: true }))
      if (a.isMe) {
        setMyLanded(true)
        showSubtitle('none')
        if (box) {
          const r = box.getBoundingClientRect()
          burst({ x: r.left + r.width / 2, y: r.top + 10, count: 70, colors: [a.teamColor, '#FFD166', '#FFFFFF', '#FF6FA3', '#8C6BFF'], speed: [260, 620], spread: Math.PI * 1.2, gravity: 900, life: [1, 1.7], shapes: ['confetti', 'confetti', 'star'] })
        }
      }
    }

    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      const g = measure()
      const elapsed = now - t0

      if (!dustDone && elapsed > INTRO_MS * 0.58) {
        dustDone = true
        for (const side of [-1, 1]) {
          burst({ x: g.cx + side * 70 * g.s, y: g.bottom - 4, count: 9, colors: ['rgba(200,190,255,.9)', '#FFFFFF'], speed: [60, 170], angle: side < 0 ? Math.PI : 0, spread: 0.9, gravity: 200, drag: 2.5, life: [0.3, 0.55], size: [2, 3.5], shapes: ['dot'] })
        }
      }

      // ── schedule the dispense once everyone's in, mixed, and the result is known
      const allIn = actors.every((a) => a.mode !== 'waiting' && a.mode !== 'flyin')
      if (dispenseStart === null && allIn && now - lastBallInAt >= MIN_TUMBLE_MS && live.current.resultsReady) plan(now)

      const me = actors.find((a) => a.isMe)
      if (dispenseStart !== null && me && me.exitAt === null && actors.every((a) => a.isMe || a.mode === 'done')) {
        me.exitAt = now + MY_SUSPENSE_GAP_MS
        suspense = true
        showSubtitle('suspense')
      }
      const balls = actors.filter((a) => a.mode === 'ball')
      const onlyMeLeft = dispenseStart !== null && balls.length === 1 && balls[0].isMe
      const rumble = suspense && onlyMeLeft
      const strength = dispenseStart === null ? 1 : rumble ? 1.45 : onlyMeLeft ? 0.9 : balls.length > 0 ? 0.55 : 0

      // ── air jets + periodic whoosh
      if (strength > 0) {
        for (const a of balls) {
          const b = a.ball
          if (b.y > g.R * 0.3) b.vy -= 2500 * dt * strength * (0.5 + Math.random())
          b.vx += (Math.random() - 0.5) * 700 * dt * strength
        }
        if (now - lastWhoosh > WHOOSH_MS && balls.length > 0) {
          lastWhoosh = now
          for (const a of balls) {
            a.ball.vy -= (250 + Math.random() * 320) * strength
            a.ball.vx += (Math.random() - 0.5) * 520 * strength
          }
          shakeKickAt = now
          shakeAmp = 1.3 * strength
        }
      }
      stepBalls(
        balls.map((a) => a.ball),
        dt,
        { radius: g.R, gravity: 1500, restitution: 0.56, friction: 0.985 },
      )

      // ── machine: shake, crank, chase lights
      if (elapsed > INTRO_MS) {
        const deg = dampedSpring(now - shakeKickAt, shakeAmp, 7, 6) + (rumble ? Math.sin(now / 24) * 1.3 : 0)
        const tf = deg ? `rotate(${deg.toFixed(3)}deg)` : ''
        back.style.transform = tf
        front.style.transform = tf
      }
      crankSpeed = lerp(crankSpeed, strength > 0 ? 300 : 40, 0.04)
      crankAngle = (crankAngle + crankSpeed * dt) % 360
      crankRef.current?.setAttribute('transform', `rotate(${crankAngle.toFixed(1)} ${CRANK.x} ${CRANK.y})`)
      const chase = Math.floor(now / 85) % BULB_COUNT
      bulbRefs.current.forEach((b, k) => {
        if (!b) return
        const on = finaleAt !== null ? true : rumble ? Math.floor(now / 110) % 2 === 0 : (k - chase + BULB_COUNT) % BULB_COUNT < 2
        b.setAttribute('opacity', on ? '1' : '0.25')
      })

      // ── actors
      for (const a of actors) {
        const el = actorEls.current[a.id]
        const root = el?.root
        if (!root) {
          // Not rendered (e.g. left mid-show) — drop out rather than stall the dispense.
          a.mode = 'done'
          continue
        }
        let x = 0
        let y = 0
        let rot = 0
        let sx = 1
        let sy = 1
        let z = 2
        let opacity = 1
        const age = now - a.t

        if (a.mode === 'waiting') {
          if (now < a.enterAt) continue
          a.mode = 'flyin'
          a.t = now
          const rect = startRects[a.id]
          a.from = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: g.cx + (a.seed - 0.5) * 200, y: window.innerHeight + D }
          a.startScale = rect ? Math.max(0.6, Math.min(1.6, rect.width / D)) : 0.8
          continue
        }

        if (a.mode === 'flyin') {
          const p = clamp01(age / FLY_IN_MS)
          const entry = { x: g.cx + (a.seed - 0.5) * g.R * 0.7, y: g.cy - g.R + rc + 2 }
          const k = ease.inOutCubic(p)
          x = lerp(a.from.x, entry.x, k)
          y = lerp(a.from.y, entry.y, k) - Math.sin(Math.PI * p) * 110
          const sc = lerp(a.startScale, 1, ease.outCubic(p))
          sx = sc * (p < 0.5 ? 1 - 0.1 * Math.sin(Math.PI * p * 2) : 1)
          sy = sc * (p < 0.5 ? 1 + 0.12 * Math.sin(Math.PI * p * 2) : 1)
          rot = a.spin * 360 * ease.inOutCubic(p)
          z = p < 0.8 ? 6 : 2
          if (p >= 1) {
            a.mode = 'ball'
            a.t = now
            a.ball.x = entry.x - g.cx
            a.ball.y = entry.y - g.cy
            a.ball.vx = (a.seed - 0.5) * 300
            a.ball.vy = 140
            a.ball.rot = 0
            lastBallInAt = now
            sparkle(entry.x, entry.y, CAPSULE_COLORS[Math.floor(a.seed * CAPSULE_COLORS.length)])
          }
        } else if (a.mode === 'ball') {
          x = g.cx + a.ball.x
          y = g.cy + a.ball.y
          rot = a.ball.rot
          // Shells snap shut around the avatar as it drops in.
          const snap = clamp01(age / 160)
          if (el.top) {
            el.top.style.opacity = String(snap)
            el.top.style.transform = snap < 1 ? `translateY(${(-(1 - ease.outBack(snap, 2.2)) * rc).toFixed(1)}px)` : ''
          }
          if (el.bottom) {
            el.bottom.style.opacity = String(snap)
            el.bottom.style.transform = snap < 1 ? `translateY(${((1 - ease.outBack(snap, 2.2)) * rc).toFixed(1)}px)` : ''
          }
          if (a.exitAt !== null && now >= a.exitAt) {
            a.mode = 'exit'
            a.t = now
            a.from = { x, y }
            crankSpeed = 1100
            shakeKickAt = now
            shakeAmp = 1.8
          }
        } else if (a.mode === 'exit') {
          const p = clamp01(age / EXIT_MS)
          const k = ease.inCubic(p)
          x = lerp(a.from.x, g.cx, k)
          y = lerp(a.from.y, g.cy + g.R - rc * 0.4, k)
          sx = sy = 1 - 0.3 * k
          opacity = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1
          if (p >= 1) {
            a.mode = 'chute'
            a.t = now
          }
        } else if (a.mode === 'chute') {
          opacity = 0
          if (age >= CHUTE_MS) {
            a.mode = 'popout'
            a.t = now
            a.from = { x: g.chuteX, y: g.chuteY }
            a.to = { x: g.cx + a.trayDir * (D + 14), y: g.bottom + rc + 8 }
            burst({ x: g.chuteX, y: g.chuteY, count: 8, colors: ['#FFFFFF', '#FFE9A6'], speed: [80, 200], angle: Math.PI / 2, spread: 1.6, gravity: 400, drag: 2, life: [0.25, 0.45], size: [2, 3], shapes: ['dot'] })
          }
        } else if (a.mode === 'popout') {
          const p = clamp01(age / POPOUT_MS)
          const k = ease.outCubic(p)
          x = lerp(a.from.x, a.to.x, k)
          y = lerp(a.from.y, a.to.y, k) - Math.sin(Math.PI * p) * 54
          const sc = 0.55 + 0.45 * ease.outBack(p, 2)
          sx = sy = sc
          rot = a.spin * 300 * k
          z = 6
          if (p >= 1) {
            a.mode = 'wobble'
            a.t = now
            if (a.isMe && el.root) el.root.style.boxShadow = '0 0 0 3px rgba(255,209,102,.9), 0 0 30px rgba(255,209,102,.8)'
          }
        } else if (a.mode === 'wobble') {
          const dur = a.isMe ? MY_WOBBLE_MS : WOBBLE_MS
          const ramp = clamp01(age / dur)
          x = a.to.x
          y = a.to.y
          z = 6
          // Landing squash, then a rattle — yours builds up instead of settling.
          const squash = dampedSpring(age, 0.16, 5, 9)
          sx = 1 + squash
          sy = 1 - squash
          if (a.isMe) {
            rot = Math.sin(age / 24) * (4 + 14 * ramp)
            const pulse = 1 + 0.07 * ramp + 0.03 * Math.sin(age / 45)
            sx *= pulse
            sy *= pulse
          } else {
            rot = Math.sin(age / 30) * 12 * (1 - ramp)
          }
          if (age >= dur) {
            a.mode = 'open'
            a.t = now
            a.opened = true
            if (el.root) el.root.style.boxShadow = 'none'
            if (el.face) {
              el.face.style.background = rgba(a.teamColor, 0.35)
              el.face.style.border = `2.5px solid ${a.teamColor}`
            }
            const big = a.isMe
            burst({ x, y, count: big ? 100 : 20, colors: [a.teamColor, a.teamColor, '#FFFFFF', shade(a.teamColor, 0.75)], speed: [big ? 340 : 180, big ? 880 : 420], spread: Math.PI * 1.5, gravity: 950, life: [0.8, big ? 1.9 : 1.1], size: big ? [7, 12] : [5, 9], shapes: big ? ['confetti', 'confetti', 'star'] : ['confetti', 'dot'] })
            burst({ x, y, count: big ? 34 : 8, colors: ['#FFFFFF'], speed: [400, big ? 1000 : 700], gravity: 150, drag: 2.5, life: [0.25, 0.5], size: [2, 3], shapes: ['spark'] })
          }
        } else if (a.mode === 'open') {
          const p = clamp01(age / OPEN_MS)
          const k = ease.outCubic(p)
          x = a.to.x
          y = a.to.y
          z = 6
          if (el.top) {
            el.top.style.transform = `translate(${(-22 * k).toFixed(1)}px, ${(-58 * k).toFixed(1)}px) rotate(${(-80 * k).toFixed(1)}deg)`
            el.top.style.opacity = String(1 - p)
          }
          if (el.bottom) {
            el.bottom.style.transform = `translate(${(18 * k).toFixed(1)}px, ${(36 * k).toFixed(1)}px) rotate(${(60 * k).toFixed(1)}deg)`
            el.bottom.style.opacity = String(1 - p)
          }
          const pop = p < 0.35 ? lerp(1, 1.45, p / 0.35) : lerp(1.45, 1.12, (p - 0.35) / 0.65)
          sx = sy = pop
          if (p >= 1) {
            const slot = a.teamId ? slotRefs.current[a.id] : null
            if (!slot) {
              a.mode = 'done'
              opacity = 0
            } else {
              const r = slot.getBoundingClientRect()
              a.mode = 'hop'
              a.t = now
              a.from = { x, y }
              a.to = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
              a.slotSize = r.width
            }
          }
        } else if (a.mode === 'hop') {
          const dur = a.isMe ? MY_HOP_MS : HOP_MS
          const p = clamp01(age / dur)
          z = 6
          if (p < 0.12) {
            // Crouch before the jump.
            const c = Math.sin((p / 0.12) * Math.PI)
            x = a.from.x
            y = a.from.y
            sx = 1.12 * (1 + 0.14 * c)
            sy = 1.12 * (1 - 0.18 * c)
          } else {
            const f = (p - 0.12) / 0.88
            const k = ease.inOutCubic(f)
            const apex = a.isMe ? 170 : 110
            x = lerp(a.from.x, a.to.x, k)
            y = lerp(a.from.y, a.to.y, k) - Math.sin(Math.PI * f) * apex
            const size = lerp(1.12, a.slotSize / D, k)
            const stretch = Math.sin(Math.PI * f) * 0.12
            sx = size * (1 - stretch)
            sy = size * (1 + stretch)
            rot = a.isMe ? 360 * a.spin * k : Math.sin(Math.PI * f) * 16 * a.spin
            if (a.isMe && f > 0.1 && f < 0.95) sparkle(x, y, a.teamColor)
          }
          if (p >= 1) {
            landActor(a, now)
            continue
          }
        } else if (a.mode === 'done') {
          continue
        }

        root.style.zIndex = String(z)
        root.style.opacity = opacity.toFixed(3)
        root.style.transform = `translate(${(x - rc).toFixed(1)}px, ${(y - rc).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      }

      // ── finale once the last one lands
      if (dispenseStart !== null && finaleAt === null && actors.every((a) => a.mode === 'done')) finaleAt = now + FINALE_DELAY_MS
      if (finaleAt !== null && !finished && now >= finaleAt) {
        finished = true
        showSubtitle('none')
        setStage('done')
        setMachineGone(true)
      }

      if (!finished) raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      back.style.transform = ''
      front.style.transform = ''
    }
    // One run per shuffle; players/startRects are snapshotted at its start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shuffleRequestId, mode])

  if (!open) return null

  const ready = resultsReady && teams.length > 0
  const boxCount = ready ? teams.length : Math.max(1, numTeamsPredicted)
  const boxes = Array.from({ length: boxCount }, (_, i) => {
    const t = ready ? teams[i] : undefined
    return {
      id: t?.id ?? `shell-${i}`,
      name: boxCount === 1 ? "Everyone's on one team" : (t?.name ?? TEAM_NAMES[i % TEAM_NAMES.length]),
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      members: t ? (playersByTeam.get(t.id) ?? []) : [],
    }
  })

  const done = stage === 'done'
  const showActions = done && !skipAnimation
  const title =
    mode === 'quick' ? (cheered || done ? "EVERYONE'S IN!" : 'SQUAD UP!') : done ? (boxCount === 1 ? "EVERYONE'S IN!" : 'TEAMS ARE SET!') : 'SHUFFLING'
  const titlePopped = mode === 'quick' ? cheered || done : done

  // Sizing for bigger groups, so the whole show still fits a small phone:
  //  - compact (3–4 teams, or big teams): tighter slots, smaller machine, and
  //    names held back until the finale (when the machine's gone and there's room)
  //  - wide (≤2 teams of 5+): each box full-width instead of two tall columns
  const maxMembers = ready
    ? Math.max(0, ...boxes.map((b) => b.members.length))
    : Math.ceil(players.length / Math.max(1, boxCount))
  const compact = boxCount > 2 || maxMembers > 4
  const wide = boxCount <= 2 && maxMembers > 4
  const namesShown = !compact || done || mode !== 'gacha'
  const slot = compact ? 34 : SLOT
  const col = compact ? 42 : 52
  const machineStyle: CSSProperties = {
    position: 'relative',
    width: compact ? 'min(200px, 52vw, calc(26dvh * 0.8))' : 'min(232px, 58vw, calc(34dvh * 0.8))',
    aspectRatio: `${VB.w} / ${VB.h}`,
    margin: '0 auto',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', overflow: 'hidden' }}>
      <Starfield />
      <ParticleLayer zIndex={120} />
      {/* Spotlight behind the machine. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(40% 32% at 50% 30%, rgba(140,107,255,.28), transparent 70%)',
          opacity: machineGone ? 0 : 1,
          transition: 'opacity .8s ease',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          padding: '22px 16px',
          boxSizing: 'border-box',
          gap: 14,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
          <WaveTitle key={title} text={title} variant={titlePopped ? 'pop' : 'wave'} />
          <button
            type="button"
            onClick={onDismiss}
            aria-label={showActions ? 'Back to lobby settings' : 'Skip to lobby'}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', font: '500 13px var(--font-body)', cursor: 'pointer' }}
          >
            {showActions ? '‹ Back' : 'Skip'}
          </button>
        </div>
        <div style={{ minHeight: 18, textAlign: 'center', marginTop: -6 }}>
          {mode === 'gacha' && subtitle === 'mixing' && (
            <span style={{ font: '500 14px var(--font-body)', color: 'var(--text-muted)', animation: 'reveal-fade-in .4s ease-out both' }}>
              Mixing up the teams…
            </span>
          )}
          {mode === 'gacha' && subtitle === 'dealing' && (
            <span style={{ font: '600 14px var(--font-body)', color: 'var(--text)', animation: 'reveal-fade-in .35s ease-out both', display: 'inline-block' }}>
              Dealing out the teams!
            </span>
          )}
          {subtitle === 'suspense' && (
            <span
              style={{
                font: '800 18px var(--font-display)',
                color: 'var(--gold)',
                textShadow: '0 0 16px rgba(255,209,102,.6)',
                animation: 'title-pop .45s cubic-bezier(.3,1.7,.5,1) both',
                display: 'inline-block',
              }}
            >
              And you're on…
            </span>
          )}
        </div>

        {mode === 'gacha' && (
          <div
            style={{
              // Collapses once the show's over, gliding the team boxes up into its place.
              maxHeight: machineGone ? 0 : 520,
              // Visible while running so the drop-in isn't clipped; hidden while collapsing.
              overflow: machineGone ? 'hidden' : 'visible',
              opacity: machineGone ? 0 : 1,
              paddingBottom: machineGone ? 0 : 58,
              transition: 'max-height .7s cubic-bezier(.65,0,.35,1), opacity .45s ease, padding-bottom .7s cubic-bezier(.65,0,.35,1)',
            }}
          >
            <div style={machineStyle}>
              <MachineBack svgRef={backRef} />
              <MachineFront svgRef={frontRef} crankRef={crankRef} bulbRefs={bulbRefs} />
            </div>
          </div>
        )}

        <div aria-hidden style={{ flexGrow: done || mode !== 'gacha' ? 1 : 0, transition: 'flex-grow .8s cubic-bezier(.65,0,.35,1)' }} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: boxCount === 1 || wide ? '1fr' : '1fr 1fr',
            gap: 12,
            alignContent: 'start',
            marginTop: mode === 'gacha' ? 0 : 20,
          }}
        >
          {boxes.map((box, i) => {
            const isMine = !!myTeamId && box.id === myTeamId
            const zoom = isMine && myLanded
            const spanFull = !wide && boxCount > 1 && boxCount % 2 === 1 && i === boxCount - 1
            return (
              <div
                key={box.id}
                ref={(el) => void (boxRefs.current[box.id] = el)}
                style={{
                  position: 'relative',
                  gridColumn: spanFull ? '1 / -1' : undefined,
                  borderRadius: 20,
                  padding: compact ? '12px 6px 10px' : '14px 10px 12px',
                  background: `radial-gradient(120% 100% at 50% 0%, ${rgba(box.color, zoom ? 0.34 : 0.2)}, ${rgba(box.color, 0.04)} 75%)`,
                  border: `1.5px solid ${rgba(box.color, zoom ? 0.85 : ready ? 0.35 : 0.18)}`,
                  boxShadow: zoom ? `0 0 34px ${rgba(box.color, 0.45)}` : 'none',
                  transform: !boxShown ? 'scale(.8) translateY(14px)' : zoom ? 'scale(1.05) translateY(-2px)' : 'scale(1)',
                  opacity: !boxShown ? 0 : ready ? 1 : 0.55,
                  zIndex: zoom ? 2 : 1,
                  transition: 'transform .55s cubic-bezier(.3,1.6,.5,1), box-shadow .5s ease, border-color .4s ease, opacity .4s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: compact ? 8 : 10,
                }}
              >
                {zoom && boxCount > 1 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -11,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'linear-gradient(180deg,#FFE9A6,#F5BE4F)',
                      color: '#1A1233',
                      font: '800 10px/1 var(--font-body)',
                      letterSpacing: '.14em',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 4px 14px rgba(245,190,79,.5)',
                      animation: 'badge-pop .5s cubic-bezier(.3,1.8,.5,1) both',
                    }}
                  >
                    YOU'RE ON
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: `700 ${boxCount === 1 ? 18 : compact ? 14 : 15}px/1.15 var(--font-display)`, color: 'var(--text)', textAlign: 'center' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: box.color, boxShadow: `0 0 8px ${box.color}`, flex: 'none' }} />
                  {box.name}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: compact ? 6 : 10, minHeight: slot + (namesShown ? 16 : 0) }}>
                  {!ready &&
                    [0, 1].map((k) => (
                      <span key={k} style={{ width: slot, height: slot, borderRadius: '50%', border: '2px dashed rgba(255,255,255,.18)', animation: `slot-wait 1.2s ease-in-out ${k * 180}ms infinite` }} />
                    ))}
                  {box.members.map((p) => {
                    const isLanded = !!landed[p.id]
                    const isMe = !!myPlayerId && p.id === myPlayerId
                    return (
                      <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: namesShown ? 4 : 0, width: col, transition: 'gap .5s ease' }}>
                        <div
                          ref={(el) => void (slotRefs.current[p.id] = el)}
                          style={{
                            width: slot,
                            height: slot,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: compact ? 18 : 21,
                            border: isLanded ? `2px solid ${box.color}` : '2px dashed rgba(255,255,255,.2)',
                            background: isLanded ? rgba(box.color, 0.3) : 'transparent',
                            boxShadow: isLanded && isMe ? '0 0 0 3px #120F2E, 0 0 0 5px #fff' : 'none',
                            animation: isLanded ? `slot-land .45s cubic-bezier(.3,1.7,.5,1) 0ms both` : undefined,
                          }}
                        >
                          {isLanded ? p.avatar : ''}
                        </div>
                        <span
                          style={{
                            maxWidth: col,
                            maxHeight: namesShown ? 16 : 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            font: `${isMe ? 700 : 600} ${compact ? 10 : 11}px var(--font-body)`,
                            color: isMe ? 'var(--text)' : 'var(--text-muted)',
                            opacity: isLanded && namesShown ? 1 : 0,
                            transition: 'opacity .35s ease .25s, max-height .5s cubic-bezier(.65,0,.35,1)',
                          }}
                        >
                          {isMe ? 'You' : p.display_name}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div aria-hidden style={{ flexGrow: 1 }} />

        {/* Huddle avatars + chant (single team) — positioned every frame by the huddle loop. */}
        {mode === 'quick' &&
          players.map((p) => (
            <div
              key={p.id}
              ref={(el) => void (huddleEls.current[p.id] = el)}
              aria-hidden
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                width: 56,
                height: 56,
                opacity: 0,
                zIndex: 6,
                pointerEvents: 'none',
                willChange: 'transform',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                background: rgba(TEAM_COLORS[0], 0.32),
                border: `2.5px solid ${TEAM_COLORS[0]}`,
                boxShadow: p.id === myPlayerId ? '0 0 0 3px #fff, 0 8px 20px rgba(0,0,0,.35)' : '0 8px 20px rgba(0,0,0,.35)',
                boxSizing: 'border-box',
              }}
            >
              {p.avatar}
            </div>
          ))}
        {mode === 'quick' && (
          <div
            ref={chantRef}
            aria-hidden
            style={{
              position: 'fixed',
              left: '50%',
              top: '18%',
              transform: 'translate(-50%, -50%)',
              opacity: 0,
              zIndex: 7,
              pointerEvents: 'none',
              font: '800 48px/1 var(--font-display)',
              color: '#FFE9A6',
              WebkitTextStroke: '1.5px rgba(255,255,255,.4)',
              textShadow: '0 0 26px rgba(255,209,102,.75), 0 4px 0 rgba(0,0,0,.25)',
              whiteSpace: 'nowrap',
            }}
          />
        )}

        {/* Capsules / avatars — positioned every frame by the loop above. */}
        {mode === 'gacha' &&
          players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                const cur = actorEls.current[p.id] ?? { root: null, top: null, bottom: null, face: null }
                cur.root = el
                actorEls.current[p.id] = cur
              }}
              aria-hidden
              style={{ position: 'fixed', left: 0, top: 0, width: 44, height: 44, opacity: 0, pointerEvents: 'none', willChange: 'transform', zIndex: 2, borderRadius: '50%' }}
            >
              <div
                ref={(el) => void ((actorEls.current[p.id] ??= { root: null, top: null, bottom: null, face: null }).bottom = el)}
                style={(() => {
                  const c = CAPSULE_COLORS[Math.floor(seedFrom(p.id + shuffleRequestId) * CAPSULE_COLORS.length)]
                  return {
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '50%',
                    borderRadius: '0 0 999px 999px',
                    background: `linear-gradient(180deg, ${c}, ${shade(c, 0.7)})`,
                    boxShadow: 'inset 0 -4px 7px rgba(0,0,0,.25)',
                    border: '1.5px solid rgba(26,18,51,.55)',
                    borderTop: 'none',
                    boxSizing: 'border-box',
                  } as CSSProperties
                })()}
              />
              <div
                ref={(el) => void ((actorEls.current[p.id] ??= { root: null, top: null, bottom: null, face: null }).face = el)}
                style={{ position: 'absolute', inset: '9%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, boxSizing: 'border-box' }}
              >
                {p.avatar}
              </div>
              <div
                ref={(el) => void ((actorEls.current[p.id] ??= { root: null, top: null, bottom: null, face: null }).top = el)}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: '50%',
                  borderRadius: '999px 999px 0 0',
                  background: 'linear-gradient(180deg, rgba(255,255,255,.5), rgba(255,255,255,.14))',
                  border: '1.5px solid rgba(255,255,255,.55)',
                  borderBottom: '2px solid rgba(255,255,255,.75)',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ position: 'absolute', left: '22%', top: '22%', width: '26%', height: '22%', borderRadius: '50%', background: 'rgba(255,255,255,.8)', transform: 'rotate(-25deg)' }} />
              </div>
            </div>
          ))}

        {showActions && canAct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'reveal-fade-in .45s ease-out .15s both' }}>
            {startError && (
              <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14, textAlign: 'center' }}>
                {startError}
              </span>
            )}
            <Btn kind="primary" size="lg" label={starting ? 'Starting…' : 'Start game'} onClick={onStartGame} disabled={starting} />
            <Btn kind="secondary" size="md" label={shuffling ? 'Shuffling…' : 'Reshuffle'} onClick={onReshuffle} disabled={shuffling || starting} />
          </div>
        )}
        {showActions && !canAct && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, animation: 'reveal-fade-in .45s ease-out .15s both' }}>
            <span style={{ display: 'flex', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)' }} />
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', opacity: 0.6 }} />
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', opacity: 0.3 }} />
            </span>
            <span style={{ font: '500 15px var(--font-body)', color: 'var(--text-muted)' }}>Waiting for the host to start</span>
          </div>
        )}
      </div>
    </div>
  )
}
