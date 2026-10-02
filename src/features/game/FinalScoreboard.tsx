import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Starfield } from '../../components/Starfield'
import { Logo } from '../../components/Logo'
import { Btn } from '../../components/Btn'
import { ParticleLayer } from '../../components/fx/ParticleLayer'
import { burst, sparkle } from '../../components/fx/particles'
import { TEAM_COLORS, colorForTeam } from '../../components/TeamScoreboard'
import { dampedSpring, prefersReducedMotion } from '../../lib/motion'

type Team = { id: string; name: string; score: number }
type Player = { id: string; display_name: string; avatar: string; team_id?: string | null }

/**
 * The end of the game, as a show: the Podium Race.
 *
 *   every team gets a lane → all bars climb together on one shared points
 *   clock, so lower scores stop first and the leader keeps going alone →
 *   the winner tops out: flash, spotlight, a crown drops onto the bar,
 *   confetti cannons → buttons.
 *
 * A single team has no one to beat, so it races its own potential instead:
 * the bar climbs a meter with level lines ("Solid" → "In sync" → "Mind
 * readers") that light up as it passes them, and the title is the highest
 * level reached.
 *
 * Only plays when `celebrate` is set (this client watched the game end);
 * a refresh or reduced motion shows the settled result straight away.
 * Per-frame motion is one rAF loop writing to refs; React state changes a
 * handful of times per run.
 */

const INTRO_MS = 750
// The drumroll's final hit lands 3.58s in (public/sounds/drumroll.mp3), so the
// race is timed to top out exactly on it, with the ta-da layered on top.
const DRUM_HIT_MS = 3580
const COUNT_MS = DRUM_HIT_MS - INTRO_MS
const CROWN_DELAY_MS = 140
const CROWN_FALL_MS = 420
const BUTTONS_AFTER_MS = 1000
const LOOP_TAIL_MS = 5200
// Room above each bar for the score counter and (on the winner) the crown.
const RESERVED_PX = 72
const MIN_F = 0.025
const LEVELS = [
  { at: 0.4, label: 'Solid' },
  { at: 0.6, label: 'In sync' },
  { at: 0.8, label: 'Mind readers' },
]

type Phase = 'intro' | 'won' | 'done'

type Lane = {
  team: Team
  color: string
  members: Player[]
  isWinner: boolean
  /** Final bar fill, 0..1 of the lane's height. */
  f: number
}

/** The shared points clock: steady climb, easing off near the top so the
 * last stretch (usually just the leader) hangs for a moment. */
function pointsAt(u: number, max: number) {
  const c = Math.max(0, Math.min(1, u))
  return max * (1 - Math.pow(1 - c, 1.8))
}

/** Inverse of pointsAt — when (in 0..1 of the count) a bar reaches `s`. */
function landU(s: number, max: number) {
  if (max <= 0) return 0
  return 1 - Math.pow(1 - Math.min(1, s / max), 1 / 1.8)
}

function singleLevel(r: number) {
  if (r >= 0.8) return { title: 'MIND READERS!', tier: 3 }
  if (r >= 0.6) return { title: 'TOTALLY IN SYNC!', tier: 2 }
  if (r >= 0.4) return { title: 'SOLID TEAMWORK!', tier: 1 }
  if (r > 0) return { title: 'WARMING UP!', tier: 0 }
  return { title: 'WELL… YOU TRIED!', tier: -1 }
}

function BigTitle({ text, variant, color }: { text: string; variant: 'wave' | 'pop'; color?: string }) {
  let i = 0
  return (
    <h1
      aria-label={text}
      style={{
        margin: 0,
        font: '800 clamp(30px, 9vw, 42px)/1.08 var(--font-display)',
        letterSpacing: '.03em',
        textAlign: 'center',
        textWrap: 'balance',
        color: color ?? 'var(--text)',
        textShadow: `0 0 22px ${color ? `${color}73` : 'rgba(255,209,102,.4)'}`,
      }}
    >
      {text.split(' ').map((word, w) => (
        <span key={`${variant}${w}`} aria-hidden style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
          {w > 0 && <span style={{ display: 'inline-block', width: '.28em' }} />}
          {word.split('').map((ch) => {
            const k = i++
            return (
              <span
                key={k}
                style={{
                  display: 'inline-block',
                  animation:
                    variant === 'wave'
                      ? `title-wave 1.1s ease-in-out ${k * 60}ms infinite`
                      : `title-pop .5s cubic-bezier(.3,1.7,.5,1) ${k * 30}ms both`,
                }}
              >
                {ch}
              </span>
            )
          })}
        </span>
      ))}
    </h1>
  )
}

function Crown({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 64 48" aria-hidden style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`cg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF1B8" />
          <stop offset=".55" stopColor="#FFD166" />
          <stop offset="1" stopColor="#E59A2F" />
        </linearGradient>
      </defs>
      <path d="M7 39 L4 13 L20 26 L32 5 L44 26 L60 13 L57 39 Z" fill={`url(#cg${id})`} stroke="#7A4E0C" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M12 33 L10 20 L20 29" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2" strokeLinecap="round" />
      <rect x="6" y="37" width="52" height="9" rx="3.5" fill="#F5BE4F" stroke="#7A4E0C" strokeWidth="2.6" />
      <circle cx="4" cy="13" r="4" fill="#FFE9A6" stroke="#7A4E0C" strokeWidth="2" />
      <circle cx="32" cy="5" r="4.4" fill="#FFE9A6" stroke="#7A4E0C" strokeWidth="2" />
      <circle cx="60" cy="13" r="4" fill="#FFE9A6" stroke="#7A4E0C" strokeWidth="2" />
      <circle cx="20" cy="41.5" r="2.8" fill="#FF6FA3" />
      <circle cx="32" cy="41.5" r="2.8" fill="#5BD6FF" />
      <circle cx="44" cy="41.5" r="2.8" fill="#8C6BFF" />
    </svg>
  )
}

function AvatarStack({ members, myPlayerIds, color, size }: { members: Player[]; myPlayerIds: Set<string>; color: string; size: number }) {
  const overlap = Math.round(size * 0.3)
  const shown = members.length > 5 ? members.slice(0, 4) : members
  const extra = members.length - shown.length
  const chip: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.round(size * 0.55),
    background: '#241a4d',
    border: `1.5px solid ${color}`,
    boxSizing: 'border-box',
    flex: 'none',
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingLeft: overlap }}>
      {shown.map((p) => (
        <span
          key={p.id}
          title={p.display_name}
          style={{
            ...chip,
            marginLeft: -overlap,
            ...(myPlayerIds.has(p.id) ? { border: '2px solid #fff', boxShadow: `0 0 0 2px ${color}`, zIndex: 1 } : null),
          }}
        >
          {p.avatar}
        </span>
      ))}
      {extra > 0 && (
        <span style={{ ...chip, marginLeft: -overlap, font: '700 10px var(--font-body)', color: 'var(--text)' }}>+{extra}</span>
      )}
    </div>
  )
}

export function FinalScoreboard({
  teams,
  players = [],
  myPlayerId = null,
  turnsPlayed = null,
  rounds = null,
  celebrate = false,
  sound = false,
  onPlayAgain,
  onLeave,
  endedReason,
}: {
  teams: Team[]
  players?: Player[]
  myPlayerId?: string | null
  /** Revealed turns this game — how a lone team's score is judged. */
  turnsPlayed?: number | null
  /** Fallback for turnsPlayed (rounds × team size) when it's unavailable. */
  rounds?: number | null
  /** This client just watched the game end — play the show. */
  celebrate?: boolean
  /** Drumroll + ta-da with the show (the party's sound setting). */
  sound?: boolean
  onPlayAgain: () => void
  onLeave: () => void
  /** Set when the game was cut short rather than reaching its natural end — e.g. 'player_left' left a team below 2 players. */
  endedReason?: string | null
}) {
  // A game cut short because someone left gets no show — just the results.
  const [animate] = useState(() => celebrate && !prefersReducedMotion() && teams.length > 0 && endedReason !== 'player_left')
  const [phase, setPhase] = useState<Phase>(animate ? 'intro' : 'done')

  const single = teams.length === 1
  const maxScore = Math.max(0, ...teams.map((t) => t.score))
  const winners = teams.filter((t) => t.score === maxScore)
  const tie = !single && winners.length > 1
  const myPlayerIds = new Set(myPlayerId ? [myPlayerId] : [])
  const myTeamId = players.find((p) => p.id === myPlayerId)?.team_id ?? null

  // Lone team: judged against what a perfect game would have scored (4 a turn).
  const soloTeam = single ? teams[0] : null
  const soloTurns = soloTeam
    ? turnsPlayed && turnsPlayed > 0
      ? turnsPlayed
      : Math.max(1, (rounds ?? 1) * Math.max(1, players.filter((p) => p.team_id === soloTeam.id).length))
    : 1
  const soloMax = Math.max(4 * soloTurns, soloTeam?.score ?? 0)
  const soloRatio = soloTeam ? soloTeam.score / soloMax : 0
  const level = singleLevel(soloRatio)

  // Fixed lanes in color order (Pink, Sky, Violet, Gold) — a race needs its
  // lanes to stay put while the bars climb.
  const lanes: Lane[] = [...teams]
    .sort((a, b) => {
      const ca = TEAM_COLORS.indexOf(colorForTeam(teams, a.id))
      const cb = TEAM_COLORS.indexOf(colorForTeam(teams, b.id))
      return ca - cb || a.name.localeCompare(b.name)
    })
    .map((team) => ({
      team,
      color: colorForTeam(teams, team.id),
      members: players.filter((p) => p.team_id === team.id),
      isWinner: single ? level.tier >= 3 : maxScore > 0 && team.score === maxScore,
      f: single ? team.score / soloMax : maxScore > 0 ? team.score / maxScore : 0,
    }))

  const winner = !single && !tie ? winners[0] : null
  const winnerColor = winner ? colorForTeam(teams, winner.id) : soloTeam ? colorForTeam(teams, soloTeam.id) : undefined
  const runnerUp = !single ? [...teams].sort((a, b) => b.score - a.score)[1] : undefined
  const margin = winner && runnerUp ? winner.score - runnerUp.score : 0

  let finalTitle = ''
  let subtitle = ''
  if (single && soloTeam) {
    finalTitle = level.title
    subtitle = `${soloTeam.score} point${soloTeam.score === 1 ? '' : 's'} in ${soloTurns} turn${soloTurns === 1 ? '' : 's'}`
  } else if (tie) {
    finalTitle = "IT'S A TIE!"
    subtitle = maxScore === 0 ? 'Nobody scored — rematch?' : `${winners.map((t) => t.name).join(' & ')} share the crown`
  } else if (winner) {
    finalTitle = `${winner.name.toUpperCase()} WINS!`
    const by = margin === 1 ? 'by a single point!' : `by ${margin} points`
    subtitle = winner.id === myTeamId ? `That's your team — won ${by}` : `Won ${by}`
  }
  const revealed = phase !== 'intro'

  const laneTopRefs = useRef<(HTMLDivElement | null)[]>([])
  const barRefs = useRef<(HTMLDivElement | null)[]>([])
  const flashRefs = useRef<(HTMLDivElement | null)[]>([])
  const countRefs = useRef<(HTMLSpanElement | null)[]>([])
  const crownRefs = useRef<(HTMLDivElement | null)[]>([])
  const levelRefs = useRef<(HTMLDivElement | null)[]>([])
  const skipRef = useRef(false)

  // Snapshot for the one-shot animation loop (the show runs on the result
  // as it stood when the game ended).
  // Nothing to celebrate when nobody scored: no drumroll, no ta-da.
  const show = useRef({ lanes, single, soloMax, maxScore, tier: level.tier, tie, sound: sound && maxScore > 0 })

  useEffect(() => {
    if (!animate) return
    const S = show.current
    const scale = S.single ? S.soloMax : Math.max(1, S.maxScore)
    const top = S.single ? S.lanes[0].team.score : S.maxScore
    const D = COUNT_MS
    const impactAt = INTRO_MS + D
    const lands = S.lanes.map((l) => (l.isWinner || S.single ? impactAt : INTRO_MS + landU(l.team.score, top) * D))
    const landed = S.lanes.map(() => false)
    const levelLit = LEVELS.map(() => false)
    // null until the show starts: on the drumroll's first beat when there's
    // sound (so a slow load can't knock the final hit out of sync), else now.
    let start: number | null = S.sound ? null : performance.now()
    let raf = 0
    let impacted = false
    let buttonsShown = false
    const nextSparkle = { at: 0 }
    // The show starts on the drumroll's first beat. Missing audio (blocked
    // autoplay, slow network) just means a silent show.
    const drum = S.sound ? new Audio('/sounds/drumroll.mp3') : null
    const tada = S.sound ? new Audio('/sounds/tada.mp3') : null
    tada?.load()
    const begin = () => {
      if (start === null) start = performance.now()
    }
    let fallback: ReturnType<typeof setTimeout> | undefined
    if (drum) {
      drum.addEventListener('playing', begin, { once: true })
      drum.play()?.catch(begin)
      fallback = setTimeout(begin, 700)
    }

    function laneTopPoint(i: number) {
      const r = barRefs.current[i]?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top } : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }

    function onImpact() {
      const W = window.innerWidth
      const H = window.innerHeight
      const winnerIdx = S.lanes.map((l, i) => (l.isWinner ? i : -1)).filter((i) => i >= 0)
      for (const i of winnerIdx) {
        flashRefs.current[i]?.animate?.([{ opacity: 0.95 }, { opacity: 0 }], { duration: 450, easing: 'ease-out' })
      }
      const colors = [...new Set([...winnerIdx.map((i) => S.lanes[i].color), '#FFD166', '#FFFFFF'])]
      const big = S.single ? S.tier >= 2 : S.maxScore > 0
      if (big) {
        const count = S.single && S.tier === 2 ? 60 : 95
        setTimeout(() => {
          burst({ x: -10, y: H * 0.86, count, colors, speed: [750, 1350], angle: -1.12, spread: 0.55, gravity: 950, drag: 1.1, life: [1.6, 2.4], size: [7, 12], shapes: ['confetti', 'confetti', 'star'] })
          burst({ x: W + 10, y: H * 0.86, count, colors, speed: [750, 1350], angle: -Math.PI + 1.12, spread: 0.55, gravity: 950, drag: 1.1, life: [1.6, 2.4], size: [7, 12], shapes: ['confetti', 'confetti', 'star'] })
        }, 150)
        if (!S.single || S.tier === 3) {
          setTimeout(() => burst({ x: W / 2, y: -20, count: 70, colors, speed: [80, 260], angle: Math.PI / 2, spread: 2.4, gravity: 320, drag: 0.6, life: [2.4, 3.4], size: [6, 10], shapes: ['confetti'] }), 650)
        }
      }
      // The top of the winning bar(s) pops too.
      for (const i of S.single ? [0] : winnerIdx) {
        const p = laneTopPoint(i)
        if (S.single && S.tier < 0) continue
        const n = S.single ? [12, 30, 45, 60][S.tier] : 45
        burst({ x: p.x, y: p.y, count: n, colors: [S.lanes[i].color, '#FFFFFF', '#FFD166'], speed: [220, 620], spread: Math.PI * 1.2, gravity: 900, life: [0.9, 1.5], shapes: ['confetti', 'dot', 'star'] })
      }
    }

    function frame(now: number) {
      if (start === null) {
        raf = requestAnimationFrame(frame)
        return
      }
      if (skipRef.current && now - start < impactAt) {
        start = now - impactAt
        skipRef.current = false
        drum?.pause()
      }
      // While the drumroll plays, its own playback position is the clock:
      // frames can stall (screen dimmed, tab in the background) while audio
      // keeps going, and a separate clock then lands the ta-da anywhere but
      // on the final hit.
      if (drum && !drum.paused && !drum.ended && drum.currentTime > 0) start = now - drum.currentTime * 1000
      const t = now - start
      const pts = t < INTRO_MS ? 0 : pointsAt((t - INTRO_MS) / D, top)

      S.lanes.forEach((l, i) => {
        const value = Math.min(l.team.score, pts)
        let f = value / scale
        const landAt = lands[i]
        if (t >= landAt) {
          if (!landed[i]) {
            landed[i] = true
            if (!l.isWinner && t < landAt + 200 && t > INTRO_MS) {
              const p = laneTopPoint(i)
              burst({ x: p.x, y: p.y, count: 8, colors: [l.color, '#FFFFFF'], speed: [60, 180], spread: Math.PI, gravity: 400, life: [0.4, 0.7], size: [2, 4], shapes: ['dust', 'dot'] })
            }
          }
          f = l.f * (1 + dampedSpring(t - landAt, l.isWinner ? 0.08 : 0.05, 4.5, 7))
        }
        laneTopRefs.current[i]?.style.setProperty('--f', String(Math.max(MIN_F, f)))
        const c = countRefs.current[i]
        const shownValue = String(t >= landAt ? l.team.score : Math.floor(value))
        if (c && c.textContent !== shownValue) c.textContent = shownValue

        // Crown: falls from above the screen after impact, lands with a bounce.
        const crown = crownRefs.current[i]
        if (crown && l.isWinner) {
          const ct = t - impactAt - CROWN_DELAY_MS - i * (S.tie ? 150 : 0)
          if (ct < 0) {
            crown.style.opacity = '0'
          } else {
            crown.style.opacity = '1'
            let y: number
            let rot: number
            if (ct < CROWN_FALL_MS) {
              const u = ct / CROWN_FALL_MS
              y = -window.innerHeight * 0.6 * (1 - u * u)
              rot = -18 * (1 - u)
            } else {
              y = -Math.abs(dampedSpring(ct - CROWN_FALL_MS, 16, 2.6, 6))
              rot = dampedSpring(ct - CROWN_FALL_MS, 10, 3.2, 5)
              if (ct - CROWN_FALL_MS < 17) {
                const r = crown.getBoundingClientRect()
                burst({ x: r.left + r.width / 2, y: r.top + r.height * 0.6, count: 26, colors: ['#FFD166', '#FFF1B8', '#FFFFFF'], speed: [160, 460], spread: Math.PI * 2, gravity: 500, drag: 2, life: [0.5, 0.9], size: [3, 6], shapes: ['star', 'spark'] })
              }
            }
            crown.style.transform = `translateY(${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`
          }
        }
      })

      // Lone team: level lines light up as the bar passes them.
      if (S.single) {
        const f = Math.min(S.lanes[0].team.score, pts) / scale
        LEVELS.forEach((lv, k) => {
          if (!levelLit[k] && f >= lv.at) {
            levelLit[k] = true
            const el = levelRefs.current[k]
            if (el) {
              el.dataset.lit = '1'
              el.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' })
              const r = el.getBoundingClientRect()
              burst({ x: r.left + 4, y: r.top + r.height / 2, count: 14, colors: ['#FFD166', '#FFFFFF', S.lanes[0].color], speed: [90, 280], spread: Math.PI * 2, gravity: 300, drag: 2, life: [0.4, 0.8], size: [2, 5], shapes: ['star', 'dot'] })
            }
          }
        })
      }

      if (!impacted && t >= impactAt) {
        impacted = true
        setPhase('won')
        // Only if we're on time for the final hit — after a long stall the
        // drumroll is long over, and a late ta-da just sounds wrong.
        if (t < impactAt + 400) tada?.play()?.catch(() => {})
        onImpact()
        nextSparkle.at = t + 1600
      }
      if (!buttonsShown && t >= impactAt + BUTTONS_AFTER_MS) {
        buttonsShown = true
        setPhase('done')
      }
      // Idle glints on the crown(s) for a few seconds after.
      if (impacted && t >= nextSparkle.at && t < impactAt + LOOP_TAIL_MS) {
        nextSparkle.at = t + 1400
        S.lanes.forEach((l, i) => {
          const crown = crownRefs.current[i]
          if (!l.isWinner || !crown) return
          const r = crown.getBoundingClientRect()
          for (let k = 0; k < 3; k++) sparkle(r.left + r.width * (0.2 + Math.random() * 0.6), r.top + r.height * Math.random() * 0.5, '#FFD166')
        })
      }
      if (t < impactAt + LOOP_TAIL_MS) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(fallback)
      drum?.pause()
      tada?.pause()
    }
  }, [animate])

  const n = Math.max(1, lanes.length)
  const laneWidth = single ? 'min(112px, 30vw)' : `min(${n === 2 ? 118 : n === 3 ? 96 : 80}px, calc((100% - ${(n - 1) * 8}px) / ${n}))`

  return (
    <div
      style={{ position: 'relative', height: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}
      onPointerDown={() => {
        if (phase === 'intro') skipRef.current = true
      }}
    >
      <Starfield />
      {animate && <ParticleLayer zIndex={40} />}
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 16px 20px',
          boxSizing: 'border-box',
          gap: 12,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo variant="inline" size="sm" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.2em', color: 'var(--text-muted)' }}>
            {single ? 'FINAL SCORE' : 'GAME OVER'}
          </span>
          {/* Two lines reserved so the swap to the result never shifts the stage. */}
          <div style={{ minHeight: 'calc(2 * 1.08 * clamp(30px, 9vw, 42px))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {revealed ? (
              <BigTitle key="final" text={finalTitle} variant="pop" color={tie ? undefined : winnerColor} />
            ) : (
              <BigTitle key="suspense" text={single ? 'HOW DID YOU DO…' : 'AND THE WINNER IS…'} variant="wave" />
            )}
          </div>
          <p
            style={{
              margin: 0,
              minHeight: 20,
              font: '600 15px/1.3 var(--font-body)',
              color: 'var(--text-muted)',
              textAlign: 'center',
              opacity: revealed ? 1 : 0,
              transform: revealed ? 'none' : 'translateY(6px)',
              transition: 'opacity .4s ease .25s, transform .4s ease .25s',
            }}
          >
            {subtitle}
          </p>
          {endedReason === 'player_left' && (
            <p style={{ margin: 0, textAlign: 'center', font: '500 13px var(--font-body)', color: 'var(--text-muted)', maxWidth: 320 }}>
              A player left and their team couldn&rsquo;t keep going, so the game ended early.
            </p>
          )}
        </div>

        {/* The stage. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', gap: 8, position: 'relative' }}>
            {lanes.map((l, i) => {
              const dim = revealed && !single && !tie && !l.isWinner && maxScore > 0
              const spot = revealed && l.isWinner
              return (
                <div
                  key={l.team.id}
                  style={{
                    width: laneWidth,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    animation: animate ? `lane-in .55s cubic-bezier(.3,1.5,.5,1) ${120 + i * 90}ms both` : undefined,
                    opacity: dim ? 0.5 : 1,
                    filter: dim ? 'saturate(.55)' : 'none',
                    transition: 'opacity .6s ease, filter .6s ease',
                  }}
                >
                  <div
                    ref={(el) => void (laneTopRefs.current[i] = el)}
                    style={
                      {
                        position: 'relative',
                        flex: 1,
                        minHeight: 0,
                        ...(animate && phase !== 'done' ? {} : { '--f': Math.max(MIN_F, l.f) }),
                      } as CSSProperties
                    }
                  >
                    {/* Spotlight on the winner. */}
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: '-45%',
                        right: '-45%',
                        top: -40,
                        bottom: 0,
                        background: `linear-gradient(180deg, ${l.color}00, ${l.color}30 40%, ${l.color}14)`,
                        clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)',
                        opacity: spot ? 1 : 0,
                        transition: 'opacity .7s ease',
                        pointerEvents: 'none',
                      }}
                    />
                    <div
                      ref={(el) => void (barRefs.current[i] = el)}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: `calc((100% - ${RESERVED_PX}px) * var(--f, ${MIN_F}))`,
                        borderRadius: '16px 16px 6px 6px',
                        background: `linear-gradient(180deg, ${l.color}, ${l.color}B3 55%, ${l.color}66)`,
                        boxShadow: spot ? `0 0 34px ${l.color}90, inset 0 2px 0 rgba(255,255,255,.55)` : 'inset 0 2px 0 rgba(255,255,255,.45)',
                        transition: 'box-shadow .6s ease',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ position: 'absolute', top: 6, bottom: 6, left: 7, width: 6, borderRadius: 3, background: 'rgba(255,255,255,.28)' }} />
                      {spot && <div className="bar-shine" />}
                      <div ref={(el) => void (flashRefs.current[i] = el)} style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0 }} />
                    </div>
                    {single &&
                      LEVELS.map((lv, k) => (
                        <div
                          key={lv.label}
                          aria-hidden
                          ref={(el) => void (levelRefs.current[k] = el)}
                          data-lit={!animate && soloRatio >= lv.at ? '1' : undefined}
                          className="level-line"
                          style={{
                            position: 'absolute',
                            left: -18,
                            right: -112,
                            bottom: `calc((100% - ${RESERVED_PX}px) * ${lv.at})`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            transformOrigin: 'right center',
                            pointerEvents: 'none',
                            zIndex: 1,
                          }}
                        >
                          <span className="level-rule" style={{ flex: 1 }} />
                          <span className="level-label" style={{ width: 88, font: '700 10.5px/1 var(--font-body)', letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {lv.label}
                          </span>
                        </div>
                      ))}
                    <span
                      ref={(el) => void (countRefs.current[i] = el)}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: `calc((100% - ${RESERVED_PX}px) * var(--f, ${MIN_F}) + 4px)`,
                        textAlign: 'center',
                        font: `800 ${single ? 34 : 28}px/1 var(--font-display)`,
                        color: l.color,
                        textShadow: `0 0 16px ${l.color}66`,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {animate ? '0' : l.team.score}
                    </span>
                    {l.isWinner && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: `calc((100% - ${RESERVED_PX}px) * var(--f, ${MIN_F}) + ${single ? 40 : 34}px)`,
                          display: 'flex',
                          justifyContent: 'center',
                          pointerEvents: 'none',
                        }}
                      >
                        <div ref={(el) => void (crownRefs.current[i] = el)} style={{ opacity: animate ? 0 : 1, willChange: 'transform' }}>
                          <div style={{ animation: phase === 'done' ? 'title-wave 2.6s ease-in-out infinite' : undefined }}>
                            <Crown size={n <= 2 ? 48 : 38} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Floor + name + who. */}
                  <div style={{ height: 3, borderRadius: 2, background: `${l.color}80`, margin: '0 -2px' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, paddingTop: 7 }}>
                    <span
                      style={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        font: `700 ${n > 2 ? 12 : 14}px var(--font-body)`,
                        color: 'var(--text)',
                      }}
                    >
                      {l.team.name}
                    </span>
                    {l.members.length > 0 && <AvatarStack members={l.members} myPlayerIds={myPlayerIds} color={l.color} size={n <= 2 ? 30 : 22} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Screen-reader (and test) friendly standings, best first. */}
        <ol style={srOnly}>
          {[...teams]
            .sort((a, b) => b.score - a.score)
            .map((t) => (
              <li key={t.id} data-testid="final-team-row">
                {t.name}: {t.score}
              </li>
            ))}
        </ol>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            opacity: phase === 'done' ? 1 : 0,
            transform: phase === 'done' ? 'none' : 'translateY(14px)',
            transition: 'opacity .45s ease, transform .45s cubic-bezier(.3,1.4,.5,1)',
            pointerEvents: phase === 'done' ? 'auto' : 'none',
          }}
        >
          <Btn kind="primary" size="lg" label="Play again" onClick={onPlayAgain} />
          <Btn kind="ghost" size="sm" label="Leave game" onClick={onLeave} />
        </div>
      </div>
    </div>
  )
}

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}
