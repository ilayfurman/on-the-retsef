import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PackEditor } from './PackEditor'
import { supabase } from '../../lib/supabaseClient'

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data:
          table === 'packs'
            ? [{ id: 'pack-1', name: 'Test1', share_code: 'ABC123' }]
            : [{ id: 's1', left_label: 'Cold', right_label: 'Hot' }],
      }),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}))

describe('PackEditor rename and edit', () => {
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

  it('opens a tapped card in the form, filled in, and saves the edit', async () => {
    render(<PackEditor packId="pack-1" />)
    const row = (await screen.findByText('Cold')).parentElement!
    fireEvent.pointerDown(row, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(row, { clientX: 100, pointerId: 1 })

    expect(screen.getByText(/editing card/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/left label/i)).toHaveValue('Cold')
    expect(screen.getByLabelText(/right label/i)).toHaveValue('Hot')
    expect(screen.queryByRole('button', { name: /add spectrum/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/right label/i), { target: { value: 'Scorching' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('update_spectrum', { p_spectrum_id: 's1', p_left_label: 'Cold', p_right_label: 'Scorching' }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /add spectrum/i })).toBeInTheDocument())
  })
})
