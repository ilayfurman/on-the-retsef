import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FinalScoreboard } from './FinalScoreboard'

describe('FinalScoreboard', () => {
  it('lists teams sorted by score, highest first', () => {
    render(
      <FinalScoreboard
        teams={[{ id: 'a', name: 'Tacos', score: 5 }, { id: 'b', name: 'Yikes', score: 9 }]}
        onPlayAgain={vi.fn()}
        onLeave={vi.fn()}
      />
    )
    const rows = screen.getAllByTestId('final-team-row')
    expect(rows[0]).toHaveTextContent('Yikes')
    expect(rows[1]).toHaveTextContent('Tacos')
  })

  it('calls onPlayAgain and onLeave', () => {
    const onPlayAgain = vi.fn()
    const onLeave = vi.fn()
    render(<FinalScoreboard teams={[]} onPlayAgain={onPlayAgain} onLeave={onLeave} />)
    fireEvent.click(screen.getByRole('button', { name: /play again/i }))
    fireEvent.click(screen.getByRole('button', { name: /leave game/i }))
    expect(onPlayAgain).toHaveBeenCalled()
    expect(onLeave).toHaveBeenCalled()
  })

  it('names the winner and the margin', () => {
    render(
      <FinalScoreboard
        teams={[{ id: 'a', name: 'Pink Team', score: 12 }, { id: 'b', name: 'Sky Team', score: 9 }]}
        onPlayAgain={vi.fn()}
        onLeave={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: 'PINK TEAM WINS!' })).toBeInTheDocument()
    expect(screen.getByText('Won by 3 points')).toBeInTheDocument()
  })

  it('calls a tie a tie', () => {
    render(
      <FinalScoreboard
        teams={[{ id: 'a', name: 'Pink Team', score: 8 }, { id: 'b', name: 'Sky Team', score: 8 }]}
        onPlayAgain={vi.fn()}
        onLeave={vi.fn()}
      />
    )
    expect(screen.getByRole('heading', { name: "IT'S A TIE!" })).toBeInTheDocument()
  })

  it('rates a lone team against a perfect game instead of calling it a winner', () => {
    render(
      <FinalScoreboard
        teams={[{ id: 'a', name: 'Pink Team', score: 7 }]}
        turnsPlayed={4}
        onPlayAgain={vi.fn()}
        onLeave={vi.fn()}
      />
    )
    // 7 of a possible 16.
    expect(screen.getByRole('heading', { name: 'SOLID TEAMWORK!' })).toBeInTheDocument()
    expect(screen.getByText('7 points in 4 turns')).toBeInTheDocument()
    expect(screen.queryByText(/wins/i)).not.toBeInTheDocument()
  })

  it('skips the show when the game ended because a player left', () => {
    render(
      <FinalScoreboard
        teams={[{ id: 'a', name: 'Pink Team', score: 0 }]}
        celebrate
        sound
        endedReason="player_left"
        onPlayAgain={vi.fn()}
        onLeave={vi.fn()}
      />
    )
    // Straight to the result: final title and usable buttons, no suspense title.
    expect(screen.queryByText(/how did you do/i)).not.toBeInTheDocument()
    expect(screen.getByText(/a player left/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play again/i }).closest('div')).toHaveStyle({ pointerEvents: 'auto' })
  })
})
