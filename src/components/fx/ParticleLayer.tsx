import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { attachCanvas } from './particles'

/** Full-screen, click-through canvas that burst()/sparkle() draw into. Mount once per screen that uses them. */
export function ParticleLayer({ zIndex = 90 }: { zIndex?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = ref.current
    // jsdom has no canvas implementation — skip rather than spam test output.
    if (!el || navigator.userAgent.includes('jsdom')) return
    return attachCanvas(el)
  }, [])

  return createPortal(
    <canvas
      ref={ref}
      aria-hidden
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex }}
    />,
    document.body,
  )
}
