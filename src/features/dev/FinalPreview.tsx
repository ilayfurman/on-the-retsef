import { useState } from 'react'
import { FinalScoreboard } from '../game/FinalScoreboard'

/**
 * DEV-ONLY (mounted from App behind import.meta.env.DEV, so it never ships):
 * replays the end-of-game Podium Race with fake teams.
 *
 *   #/final-preview/<scores>[/<playersPerTeam>][/<turns>]
 *   e.g. #/final-preview/12,9       two teams
 *        #/final-preview/8,11,5,11  four teams, a tie at the top
 *        #/final-preview/7/2/4      one team, 2 players, 4 turns played
 *   add /lose to watch as a player on the last-place team instead,
 *   /mute for no drumroll
 *        #/final-preview/12,9/lose
 */

const AVATARS = ['🌮', '😬', '🐝', '🦄', '🦊', '🐙', '🌶️', '🎈', '🧠', '🐸', '🦁', '🍩']
const NAMES = ['You', 'Maya', 'Noam', 'Dana', 'Omer', 'Shira', 'Itay', 'Yael', 'Roni', 'Tal', 'Gal', 'Lior', 'Adi', 'Ido', 'Mor', 'Ben', 'Neta', 'Eli', 'Hila', 'Asaf']
const TEAM_NAMES = ['Pink Team', 'Sky Team', 'Violet Team', 'Gold Team']

function parse() {
  const all = window.location.hash.replace('#/final-preview', '').split('/').filter(Boolean)
  const lose = all.includes('lose')
  const mute = all.includes('mute')
  const auto = all.includes('auto')
  const parts = all.filter((x) => x !== 'lose' && x !== 'mute' && x !== 'auto')
  const scores = (parts[0] ?? '12,9').split(',').map(Number)
  const perTeam = Number(parts[1] ?? 2)
  const turns = parts[2] ? Number(parts[2]) : null
  return { scores, perTeam, turns, lose, mute, auto }
}

export default function FinalPreview() {
  const [cfg] = useState(parse)
  const [run, setRun] = useState(0)
  // Browsers only allow sound after a tap, so the preview starts from a
  // button (/auto skips it, for silent headless captures).
  const [started, setStarted] = useState(cfg.auto)
  // Shuffled ids so lane order can't accidentally lean on id order.
  const teams = cfg.scores.map((score, i) => ({ id: `t${(i * 7 + 3) % 10}`, name: TEAM_NAMES[i % 4], score }))
  const players = teams.flatMap((t, ti) =>
    Array.from({ length: cfg.perTeam }, (_, k) => {
      const n = ti * cfg.perTeam + k
      return { id: `p${n}`, display_name: NAMES[n % NAMES.length], avatar: AVATARS[n % AVATARS.length], team_id: t.id }
    }),
  )
  // "You" is the first player on the chosen team: the lowest scorer with /lose.
  const myTeamIdx = cfg.lose ? cfg.scores.indexOf(Math.min(...cfg.scores)) : 0
  const me = players.find((p) => p.team_id === teams[myTeamIdx]?.id)?.id ?? 'p0'
  if (!started) {
    return (
      <div style={{ height: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          onClick={() => setStarted(true)}
          style={{ padding: '16px 28px', borderRadius: 999, border: 'none', background: 'linear-gradient(180deg,#FFE9A6,#F5BE4F)', color: '#1A1233', font: '800 18px var(--font-display)', cursor: 'pointer' }}
        >
          ▶ Play the ending
        </button>
      </div>
    )
  }
  return (
    <FinalScoreboard
      key={run}
      teams={teams}
      players={players}
      myPlayerId={me}
      turnsPlayed={cfg.turns}
      rounds={2}
      celebrate
      sound={!cfg.mute}
      onPlayAgain={() => setRun((r) => r + 1)}
      onLeave={() => setRun((r) => r + 1)}
    />
  )
}
