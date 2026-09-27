import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from './App'

// Captured so the test can "finish signing in" mid-test.
let authCallback: ((event: string, session: unknown) => void) | null = null
// What the room check (room_status) answers for the invited room.
let roomStatus: string | null = 'open'

vi.mock('./lib/supabaseClient', () => {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn().mockResolvedValue({ data: [] })
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn((cb) => {
          authCallback = cb
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
        signInWithOtp: vi.fn(),
        verifyOtp: vi.fn(),
        signOut: vi.fn(async () => {
          authCallback?.('SIGNED_OUT', null)
          return { error: null }
        }),
        signInAnonymously: vi.fn(async () => {
          authCallback?.('SIGNED_IN', { user: { id: 'guest1', is_anonymous: true } })
          return { data: {}, error: null }
        }),
      },
      rpc: vi.fn(async (name: string) => (name === 'room_status' ? { data: roomStatus, error: null } : { data: null, error: null })),
      from: vi.fn(() => chain),
    },
  }
})

describe('invite link (#/join/CODE)', () => {
  beforeEach(() => {
    authCallback = null
    roomStatus = 'open'
    window.history.replaceState(null, '', '/#/join/ABCD')
  })

  it('carries a signed-out guest through sign-in straight to joining that room', async () => {
    render(<App />)
    // Signed out: the sign-in screen says where they're headed.
    expect(await screen.findByText(/invited to room/i)).toHaveTextContent('ABCD')

    await act(async () => {
      authCallback?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } })
    })

    // Signed in: dropped into the join step for that room, not Home.
    expect(await screen.findByText('Joining ABCD')).toBeInTheDocument()
    expect(window.location.hash).toBe('')
  })

  it('lets a friend join from the link as a guest, no email', async () => {
    render(<App />)
    const guest = await screen.findByRole('button', { name: /continue as guest/i })
    await waitFor(() => expect(guest).toBeEnabled()) // room check done
    fireEvent.click(guest)
    expect(await screen.findByText('Joining ABCD')).toBeInTheDocument()
  })

  it('asks a guest outside a party to sign in instead of showing Home', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    await screen.findByLabelText(/email/i) // startup's "no session" check has landed
    await act(async () => {
      authCallback?.('SIGNED_IN', { user: { id: 'guest1', is_anonymous: true } })
    })
    expect(await screen.findByText(/sign in to keep going/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue as guest/i })).not.toBeInTheDocument()
  })

  it("says when the invited room doesn't exist, and offers no guest button", async () => {
    roomStatus = null
    render(<App />)
    expect(await screen.findByText(/there's no room ABCD/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue as guest/i })).not.toBeInTheDocument()
  })

  it('tells a signed-in player the game already started instead of a dead join step', async () => {
    roomStatus = 'playing'
    render(<App />)
    await screen.findByLabelText(/email/i)
    await act(async () => {
      authCallback?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } })
    })
    expect(await screen.findByText(/already started/i)).toBeInTheDocument()
    expect(screen.queryByText('Joining ABCD')).not.toBeInTheDocument()
  })

  it('takes a guest who backs out of the join step back to the invite screen', async () => {
    render(<App />)
    const guest = await screen.findByRole('button', { name: /continue as guest/i })
    await waitFor(() => expect(guest).toBeEnabled())
    fireEvent.click(guest)
    await screen.findByText('Joining ABCD')
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText(/invited to room/i)).toHaveTextContent('ABCD')
    expect(screen.queryByText(/sign in to keep going/i)).not.toBeInTheDocument()
  })

  it('calls out an invalid room code instead of ignoring it', async () => {
    window.history.replaceState(null, '', '/#/join/XXX')
    render(<App />)
    expect(await screen.findByText(/isn't a valid room code/i)).toHaveTextContent('"XXX"')
    expect(screen.queryByRole('button', { name: /continue as guest/i })).not.toBeInTheDocument()
  })
})
