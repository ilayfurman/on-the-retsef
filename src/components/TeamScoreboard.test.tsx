import { describe, it, expect } from 'vitest'
import { TEAM_COLORS, colorForTeam } from './TeamScoreboard'

describe('colorForTeam', () => {
  it('colors a team by the color in its name, whatever its id', () => {
    // ids chosen so id-sorting would put Sky first and Pink second.
    const teams = [
      { id: 'b-pink', name: 'Pink Team' },
      { id: 'a-sky', name: 'Sky Team' },
    ]
    expect(colorForTeam(teams, 'b-pink')).toBe(TEAM_COLORS[0])
    expect(colorForTeam(teams, 'a-sky')).toBe(TEAM_COLORS[1])
  })

  it('falls back to a stable id-sorted color for other names', () => {
    const teams = [
      { id: 'b', name: 'Tacos' },
      { id: 'a', name: 'Yikes' },
    ]
    expect(colorForTeam(teams, 'a')).toBe(TEAM_COLORS[0])
    expect(colorForTeam(teams, 'b')).toBe(TEAM_COLORS[1])
  })
})
