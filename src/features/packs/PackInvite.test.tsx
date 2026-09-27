import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PackInvite } from './PackInvite'

let preview: unknown[] = []
const rpc = vi.fn()

vi.mock('../../lib/supabaseClient', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

beforeEach(() => {
  rpc.mockReset()
  rpc.mockImplementation((name: string) => {
    if (name === 'pack_preview') return Promise.resolve({ data: preview, error: null })
    // copy_pack(...).single()
    return { single: () => Promise.resolve({ data: { id: 'new-pack' }, error: null }) }
  })
})

describe('PackInvite', () => {
  it('shows the pack and adds a copy on one tap', async () => {
    preview = [{ name: 'Movie Night', card_count: 42, is_mine: false, my_copy_id: null }]
    const onOpenPack = vi.fn()
    render(<PackInvite shareCode="K7M2QX" onOpenPack={onOpenPack} onDone={vi.fn()} />)
    expect(await screen.findByText('Movie Night')).toBeInTheDocument()
    expect(screen.getByText('42 cards')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add to my packs/i }))
    await waitFor(() => expect(onOpenPack).toHaveBeenCalledWith('new-pack'))
    expect(rpc).toHaveBeenCalledWith('copy_pack', { p_share_code: 'K7M2QX' })
  })

  it('offers your existing copy instead of silently duplicating', async () => {
    preview = [{ name: 'Movie Night', card_count: 42, is_mine: false, my_copy_id: 'mine-1' }]
    const onOpenPack = vi.fn()
    render(<PackInvite shareCode="K7M2QX" onOpenPack={onOpenPack} onDone={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /open my copy/i }))
    expect(onOpenPack).toHaveBeenCalledWith('mine-1')
    expect(screen.getByRole('button', { name: /add another copy/i })).toBeInTheDocument()
  })

  it("recognizes your own pack's link", async () => {
    preview = [{ name: 'Movie Night', card_count: 42, is_mine: true, my_copy_id: null }]
    render(<PackInvite shareCode="K7M2QX" onOpenPack={vi.fn()} onDone={vi.fn()} />)
    expect(await screen.findByText(/this is your pack/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to my packs/i })).not.toBeInTheDocument()
  })

  it('says when the pack is gone', async () => {
    preview = []
    render(<PackInvite shareCode="K7M2QX" onOpenPack={vi.fn()} onDone={vi.fn()} />)
    expect(await screen.findByText(/pack not found/i)).toBeInTheDocument()
  })
})
