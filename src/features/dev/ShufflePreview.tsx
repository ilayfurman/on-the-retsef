import { useEffect, useState } from 'react'
import { Starfield } from '../../components/Starfield'
import { ShuffleReveal } from '../party/ShuffleReveal'

/**
 * DEV-ONLY (mounted from App behind import.meta.env.DEV, so it never ships):
 * replays the Team-o-Matic shuffle with fake players, since the real one
 * needs 4+ people in a lobby. Simulates network latency for the result so
 * the "keep mixing until the answer arrives" behavior can be seen.
 */

const AVATARS = ['🌮', '😬', '🐝', '🦄', '🦊', '🐙', '🌶️', '🎈', '🧠', '🐸', '🦁', '🍩']
const NAMES = ['You', 'Maya', 'Noam', 'Dana', 'Omer', 'Shira', 'Itay', 'Yael', 'Roni', 'Tal', 'Gal', 'Lior', 'Adi', 'Ido', 'Mor', 'Ben', 'Neta', 'Eli', 'Hila', 'Asaf']
const TEAM_NAMES = ['Pink Team', 'Sky Team', 'Violet Team', 'Gold Team']

type Player = { id: string; display_name: string; avatar: string }

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--gold)' : 'rgba(200,180,255,.2)'}`,
        background: active ? 'rgba(255,209,102,.16)' : 'rgba(255,255,255,.05)',
        color: 'var(--text)',
        font: '600 13px var(--font-body)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// #/shuffle-preview/auto[/<players>/<teams>][/slow][/guest][/single] — auto-runs on load.
function parseAuto() {
  const parts = window.location.hash.split('/')
  const nums = parts.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  return {
    auto: parts.includes('auto'),
    count: nums[0] ?? 6,
    teams: nums[1] ?? 2,
    slow: parts.includes('slow'),
    guest: parts.includes('guest'),
    single: parts.includes('single'),
  }
}

export default function ShufflePreview() {
  const [auto] = useState(parseAuto)
  const [count, setCount] = useState(auto.count)
  const [numTeams, setNumTeams] = useState(auto.teams)
  const [delay, setDelay] = useState(auto.slow ? 4000 : 400)
  const [asHost, setAsHost] = useState(!auto.guest)
  const [open, setOpen] = useState(false)
  const [req, setReq] = useState(0)
  const [readyFor, setReadyFor] = useState<number | null>(null)
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [byTeam, setByTeam] = useState<Map<string, Player[]>>(new Map())
  const [rects, setRects] = useState<Record<string, DOMRect>>({})
  const [quick, setQuick] = useState(false)
  const [singleCount, setSingleCount] = useState(auto.single && auto.count <= 3 ? auto.count : 3)

  const players: Player[] = Array.from({ length: quick ? singleCount : count }, (_, i) => ({ id: `p${i}`, display_name: NAMES[i], avatar: AVATARS[i % AVATARS.length] }))

  function shuffle(single = false, size = singleCount) {
    setQuick(single)
    if (single) setSingleCount(size)
    const r: Record<string, DOMRect> = {}
    document.querySelectorAll<HTMLElement>('[data-avatar-id]').forEach((el) => (r[el.dataset.avatarId!] = el.getBoundingClientRect()))
    const id = Date.now()
    setRects(r)
    setReq(id)
    setReadyFor(null)
    setOpen(true)
    const roster = Array.from({ length: single ? size : count }, (_, i) => ({ id: `p${i}`, display_name: NAMES[i], avatar: AVATARS[i % AVATARS.length] }))
    const nt = single ? 1 : Math.min(numTeams, Math.floor(roster.length / 2))
    setTimeout(
      () => {
        const shuffled = [...roster].sort(() => Math.random() - 0.5)
        const ts = Array.from({ length: nt }, (_, i) => ({ id: `t${id}-${i}`, name: TEAM_NAMES[i] }))
        const map = new Map<string, Player[]>(ts.map((t) => [t.id, []]))
        shuffled.forEach((p, i) => map.get(ts[i % nt].id)!.push(p))
        setTeams(ts)
        setByTeam(map)
        setReadyFor(id)
      },
      single ? 50 : delay,
    )
  }

  // Auto-run on load (used for headless frame captures).
  useEffect(() => {
    if (!auto.auto) return
    const t = setTimeout(() => shuffle(auto.single), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myTeamId = teams.find((t) => byTeam.get(t.id)?.some((p) => p.id === 'p0'))?.id ?? null

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>
      <Starfield />
      <div style={{ position: 'relative', maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)', textAlign: 'center' }}>
          SHUFFLE PREVIEW · DEV ONLY
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', padding: 14, borderRadius: 20, border: '1px solid var(--surface-border)', background: 'var(--surface)' }}>
          {players.map((p) => (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span data-avatar-id={p.id} style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                {p.avatar}
              </span>
              <span style={{ font: '500 11px var(--font-body)', color: 'var(--text-muted)' }}>{p.display_name}</span>
            </div>
          ))}
        </div>
        {[
          { label: 'Players', opts: [4, 6, 8, 12, 20].map((v) => ({ l: String(v), a: count === v, f: () => setCount(v) })) },
          { label: 'Teams', opts: [2, 3, 4].map((v) => ({ l: String(v), a: numTeams === v, f: () => setNumTeams(v) })) },
          {
            label: 'Network',
            opts: [
              { l: 'Fast', a: delay === 400, f: () => setDelay(400) },
              { l: 'Slow (4s)', a: delay === 4000, f: () => setDelay(4000) },
            ],
          },
          {
            label: 'View as',
            opts: [
              { l: 'Host', a: asHost, f: () => setAsHost(true) },
              { l: 'Guest', a: !asHost, f: () => setAsHost(false) },
            ],
          },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 70, font: '600 13px var(--font-body)', color: 'var(--text-muted)' }}>{row.label}</span>
            {row.opts.map((o) => (
              <Chip key={o.l} active={o.a} label={o.l} onClick={o.f} />
            ))}
          </div>
        ))}
        <button
          onClick={() => shuffle()}
          style={{ height: 56, borderRadius: 999, border: 'none', background: 'linear-gradient(180deg,#FFE9A6,#F5BE4F)', color: '#1A1233', font: '800 18px var(--font-display)', cursor: 'pointer' }}
        >
          Shuffle!
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[2, 3].map((k) => (
            <button
              key={k}
              onClick={() => shuffle(true, k)}
              style={{ height: 44, borderRadius: 999, border: '1px solid rgba(200,180,255,.25)', background: 'rgba(255,255,255,.05)', color: 'var(--text)', font: '600 14px var(--font-body)', cursor: 'pointer' }}
            >
              One team · {k} players
            </button>
          ))}
        </div>
      </div>
      <ShuffleReveal
        open={open}
        shuffleRequestId={req}
        players={players}
        startRects={rects}
        numTeamsPredicted={quick ? 1 : Math.min(numTeams, Math.floor(count / 2))}
        teams={readyFor === req ? teams : []}
        playersByTeam={byTeam}
        myPlayerId="p0"
        myTeamId={readyFor === req ? myTeamId : null}
        canAct={asHost}
        skipAnimation={quick}
        resultsReady={readyFor === req}
        onStartGame={() => setOpen(false)}
        onReshuffle={() => shuffle()}
        onDismiss={() => setOpen(false)}
      />
    </div>
  )
}
