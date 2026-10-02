import { useRef, useState } from 'react'
import { DialFan, type DialImpact } from '../../components/DialFan'
import { TeamScoreboard, colorForTeam } from '../../components/TeamScoreboard'
import { ClueCard } from '../../components/ClueCard'
import { Starfield } from '../../components/Starfield'
import { ParticleLayer } from '../../components/fx/ParticleLayer'
import { ScoreFlight, type ScoreFlightSpec } from '../game/ScoreFlight'
import { celebrateImpact } from '../game/revealFx'

/**
 * DEV-ONLY (mounted from App behind import.meta.env.DEV, so it never ships):
 * replays the full turn-reveal choreography on demand for every outcome, so
 * it can be tuned without playing real rounds — a bullseye is rare.
 */

const TARGET = 0.62
type Scenario = { label: string; guess: number; kind: 'guess' | 'bet'; bet?: 'left' | 'right'; betPoints?: number }
const SCENARIOS: Scenario[] = [
  { label: 'Bullseye · 4', guess: TARGET, kind: 'guess' },
  { label: 'So close · 3', guess: TARGET + 0.04, kind: 'guess' },
  { label: 'Edge · 2', guess: TARGET - 0.08, kind: 'guess' },
  { label: 'Miss · 0', guess: 0.18, kind: 'guess' },
  // Guess lands right of the target, so the correct bet is "left".
  { label: 'Bet right side · +1', guess: TARGET + 0.04, kind: 'bet', bet: 'left', betPoints: 1 },
  { label: 'Bet wrong side · 0', guess: TARGET + 0.04, kind: 'bet', bet: 'right', betPoints: 0 },
]

export default function RevealPreview() {
  const [teams, setTeams] = useState([
    { id: 'a', name: 'Pink Team', score: 7 },
    { id: 'b', name: 'Sky Team', score: 5 },
  ])
  const [run, setRun] = useState<{ id: number; s: Scenario } | null>(null)
  const [flight, setFlight] = useState<ScoreFlightSpec | null>(null)
  const pendingRef = useRef<{ teamId: string; points: number } | null>(null)

  function play(s: Scenario) {
    setFlight(null)
    setRun({ id: Date.now(), s })
  }

  function handleImpact(impact: DialImpact) {
    if (!run) return
    celebrateImpact(impact)
    const s = run.s
    const points = s.kind === 'guess' ? impact.tier : (s.betPoints ?? 0)
    const teamId = s.kind === 'guess' ? 'a' : 'b'
    pendingRef.current = { teamId, points }
    setFlight({
      from: s.kind === 'bet' ? (s.bet === 'left' ? impact.leftEnd : impact.rightEnd) : impact.point,
      points,
      color: colorForTeam(teams, teamId),
      teamId,
      kind: s.kind,
    })
  }

  function handleArrive() {
    const p = pendingRef.current
    pendingRef.current = null
    if (p && p.points > 0) setTeams((ts) => ts.map((t) => (t.id === p.teamId ? { ...t, score: t.score + p.points } : t)))
  }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Starfield />
      <ParticleLayer />
      <div style={{ position: 'relative', maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)', textAlign: 'center' }}>
          REVEAL FX PREVIEW · DEV ONLY
        </span>
        <ClueCard label="PLAYER2'S CLUE" clue="Pineapple on pizza" tone="default" editable={false} />
        <TeamScoreboard teams={teams} activeTeamId="a" />
        <div style={{ minHeight: 260, display: 'flex', alignItems: 'center' }}>
          {run ? (
            <DialFan
              key={run.id}
              value={run.s.guess}
              revealedTarget={TARGET}
              revealHoldMs={1000}
              impactFx
              onImpact={handleImpact}
              left="Crime"
              right="Delicacy"
            />
          ) : (
            <DialFan value={0.5} left={window.location.search.includes("long") ? "Bad karaoke song" : "Crime"} right={window.location.search.includes("long") ? "Great karaoke song" : "Delicacy"} />
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              onClick={() => play(s)}
              style={{
                padding: '12px 10px',
                borderRadius: 14,
                border: '1px solid rgba(200,180,255,.2)',
                background: 'rgba(255,255,255,.06)',
                color: 'var(--text)',
                font: '600 14px var(--font-body)',
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {flight && run && <ScoreFlight key={run.id} spec={flight} onArrive={handleArrive} />}
    </div>
  )
}
