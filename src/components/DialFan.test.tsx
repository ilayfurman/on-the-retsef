import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DialFan, angleToValue } from './DialFan'

// Dial pivot, per docs/design/reference/Dial.dc.html's renderVals().
const CX = 180
const CY = 178

describe('DialFan', () => {
  it('renders a slider with the given value', () => {
    render(<DialFan value={0.5} interactive onChange={vi.fn()} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '0.5')
  })

  it('calls onChange when dragged via arrow keys', () => {
    const onChange = vi.fn()
    render(<DialFan value={0.5} interactive onChange={onChange} />)
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(0.51)
  })

  it('is not interactive without onChange', () => {
    render(<DialFan value={0.5} />)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-readonly', 'true')
  })

  it('uses the new 360x250 viewBox with pivot at (180,178)', () => {
    render(<DialFan value={0.5} />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('viewBox', '0 0 360 250')
  })

  it('does not render scoring bands or labels when revealedTarget is undefined', () => {
    const { container } = render(<DialFan value={0.5} />)
    // Band fill colors that are only ever used for the target-centered bands
    // (not shared with the needle/pivot gradients) should be absent, and so
    // should the score-number <text> labels.
    const html = container.innerHTML
    expect(html).not.toContain('#8C6BFF')
    expect(html).not.toContain('#FF6FA3')
    expect(container.querySelectorAll('text')).toHaveLength(0)
  })

  it('renders target-centered scoring bands and labels when revealedTarget is set', () => {
    const { container } = render(<DialFan value={0.5} revealedTarget={0.66} />)
    const html = container.innerHTML
    expect(html).toContain('#8C6BFF')
    expect(html).toContain('#FF6FA3')
    expect(html).toContain('#FFD166')
    const labels = Array.from(container.querySelectorAll('text')).map((el) => el.textContent)
    expect(labels).toEqual(['2', '3', '4', '3', '2'])
  })
})

describe('angleToValue (pure pointer-angle-to-dial-value math)', () => {
  it('returns 0.5 for a point straight up from the pivot', () => {
    expect(angleToValue(CX, CY - 100, CX, CY)).toBe(0.5)
  })

  it('returns 1 for a point directly to the right of the pivot (on the pivot line)', () => {
    expect(angleToValue(CX + 100, CY, CX, CY)).toBe(1)
  })

  it('returns 0 for a point directly to the left of the pivot (on the pivot line)', () => {
    expect(angleToValue(CX - 100, CY, CX, CY)).toBe(0)
  })

  it('clamps to 0 when the pointer goes below the pivot line on the left side', () => {
    // atan2(cy-y, x-cx) is negative here (y > cy, x < cx) — the reference's
    // setFrom() clamps this to the nearest end of the semicircle.
    expect(angleToValue(50, 220, CX, CY)).toBe(0)
  })

  it('clamps to 1 when the pointer goes below the pivot line on the right side', () => {
    expect(angleToValue(310, 220, CX, CY)).toBe(1)
  })
})

describe('DialFan reveal impact', () => {
  it('fires onImpact exactly once, after the hold + sweep, with the scoring tier', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const onImpact = vi.fn()
      // Guess dead-on the target → bullseye (tier 4).
      render(<DialFan value={0.5} revealedTarget={0.5} revealHoldMs={1000} impactFx onImpact={onImpact} />)
      vi.advanceTimersByTime(1800)
      expect(onImpact).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onImpact).toHaveBeenCalledTimes(1)
      expect(onImpact.mock.calls[0][0].tier).toBe(4)
      vi.advanceTimersByTime(3000)
      expect(onImpact).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports tier 0 for a guess outside every scoring band', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const onImpact = vi.fn()
      render(<DialFan value={0.1} revealedTarget={0.8} onImpact={onImpact} />)
      vi.advanceTimersByTime(1500)
      expect(onImpact.mock.calls[0][0].tier).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
