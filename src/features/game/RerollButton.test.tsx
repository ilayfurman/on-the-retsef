import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RerollButton } from './RerollButton'

describe('RerollButton', () => {
  it('shows a busy state while the reroll is in flight', async () => {
    let resolve: (ok: boolean) => void = () => {}
    const onReroll = vi.fn(() => new Promise<boolean>((r) => (resolve = r)))
    render(<RerollButton onReroll={onReroll} />)
    fireEvent.click(screen.getByRole('button', { name: /new spectrum/i }))
    expect(onReroll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Dealing…')).toBeInTheDocument()
    resolve(true)
  })

  it('becomes clickable again if the reroll fails', async () => {
    const onReroll = vi.fn().mockResolvedValue(false)
    render(<RerollButton onReroll={onReroll} />)
    fireEvent.click(screen.getByRole('button', { name: /new spectrum/i }))
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
    expect(screen.getByText('New spectrum')).toBeInTheDocument()
  })
})
