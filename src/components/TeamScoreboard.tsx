import type { CSSProperties } from 'react'
import { RollingNumber } from './RollingNumber'

type Team = { id: string; name: string; score: number }

export const TEAM_COLORS = ['#FF6FA3', '#5BD6FF', '#8C6BFF', '#FFD166']

/** Same stable, id-sorted color assignment TeamScoreboard itself uses — for
 * anything elsewhere (score-reveal popups, etc.) that needs a team's color
 * to match what's on screen here. */
export function colorForTeam(teams: Team[], teamId: string): string {
  const sorted = [...teams].sort((a, b) => a.id.localeCompare(b.id))
  const index = sorted.findIndex((t) => t.id === teamId)
  return TEAM_COLORS[Math.max(index, 0) % TEAM_COLORS.length]
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 10,
  fontFamily: 'Rubik, system-ui, sans-serif',
}

function cardStyle(color: string, isActive: boolean, hasActive: boolean): CSSProperties {
  return {
    borderRadius: 18,
    padding: '10px 8px',
    background: 'linear-gradient(180deg,rgba(52,40,110,.6),rgba(24,18,56,.65))',
    border: `1.5px solid ${isActive ? `${color}AA` : 'rgba(200,180,255,.1)'}`,
    boxShadow: isActive ? `0 0 24px ${color}40` : 'none',
    opacity: !hasActive || isActive ? 1 : 0.7,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }
}

const nameRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const nameStyle: CSSProperties = {
  font: '600 15px/1 Rubik, sans-serif',
  color: '#F4F2FB',
  whiteSpace: 'nowrap',
}

function scoreStyle(color: string): CSSProperties {
  return {
    font: '700 30px/1 Fredoka, Rubik, sans-serif',
    color,
  }
}

export function TeamScoreboard({
  teams,
  activeTeamId,
}: {
  teams: Team[]
  activeTeamId: string
}) {
  // Sort by id for a stable, deterministic color assignment so a given
  // party's team colors don't shuffle between renders if `teams` arrives
  // in a different order.
  const sortedTeams = [...teams].sort((a, b) => a.id.localeCompare(b.id))
  const hasActive = teams.some((t) => t.id === activeTeamId)

  return (
    <div style={gridStyle}>
      {sortedTeams.map((t, index) => {
        const color = TEAM_COLORS[index % TEAM_COLORS.length]
        const isActive = t.id === activeTeamId
        return (
          <div key={t.id} data-score-card={t.id} style={cardStyle(color, isActive, hasActive)}>
            <div style={nameRowStyle}>
              <span style={nameStyle}>{t.name}</span>
              {/* data-score-target: where a flying score lands (see ScoreFlight). */}
              <span data-score-target={t.id}>
                <RollingNumber value={t.score} style={scoreStyle(color)} />
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
