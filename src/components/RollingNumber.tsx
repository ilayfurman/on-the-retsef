import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
const DIGIT_H = 1.1 // em — a touch taller than 1 so Fredoka's glyph tops never clip

/**
 * Odometer-style number: when `value` changes it counts through every
 * integer in between (quickly), and each digit column physically rolls to
 * its next position with a slight overshoot. First render shows the value
 * as-is — only changes after mount animate.
 */
export function RollingNumber({ value, style }: { value: number; style?: CSSProperties }) {
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (value === shownRef.current) return
    const from = shownRef.current
    const dir = value > from ? 1 : -1
    const steps = Math.abs(value - from)
    // Whole count takes ~450ms regardless of size, but never ticks faster
    // than the digit roll itself can read.
    const stepMs = Math.max(70, Math.min(160, 450 / steps))
    let n = from
    const timer = setInterval(() => {
      n += dir
      shownRef.current = n
      setShown(n)
      const el = rootRef.current
      if (el && typeof el.animate === 'function') {
        el.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
          { duration: 180, easing: 'cubic-bezier(.3,1.6,.5,1)' },
        )
      }
      if (n === value) clearInterval(timer)
    }, stepMs)
    return () => {
      clearInterval(timer)
      // If interrupted mid-count, land on the real value rather than a stale in-between one.
      shownRef.current = value
      setShown(value)
    }
  }, [value])

  const chars = String(shown).split('')
  return (
    <span ref={rootRef} style={{ ...style, display: 'inline-flex', transformOrigin: 'center' }}>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{value}</span>
      {chars.map((c, i) => {
        const d = Number(c)
        // Keyed by place value (ones, tens…) from the right, so the ones
        // column stays the same element as a new tens column appears.
        const place = chars.length - i
        return (
          <span
            key={place}
            aria-hidden
            style={{ display: 'inline-block', height: `${DIGIT_H}em`, lineHeight: `${DIGIT_H}em`, overflow: 'hidden' }}
          >
            <span
              style={{
                display: 'block',
                transform: `translateY(${-d * DIGIT_H}em)`,
                transition: 'transform 260ms cubic-bezier(.2,1.45,.4,1)',
              }}
            >
              {DIGITS.map((g) => (
                <span key={g} style={{ display: 'block', height: `${DIGIT_H}em`, textAlign: 'center' }}>
                  {g}
                </span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}
