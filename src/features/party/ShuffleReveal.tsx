import { useEffect, useMemo, useRef, useState } from 'react'
import { Starfield } from '../../components/Starfield'
import { Btn } from '../../components/Btn'

type Player = { id: string; display_name: string; avatar: string }
type Team = { id: string; name: string }

// Mirrors shuffle_teams/create_pick_teams' own naming exactly, so the
// predicted "shell" boxes shown before real data arrives use the same
// names/colors the real teams will land on — no visible swap once the
// server result comes in.
const TEAM_NAMES = ['Pink Team', 'Sky Team', 'Violet Team', 'Gold Team']
const TEAM_COLORS = ['#FF6FA3', '#5BD6FF', '#8C6BFF', '#FFD166']
const AVATAR_SIZE = 64

// Avatar choreography timing (all driven by one rAF loop, see the effect
// below) — gather in, a beat of anticipation, an accelerating tightening
// spiral, then an accelerating launch off the top of the screen.
const GATHER_MS = 550
const ANTICIPATE_MS = 220
const SWIRL_MS = 950
const LAUNCH_MS = 600
const LAUNCH_STAGGER_MAX_MS = 200
const AVATAR_TOTAL_MS = GATHER_MS + ANTICIPATE_MS + SWIRL_MS + LAUNCH_MS + LAUNCH_STAGGER_MAX_MS

// Everything after the avatars are gone (boxes/curtains/results) — kept as
// ordinary React state transitions since these don't need per-frame control.
const PAUSE_MS = 420
const SWAP_MS = 650
const PRE_CURTAIN_PAUSE_MS = 300
const CURTAIN_STAGGER_MS = 260
const CURTAIN_MS = 650

type Phase = 'avatars' | 'pause' | 'swap' | 'reveal' | 'done'

/** Cheap deterministic hash of a string into [0, 1) — stable per player id
 * per shuffle, so per-avatar randomization doesn't re-roll on every
 * unrelated re-render, but does refresh on a genuine new shuffle. */
function seedFrom(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function clamp01(t: number) {
  return Math.max(0, Math.min(1, t))
}
/** Overshoots past 1 then settles back — a little "landed with weight" bounce for the gather-in. */
function easeOutBack(t: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = t - 1
  return 1 + c3 * x * x * x + c1 * x * x
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgba(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
  onStartGame,
  onReshuffle,
  onDismiss,
  starting,
  shuffling,
  startError,
}: {
  open: boolean
  /** Bumped by the parent the instant Shuffle/Reshuffle is clicked (not once the RPC resolves) — restarts the whole animation immediately, independent of network latency. */
  shuffleRequestId: number
  players: Player[]
  /** Each player's real on-screen position the instant Shuffle was clicked, so avatars fly in from there instead of popping into place already centered. */
  startRects: Record<string, DOMRect>
  numTeamsPredicted: number
  teams: Team[]
  playersByTeam: Map<string, Player[]>
  myPlayerId?: string | null
  myTeamId?: string | null
  /** Only the host can actually start/reshuffle — everyone else watches the same reveal but gets a "waiting" note instead of action buttons. */
  canAct: boolean
  /** With fewer than 4 players there's only one possible team — nothing to
   * actually shuffle, so this skips straight to the revealed state (no
   * gather/swirl/launch, no curtain-lift, no action buttons) instead of
   * playing the full sequence for a decision that was never really made. */
  skipAnimation?: boolean
  onStartGame: () => void
  onReshuffle: () => void
  onDismiss: () => void
  starting?: boolean
  shuffling?: boolean
  startError?: string | null
}) {
  const [phase, setPhase] = useState<Phase>('avatars')
  const avatarRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Per-avatar randomization, re-rolled only when a fresh shuffle starts.
  const seeds = useMemo(
    () =>
      players.map((p, i) => {
        const s1 = seedFrom(p.id + shuffleRequestId)
        const s2 = seedFrom(shuffleRequestId + p.id)
        return {
          // Evenly spread around the circle to start, plus a little jitter
          // so they don't look like they're on a perfect, robotic ring.
          baseAngle: (i / Math.max(players.length, 1)) * Math.PI * 2 + (s1 - 0.5) * 0.6,
          spinDirection: s1 > 0.5 ? 1 : -1,
          spinSpeed: 2.1 + s2 * 1.4, // full turns over the swirl's duration
          radiusJitter: (s1 - 0.5) * 14,
          launchDrift: (s1 - 0.5) * 90,
          launchRotate: (s2 - 0.5) * 70,
          launchDelay: s1 * LAUNCH_STAGGER_MAX_MS,
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shuffleRequestId, players.length],
  )

  // Drives every avatar's position/scale/rotation/opacity directly via DOM
  // refs on a single rAF loop — deliberately NOT via React state/CSS
  // transitions, so there's exactly one source of truth for "where is this
  // avatar right now" and no risk of a transition fighting a per-frame
  // update (which is what produces janky/rubber-banding motion).
  useEffect(() => {
    if (!open || skipAnimation) return
    const t0 = performance.now()
    let raf = 0

    function frame(now: number) {
      const elapsed = now - t0
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const gatherEnd = GATHER_MS
      const anticipateEnd = gatherEnd + ANTICIPATE_MS
      const swirlEnd = anticipateEnd + SWIRL_MS

      players.forEach((p, i) => {
        const el = avatarRefs.current[p.id]
        if (!el) return
        const seed = seeds[i]
        const rect = startRects[p.id]
        const startX = rect ? rect.left + rect.width / 2 : cx
        const startY = rect ? rect.top + rect.height / 2 : cy
        const startScale = rect ? Math.max(0.4, rect.width / AVATAR_SIZE) : 0.6

        let x = cx
        let y = cy
        let scale = 1
        let rotate = 0
        let opacity = 1

        if (elapsed < gatherEnd) {
          const t = easeOutBack(clamp01(elapsed / gatherEnd))
          x = lerp(startX, cx, t)
          y = lerp(startY, cy, t)
          scale = lerp(startScale, 1, t)
        } else if (elapsed < anticipateEnd) {
          // A held breath: everyone shrinks in slightly, like energy being
          // drawn inward right before it releases outward into the spin.
          const t = clamp01((elapsed - gatherEnd) / ANTICIPATE_MS)
          scale = lerp(1, 0.82, t)
        } else if (elapsed < swirlEnd) {
          const t = clamp01((elapsed - anticipateEnd) / SWIRL_MS)
          const accel = t * t // spins up faster than it starts — a wind-up, not a constant speed
          const angle = seed.baseAngle + seed.spinDirection * accel * seed.spinSpeed * Math.PI * 2
          const radius = lerp(72, 10, t) + seed.radiusJitter * (1 - t)
          x = cx + Math.cos(angle) * radius
          y = cy + Math.sin(angle) * radius
          scale = 0.82 + Math.sin(t * Math.PI * 5 + seed.baseAngle) * 0.05
        } else {
          const localElapsed = elapsed - swirlEnd - seed.launchDelay
          if (localElapsed < 0) {
            // Staggered launch: hasn't gone yet, holds at the spiral's center.
            x = cx
            y = cy
            scale = 0.78
          } else {
            const t = clamp01(localElapsed / LAUNCH_MS)
            const ease = t * t // accelerates upward, like being flung
            x = cx + seed.launchDrift * ease
            y = lerp(cy, -AVATAR_SIZE * 2.2, ease)
            scale = lerp(0.78, 0.45, ease)
            rotate = seed.launchRotate * ease
            opacity = 1 - ease
          }
        }

        el.style.transform = `translate(${(x - AVATAR_SIZE / 2).toFixed(1)}px, ${(y - AVATAR_SIZE / 2).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${rotate.toFixed(1)}deg)`
        el.style.opacity = opacity.toFixed(3)
      })

      if (elapsed < AVATAR_TOTAL_MS) raf = requestAnimationFrame(frame)
    }

    // Seed the very first frame synchronously so avatars never flash at the
    // origin for a frame before the loop kicks in.
    frame(t0)
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shuffleRequestId, seeds, skipAnimation])

  // The box/curtain/results side of the sequence — ordinary timed phase
  // transitions, independent of the avatar rAF loop above (kept in sync by
  // sharing the same duration constants). skipAnimation skips straight to
  // 'swap' — no avatars, no gather/swirl/launch/pause, since with only one
  // possible team there's nothing to actually decide — but still lands on
  // the closed-curtain box before the swap->reveal effect below lifts it,
  // so there's a real beat of "something's about to be shown" instead of
  // teams just appearing already-revealed.
  useEffect(() => {
    if (!open) return
    if (skipAnimation) {
      setPhase('swap')
      return
    }
    setPhase('avatars')
    const timers = [setTimeout(() => setPhase('pause'), AVATAR_TOTAL_MS), setTimeout(() => setPhase('swap'), AVATAR_TOTAL_MS + PAUSE_MS)]
    return () => timers.forEach(clearTimeout)
  }, [open, shuffleRequestId, skipAnimation])

  // Only leave 'swap' once real team data has actually arrived — waiting on
  // whichever is later of the choreography's own timing or the network.
  useEffect(() => {
    if (!open || phase !== 'swap' || teams.length === 0) return
    const t = setTimeout(() => setPhase('reveal'), SWAP_MS + PRE_CURTAIN_PAUSE_MS)
    return () => clearTimeout(t)
  }, [open, phase, teams.length])

  useEffect(() => {
    if (phase !== 'reveal') return
    const boxCount = teams.length || numTeamsPredicted
    const t = setTimeout(() => setPhase('done'), boxCount * CURTAIN_STAGGER_MS + CURTAIN_MS + 250)
    return () => clearTimeout(t)
  }, [phase, teams.length, numTeamsPredicted])

  if (!open) return null

  const boxCount = teams.length || numTeamsPredicted
  // With only one possible box, "Pink Team" reads like an arbitrary label on
  // a real division that doesn't exist — everyone's just playing together,
  // so say that instead of a team name nobody chose between.
  const boxes = Array.from({ length: boxCount }, (_, i) => {
    const t = teams[i]
    return {
      id: t?.id ?? `shell-${i}`,
      name: boxCount === 1 ? "Everyone's on one team" : t?.name ?? TEAM_NAMES[i % TEAM_NAMES.length],
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      members: t ? playersByTeam.get(t.id) ?? [] : [],
    }
  })

  const myBox = myTeamId ? boxes.find((b) => b.id === myTeamId) : undefined
  const otherBoxes = boxes.filter((b) => b.id !== myBox?.id)

  const boxesForward = phase === 'swap' || phase === 'reveal' || phase === 'done'
  const curtainsUp = phase === 'reveal' || phase === 'done'
  // No buttons in skipAnimation mode — the parent (Lobby) is driving this on
  // its own timer straight into the game, so showing Start/Reshuffle here
  // would just be redundant (and briefly clickable before it navigates away).
  const showActions = phase === 'done' && !skipAnimation
  const avatarsGone = phase !== 'avatars'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', overflow: 'hidden' }}>
      <Starfield />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 16px',
          boxSizing: 'border-box',
          gap: 16,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ font: '700 20px var(--font-display)', color: 'var(--text)' }}>
            {phase === 'done' || phase === 'reveal' ? 'Teams are set!' : 'Shuffling…'}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={showActions ? 'Back to lobby settings' : 'Skip to lobby'}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', font: '500 13px var(--font-body)', cursor: 'pointer' }}
          >
            {showActions ? '‹ Back' : 'Skip'}
          </button>
        </div>

        {/* Team reveal — dim/small in the background while avatars swirl, held
            through a suspense beat, then swaps forward to full size/opacity.
            Deliberately reuses Lobby's own "YOU'RE ON" hero-card + compact
            other-teams pill-row look (not a generic grid), so the reveal's
            end state IS the same screen the viewer lands on afterward. */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 12,
            transition: 'opacity 0.5s ease, filter 0.5s ease, transform 0.5s ease',
            opacity: boxesForward ? 1 : 0.28,
            filter: boxesForward ? 'none' : 'blur(1.5px) grayscale(0.5)',
            transform: boxesForward ? 'scale(1)' : 'scale(0.86)',
          }}
        >
          {/* Every box shares the exact same shape/size/style — only the
              viewer's own box is scaled up via transform to stand out, so
              "which one is mine" reads instantly without the boxes actually
              being different layouts from one another. */}
          {[...(myBox ? [myBox] : []), ...otherBoxes].map((box, i) => {
            const isMine = box.id === myBox?.id
            return (
              <div
                key={box.id}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 24,
                  padding: '16px 16px',
                  background: `radial-gradient(120% 100% at 50% 0%, ${rgba(box.color, 0.3)}, ${rgba(box.color, 0.05)} 70%)`,
                  border: `1.5px solid ${rgba(box.color, isMine ? 0.55 : 0.25)}`,
                  boxShadow: boxesForward && isMine ? `0 0 30px ${rgba(box.color, 0.2)}` : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  transform: `scale(${boxesForward && isMine ? 1.08 : 1})`,
                  transformOrigin: 'center',
                  zIndex: isMine ? 2 : 1,
                  transition: 'transform 0.4s ease, box-shadow 0.4s ease',
                }}
              >
                {isMine && (
                  <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>YOU'RE ON</span>
                )}
                <span style={{ font: `700 ${isMine ? 26 : 18}px/1.15 var(--font-display)`, color: 'var(--text)', textAlign: 'center' }}>
                  {box.name}
                </span>
                <div style={{ display: 'flex', gap: isMine ? 14 : 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {box.members.map((p, memberIndex) => {
                    const isMe = !!myPlayerId && p.id === myPlayerId
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 5,
                          animation: curtainsUp ? `reveal-fade-in .35s ease-out ${150 + memberIndex * 80}ms both` : undefined,
                        }}
                      >
                        <span
                          style={{
                            width: isMine ? 52 : 38,
                            height: isMine ? 52 : 38,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: isMine ? 26 : 19,
                            background: rgba(box.color, 0.25),
                            boxShadow: isMe ? '0 0 0 3px #120F2E, 0 0 0 5px #fff' : 'none',
                          }}
                        >
                          {p.avatar}
                        </span>
                        <span style={{ font: `600 ${isMine ? 13 : 11}px var(--font-body)`, color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>
                          {isMe ? 'You' : p.display_name}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Curtain — covers this box until its turn to reveal (mine first, others staggered after). */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: box.color,
                    transform: curtainsUp ? 'translateY(-105%)' : 'translateY(0)',
                    transition: `transform ${CURTAIN_MS}ms cubic-bezier(.65,0,.35,1)`,
                    transitionDelay: curtainsUp ? `${i * CURTAIN_STAGGER_MS}ms` : '0ms',
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Avatar cluster — position driven entirely by the rAF loop above via
            refs; React only mounts/unmounts these, never touches their
            transform/opacity once rendered. */}
        {!avatarsGone &&
          players.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                avatarRefs.current[p.id] = el
              }}
              style={{ position: 'fixed', top: 0, left: 0, width: AVATAR_SIZE, height: AVATAR_SIZE, zIndex: 5 }}
            >
              <span
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  background: 'var(--surface, rgba(255,255,255,.08))',
                  border: '2px solid rgba(255,255,255,.28)',
                  boxShadow: '0 0 22px rgba(169,139,255,.35), 0 10px 30px rgba(0,0,0,.4)',
                }}
              >
                {p.avatar}
              </span>
            </div>
          ))}

        {showActions && canAct && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: 'reveal-fade-in .4s ease-out both' }}>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              animation: 'reveal-fade-in .4s ease-out both',
            }}
          >
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
