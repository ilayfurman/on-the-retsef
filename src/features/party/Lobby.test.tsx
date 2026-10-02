import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Lobby } from './Lobby'
import { supabase } from '../../lib/supabaseClient'

const partyRow: Record<string, unknown> = { num_teams: 2, rounds: 3, team_mode: 'random', noises_enabled: true, has_started: false, status: 'lobby' }
let playersData: { id: string; display_name: string; avatar: string; team_id: string | null; confirmed_rematch: boolean }[] = []
let teamsData: { id: string; name: string }[] = []

function makeChain(resolveValue: unknown, arrayValue?: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.or = vi.fn(() => chain)
  chain.order = vi.fn(() => Promise.resolve(arrayValue !== undefined ? arrayValue : resolveValue))
  chain.single = vi.fn(() => Promise.resolve(resolveValue))
  // Real supabase-js query builders are themselves thenable, so code can
  // `await` the chain directly without calling a terminal method like
  // `.single()`/`.order()` first (e.g. `.select(...).or(...)`) — mirror that
  // here instead of hardcoding which method ends every chain in this mock.
  chain.then = (resolve: (value: unknown) => void) => resolve(arrayValue !== undefined ? arrayValue : resolveValue)
  return chain
}

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'players') {
        return makeChain({ data: playersData[0] }, { data: playersData })
      }
      if (table === 'parties') {
        return makeChain({ data: partyRow })
      }
      if (table === 'teams') {
        return makeChain({ data: teamsData }, { data: teamsData })
      }
      return makeChain({ data: null }, { data: null })
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
    },
    rpc: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: {}, error: null }) }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      send: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}))

beforeEach(() => {
  Object.assign(partyRow, { has_started: false, status: 'lobby' })
  playersData = [{ id: 'p1', display_name: 'Alex', avatar: '🌮', team_id: null, confirmed_rematch: false }]
  teamsData = []
})

describe('Lobby', () => {
  it('shows the rematch card in a lobby reopened after a game', async () => {
    Object.assign(partyRow, { has_started: true, status: 'lobby' })
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    expect(await screen.findByText(/rematch/i)).toBeInTheDocument()
  })

  it("doesn't flash the rematch card while a game is starting", async () => {
    // start_game sets has_started and status='playing' together; the lobby
    // can see that for a moment before the app switches to the game.
    Object.assign(partyRow, { has_started: true, status: 'playing' })
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByText('Alex').length).toBeGreaterThan(0))
    expect(screen.queryByText(/rematch/i)).not.toBeInTheDocument()
  })

  it('shows the room code and lists joined players', async () => {
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    expect(screen.getByText('ABCD')).toBeInTheDocument()
    // Now shown twice — once in the "you" identity card, once in the
    // player/team list — so this checks presence, not a single unique match.
    await waitFor(() => expect(screen.getAllByText('Alex').length).toBeGreaterThan(0))
  })

  // These exercise the multi-team flow, which needs at least 4 players —
  // below that, forcedSingleTeam skips the whole Random/Pick/Shuffle UI
  // entirely (see Lobby.tsx), so a single-player default wouldn't show it.
  const fourPlayers = [
    { id: 'p1', display_name: 'Alex', avatar: '🌮', team_id: null, confirmed_rematch: false },
    { id: 'p2', display_name: 'Sam', avatar: '🦊', team_id: null, confirmed_rematch: false },
    { id: 'p3', display_name: 'Jo', avatar: '🐝', team_id: null, confirmed_rematch: false },
    { id: 'p4', display_name: 'Kai', avatar: '🐙', team_id: null, confirmed_rematch: false },
  ]

  it('shows "Shuffle teams" instead of "Start game" in Random mode before any teams exist', async () => {
    playersData = fourPlayers
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /^shuffle teams$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start game$/i })).not.toBeInTheDocument()
  })

  it('calls shuffle_teams when the host clicks "Shuffle teams"', async () => {
    playersData = fourPlayers
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /^shuffle teams$/i }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('shuffle_teams', { p_party_id: 'party-1' }))
  })

  it('calls shuffle_teams when the host clicks Reshuffle once teams exist', async () => {
    teamsData = [{ id: 't1', name: 'Pink Team' }, { id: 't2', name: 'Sky Team' }]
    playersData = [
      { id: 'p1', display_name: 'Alex', avatar: '🌮', team_id: 't1', confirmed_rematch: false },
      { id: 'p2', display_name: 'Sam', avatar: '🦊', team_id: 't1', confirmed_rematch: false },
      { id: 'p3', display_name: 'Jo', avatar: '🐝', team_id: 't2', confirmed_rematch: false },
      { id: 'p4', display_name: 'Kai', avatar: '🐙', team_id: 't2', confirmed_rematch: false },
    ]
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /reshuffle/i }))
    expect(supabase.rpc).toHaveBeenCalledWith('shuffle_teams', { p_party_id: 'party-1' })
  })

  it('calls set_party_settings and create_pick_teams when the host picks Pick mode', async () => {
    playersData = fourPlayers
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    const pickButton = await screen.findByRole('radio', { name: /pick/i })
    fireEvent.click(pickButton)
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'set_party_settings',
        expect.objectContaining({ p_party_id: 'party-1', p_team_mode: 'manual' }),
      ),
    )
    expect(supabase.rpc).toHaveBeenCalledWith('create_pick_teams', { p_party_id: 'party-1' })
  })

  it('calls set_party_settings with p_noises_enabled when the host toggles noises', async () => {
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)
    const noisesSwitch = await screen.findByRole('switch', { name: /noises/i })
    fireEvent.click(noisesSwitch)
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'set_party_settings',
        expect.objectContaining({ p_party_id: 'party-1', p_noises_enabled: false }),
      ),
    )
  })

  it('shows an error message when onStartGame rejects', async () => {
    teamsData = [{ id: 't1', name: 'Pink Team' }]
    playersData = [
      { id: 'p1', display_name: 'Alex', avatar: '🌮', team_id: 't1', confirmed_rematch: false },
      { id: 'p2', display_name: 'Sam', avatar: '🦊', team_id: 't1', confirmed_rematch: false },
    ]
    const onStartGame = vi.fn().mockRejectedValue(new Error('No teams assigned yet'))
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={onStartGame} />)
    fireEvent.click(await screen.findByRole('button', { name: /^start game$/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No teams assigned yet'))
  })

  it('calls assign_manual_team with the viewer own player id when joining a pre-made color team in Pick mode', async () => {
    partyRow.team_mode = 'manual'
    teamsData = [{ id: 't1', name: 'Pink Team' }, { id: 't2', name: 'Sky Team' }]
    playersData = fourPlayers
    render(<Lobby partyId="party-1" roomCode="ABCD" isHost={true} onStartGame={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /\+ join pink team/i }))

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('assign_manual_team', {
        p_party_id: 'party-1',
        p_player_id: 'p1',
        p_team_name: 'Pink Team',
      }),
    )
    partyRow.team_mode = 'random'
  })
})
