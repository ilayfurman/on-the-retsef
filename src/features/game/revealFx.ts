import { burst } from '../../components/fx/particles'
import type { DialImpact } from '../../components/DialFan'

const PALETTE = ['#FFD166', '#FF6FA3', '#8C6BFF', '#5BD6FF', '#FFFFFF']

/**
 * The shared, everyone-sees-it celebration at the moment the cover clears —
 * scaled to how good the guess was. (Per-viewer points are ScoreFlight's job;
 * this is about the guess itself, so the betting team sees it too.)
 */
export function celebrateImpact({ tier, point, color }: DialImpact) {
  const { x, y } = point
  if (tier === 4) {
    burst({ x, y, count: 120, colors: PALETTE, speed: [380, 950], spread: Math.PI * 1.5, gravity: 980, life: [1.3, 2.1], size: [7, 12], shapes: ['confetti', 'confetti', 'star'] })
    burst({ x, y, count: 40, colors: ['#FFFFFF', '#FFD166'], speed: [500, 1150], spread: Math.PI * 2, gravity: 200, drag: 2.5, life: [0.35, 0.7], size: [2, 3.5], shapes: ['spark'] })
    // Second, later pop — a bullseye earns the double-take.
    setTimeout(
      () => burst({ x, y: y - 20, count: 70, colors: PALETTE, speed: [260, 680], spread: Math.PI * 1.2, gravity: 900, life: [1.2, 1.9], size: [6, 10], shapes: ['star', 'confetti'] }),
      190,
    )
  } else if (tier === 3) {
    burst({ x, y, count: 65, colors: [color, '#FFD166', '#FFFFFF', '#8C6BFF'], speed: [300, 720], spread: Math.PI * 1.3, gravity: 950, life: [1.1, 1.7], shapes: ['confetti', 'confetti', 'dot'] })
    burst({ x, y, count: 20, colors: ['#FFFFFF', color], speed: [420, 900], gravity: 200, drag: 2.5, life: [0.3, 0.6], size: [2, 3], shapes: ['spark'] })
  } else if (tier === 2) {
    burst({ x, y, count: 30, colors: [color, '#FFFFFF', '#FF6FA3'], speed: [220, 520], spread: Math.PI * 1.1, gravity: 900, life: [0.9, 1.4], size: [5, 9], shapes: ['confetti', 'dot'] })
    burst({ x, y, count: 10, colors: ['#FFFFFF'], speed: [300, 650], gravity: 200, drag: 2.5, life: [0.25, 0.5], size: [2, 3], shapes: ['spark'] })
  }
  // A miss gets no confetti at all — the dial draining of color says it.
}
