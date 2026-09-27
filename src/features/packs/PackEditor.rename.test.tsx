import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PackEditor } from './PackEditor'
import { supabase } from '../../lib/supabaseClient'

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: table === 'packs' ? [{ id: 'pack-1', name: 'Test1', share_code: 'ABC123' }] : [],
      }),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}))

describe('PackEditor rename', () => {
  it('renames the pack by tapping its name', async () => {
    render(<PackEditor packId="pack-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /rename pack/i }))
    const input = screen.getByLabelText(/pack name/i)
    fireEvent.change(input, { target: { value: '  Movie Night ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('rename_pack', { p_pack_id: 'pack-1', p_name: 'Movie Night' }))
    expect(screen.getByText('Movie Night')).toBeInTheDocument()
  })
})
