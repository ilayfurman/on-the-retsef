import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from './App'

// Captured so the test can "finish signing in" mid-test.
let authCallback: ((event: string, session: unknown) => void) | null = null

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
        signOut: vi.fn(),
      },
      rpc: vi.fn(),
      from: vi.fn(() => chain),
    },
  }
})

describe('invite link (#/join/CODE)', () => {
  beforeEach(() => {
    authCallback = null
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
})
