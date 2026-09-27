import { render, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RollingNumber } from './RollingNumber'

// The visible digits are rolling strips (every glyph 0–9 is in the DOM), so
// read which digit each column is scrolled to from its transform.
function shownDigits(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden] > span'))
    .map((strip) => {
      const m = strip.style.transform.match(/translateY\((-?[\d.]+)em\)/)
      return m ? String(Math.round(-Number(m[1]) / 1.1)) : ''
    })
    .join('')
}

describe('RollingNumber', () => {
  it('shows the initial value without animating', () => {
    const { container } = render(<RollingNumber value={7} />)
    expect(shownDigits(container)).toBe('7')
  })

  it('counts through to the new value, gaining a digit column as needed', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = render(<RollingNumber value={8} />)
      rerender(<RollingNumber value={11} />)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(shownDigits(container)).toBe('11')
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes the real value to assistive tech', () => {
    const { getByText } = render(<RollingNumber value={42} />)
    expect(getByText('42')).toBeInTheDocument()
  })
})
