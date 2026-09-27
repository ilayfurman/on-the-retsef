import type { CSSProperties } from 'react'
import { RollingNumber } from './RollingNumber'

type Team = { id: string; name: string; score: number }

export const TEAM_COLORS = ['#FF6FA3', '#5BD6FF', '#8C6BFF', '#FFD166']

// Teams are named after their color server-side ("Pink Team", "Sky Team"…),
// so the name decides the color — otherwise "Pink Team" could render blue.
const COLOR_BY_NAME: [RegExp, string][] = [
  [/^pink\b/i, TEAM_COLORS[0]],
  [/^sky\b/i, TEAM_COLORS[1]],
  [/^violet\b/i, TEAM_COLORS[2]],
  [/^gold\b/i, TEAM_COLORS[3]],
]

/** A team's color, used everywhere a team appears (scoreboard, lobby, score
 * popups, final screen) so it always matches. Color-named teams get their
 * named color; anything else falls back to a stable, id-sorted rotation. */
export function colorForTeam(teams: { id: string; name: string }[], teamId: string): string {
  const team = teams.find((t) => t.id === teamId)
  const named = team && COLOR_BY_NAME.find(([re]) => re.test(team.name))
  if (named) return named[1]
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
      {sortedTeams.map((t) => {
        const color = colorForTeam(teams, t.id)
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
