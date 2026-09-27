import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GameScreen } from './GameScreen'
import { supabase } from '../../lib/supabaseClient'
import type { Turn } from './useTurn'

const baseTurn: Turn = {
  id: 't1', party_id: 'p1', round_number: 1, team_id: 'team-a', psychic_player_id: 'player-1',
  spectrum_id: 's1', target_position: null, clue_text: null, guess_position: null, status: 'clue',
  spectrum_rerolled: false,
}

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(
        table === 'turns_view' ? { data: baseTurn } : { data: { left_label: 'Cold', right_label: 'Hot' } }
      ),
    })),
    rpc: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: {}, error: null }) }),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), send: vi.fn() })),
    removeChannel: vi.fn(),
  },
}))

describe('GameScreen', () => {
  it('shows the clue prompt to the psychic and calls submit_clue on skip', async () => {
    render(
      <GameScreen
        turnId="t1"
        myPlayerId="player-1"
        myTeamId="team-a"
        teams={[{ id: 'team-a', name: 'Tacos', score: 0 }]}
        isHost={false}
        myMutedUntil={null}
        players={[]}
        totalRounds={3}
        onLeave={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByText(/cold/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /said it out loud/i }))
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('submit_clue', { p_turn_id: 't1', p_clue_text: '', p_skipped: true })
    )
  })

  it('shows a waiting message to a non-psychic, non-teammate during the clue phase', async () => {
    render(
      <GameScreen
        turnId="t1"
        myPlayerId="someone-else"
        myTeamId="team-b"
        teams={[{ id: 'team-a', name: 'Tacos', score: 0 }, { id: 'team-b', name: 'Yikes', score: 0 }]}
        isHost={false}
        myMutedUntil={null}
        players={[]}
        totalRounds={3}
        onLeave={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByText(/is thinking/i)).toBeInTheDocument())
  })
})
