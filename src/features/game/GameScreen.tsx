import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useTurn } from './useTurn'
import { DialFan, type DialImpact } from '../../components/DialFan'
import { ParticleLayer } from '../../components/fx/ParticleLayer'
import { ScoreFlight, SCORE_EMERGE_HOLD_MS, SCORE_FLY_MS, SCORE_MISS_EXTRA_MS, type ScoreFlightSpec } from './ScoreFlight'
import { celebrateImpact } from './revealFx'
import { TeamScoreboard, colorForTeam } from '../../components/TeamScoreboard'
import { GameHeader } from '../../components/GameHeader'
import { ClueCard } from '../../components/ClueCard'
import { Btn } from '../../components/Btn'
import { Starfield } from '../../components/Starfield'
import { useDialBroadcast } from './useDialBroadcast'
import { Soundboard } from '../noises/Soundboard'
import { HostMenu } from './HostMenu'
import { RerollButton } from './RerollButton'
import { computeScore } from '../../lib/scoringConstants'

type Team = { id: string; name: string; score: number }

// Must match the DialFan reveal's own timing (revealHoldMs passed below +
// its internal 900ms slide) — the score only updates once the needle's
// actual reveal has visually finished, so the two never feel disconnected.
const DIAL_REVEAL_MS = 1900
// Blank pause after the popup is gone, before the next turn actually loads.
// The zero case already spends extra time with the popup ON screen (above),
// so it gets a much shorter blank pause afterward — otherwise the two
// extensions stack into a long dead gap that reads as "did this freeze?"
// rather than "take a moment to read that".
const ADVANCE_TRAILING_BUFFER_MS = 1000
// 0, not just "shorter" — the zero case already got its reading time from
// SCORE_MISS_EXTRA_MS (a miss has no flight, so it lingers instead); any gap
// between the popup fading and the next turn loading is round-trip time for
// advance_turn's RPC call plus the next turn reaching this client (a poll
// tick in useTurn, or the parties subscription/poll in App.tsx), not a
// deliberate pause — nothing left here to shrink further client-side.
const ADVANCE_TRAILING_BUFFER_ZERO_MS = 0

function scorePopupDurationMs(points: number): number {
  return SCORE_EMERGE_HOLD_MS + SCORE_FLY_MS + (points > 0 ? 0 : SCORE_MISS_EXTRA_MS)
}

type RevealOutcome = { points: number; color: string; teamId: string; kind: 'guess' | 'bet'; direction: 'left' | 'right' | null }

export function GameScreen({
  turnId,
  myPlayerId,
  myTeamId,
  teams,
  isHost,
  myMutedUntil,
  players,
  totalRounds,
  noisesEnabled,
  onLeave,
}: {
  turnId: string
  myPlayerId: string
  myTeamId: string
  teams: Team[]
  isHost: boolean
  myMutedUntil: string | null
  players: { id: string; display_name: string; avatar: string; team_id?: string | null }[]
  totalRounds: number
  noisesEnabled?: boolean
  onLeave: () => void
}) {
  const turn = useTurn(turnId)
  const [clueText, setClueText] = useState('')
  const [localGuess, setLocalGuess] = useState(0.5)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false)
  const [spectrumLabels, setSpectrumLabels] = useState<{ left: string; right: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeMoverId, setActiveMoverId] = useState<string | null>(null)
  const activeMoverIdRef = useRef(activeMoverId)
  activeMoverIdRef.current = activeMoverId
  // The scoreboard's own displayed scores — deliberately lags behind `teams`
  // during a reveal so the total doesn't update before the dial has visually
  // finished showing where the guess landed. Synced live at every other time.
  const [displayedTeams, setDisplayedTeams] = useState(teams)
  const [flight, setFlight] = useState<ScoreFlightSpec | null>(null)
  const revealHandledRef = useRef<string | null>(null)
  const outcomeRef = useRef<Promise<RevealOutcome> | null>(null)
  const advancingRef = useRef(false)
  const { broadcastMove, broadcastDragEnd } = useDialBroadcast(
    turnId,
    (v, playerId) => {
      setLocalGuess(v)
      setActiveMoverId(playerId)
    },
    (playerId) => {
      setActiveMoverId((current) => (current === playerId ? null : current))
    },
  )
  // Not shown to the mover themselves — they already know it's them.
  const activeMoverPlayer = activeMoverId && activeMoverId !== myPlayerId ? players.find((p) => p.id === activeMoverId) : undefined
  const activeMover = activeMoverPlayer ? { avatar: activeMoverPlayer.avatar } : null

  useEffect(() => {
    let cancelled = false
    async function loadSpectrum() {
      if (!turn?.spectrum_id) return
      setSpectrumLabels(null)
      const { data } = await supabase
        .from('spectrums')
        .select('left_label, right_label')
        .eq('id', turn.spectrum_id)
        .single()
      if (!cancelled && data) {
        setSpectrumLabels({ left: data.left_label, right: data.right_label })
      }
    }
    void loadSpectrum()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn?.spectrum_id])

  async function advanceTurn(partyId: string) {
    if (advancingRef.current) return
    advancingRef.current = true
    const { error } = await supabase.rpc('advance_turn', { p_party_id: partyId })
    if (error) {
      advancingRef.current = false
      setActionError(error.message)
    }
  }

  // Auto-advance silently once the reveal animation has actually finished —
  // no button, no visible countdown. The host's client is the only one that
  // actually calls advance_turn, so there's no risk of two clients racing
  // to create the next turn.
  useEffect(() => {
    if (turn?.status !== 'revealed' || !isHost || turn.target_position === null || turn.guess_position === null) return
    const points = computeScore(turn.target_position, turn.guess_position)
    const trailingBuffer = points > 0 ? ADVANCE_TRAILING_BUFFER_MS : ADVANCE_TRAILING_BUFFER_ZERO_MS
    const t = setTimeout(() => void advanceTurn(turn.party_id), DIAL_REVEAL_MS + scorePopupDurationMs(points) + trailingBuffer)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn?.status, turn?.id, isHost])

  // Always read the freshest `teams` inside timer callbacks below without
  // making them depend on it — `teams` updates via fast realtime the moment
  // the server commits a score, well before `turn.status` reaches 'revealed'
  // (useTurn only learns that on its next 600ms poll), so treating `teams`
  // as a timing signal for the reveal effects would be racy.
  const teamsRef = useRef(teams)
  teamsRef.current = teams

  // A fresh turn starts with nothing scored yet — baseline the displayed
  // scores once here, then leave them alone (no continuous sync to `teams`)
  // until the reveal effect below explicitly decides it's time.
  useEffect(() => {
    setDisplayedTeams(teamsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn?.id])

  // Reveal choreography is driven by the dial itself: it reports the exact
  // moment (and screen position) the cover clears via onImpact, and the
  // score flight launches from there. This effect just resolves, as early as
  // possible, WHAT this viewer earned — per-viewer, not one shared popup: the
  // guessing team sees their computeScore points, a betting team sees its
  // flat +1/+0 (showing them the guessing team's bigger number made it look
  // like they'd scored the same). Guarded to run once per turn.
  useEffect(() => {
    if (!turn || turn.status !== 'revealed' || turn.target_position === null || turn.guess_position === null) return
    if (revealHandledRef.current === turn.id) return
    revealHandledRef.current = turn.id

    const turnId = turn.id
    const activeTeamId = turn.team_id
    const target = turn.target_position
    const guess = turn.guess_position
    outcomeRef.current = (async (): Promise<RevealOutcome> => {
      if (myTeamId === activeTeamId) {
        return { points: computeScore(target, guess), color: colorForTeam(teamsRef.current, activeTeamId), teamId: activeTeamId, kind: 'guess', direction: null }
      }
      const { data } = await supabase.from('bets').select('correct, direction').eq('turn_id', turnId).eq('team_id', myTeamId).maybeSingle()
      return {
        points: data?.correct ? 1 : 0,
        color: colorForTeam(teamsRef.current, myTeamId),
        teamId: myTeamId,
        kind: 'bet',
        direction: (data?.direction as 'left' | 'right' | undefined) ?? null,
      }
    })()

    // Safety net: if the dial never reports its impact (e.g. the tab was
    // backgrounded mid-reveal), the scoreboard still catches up.
    const t = setTimeout(() => setDisplayedTeams(teamsRef.current), DIAL_REVEAL_MS + scorePopupDurationMs(0) + 400)
    return () => clearTimeout(t)
  }, [turn?.status, turn?.id, turn?.target_position, turn?.guess_position, turn?.team_id, myTeamId])

  // Individual teammates' picks for the current bet — a team's bet only
  // actually locks in and scores once everyone on it agrees (see
  // cast_bet_vote), so this polls the live vote rows to show who's picked
  // what and let anyone change their mind before that happens. Reset
  // immediately on a fresh turn so a stale vote from the last one can't
  // flash before the first poll of the new turn resolves.
  const [teamVotes, setTeamVotes] = useState<Record<string, 'left' | 'right'>>({})
  useEffect(() => {
    setTeamVotes({})
  }, [turnId])

  // The guess only locks once every guesser has pressed "Lock it in" at the
  // same spot (see lock_guess); moving the dial clears everyone's lock. This
  // polls who has locked so far, for the "2 of 3 locked in" row.
  const [guessLocks, setGuessLocks] = useState<Record<string, number>>({})
  const guessLocksRef = useRef(guessLocks)
  guessLocksRef.current = guessLocks
  useEffect(() => {
    setGuessLocks({})
  }, [turnId])
  useEffect(() => {
    if (turn?.status !== 'guessing') return
    let cancelled = false
    async function poll() {
      const { data } = await supabase.from('guess_locks').select('player_id, position').eq('turn_id', turnId)
      if (cancelled || !data) return
      const map: Record<string, number> = {}
      for (const row of data as { player_id: string; position: number }[]) map[row.player_id] = Number(row.position)
      setGuessLocks(map)
    }
    void poll()
    const interval = setInterval(poll, 600)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [turn?.status, turnId])

  // Once someone has locked in, everyone's dial shows that spot (unless
  // they're the one dragging it somewhere new).
  const lockedSpot = Object.values(guessLocks)[0]
  useEffect(() => {
    if (lockedSpot !== undefined && activeMoverIdRef.current !== myPlayerId) setLocalGuess(lockedSpot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedSpot])
  useEffect(() => {
    const isActive = !!turn && myTeamId === turn.team_id
    if (turn?.status !== 'betting' || isActive || !myTeamId) return
    let cancelled = false
    async function poll() {
      const { data } = await supabase.from('bet_votes').select('player_id, direction').eq('turn_id', turnId).eq('team_id', myTeamId)
      if (cancelled) return
      const map: Record<string, 'left' | 'right'> = {}
      for (const row of (data ?? []) as { player_id: string; direction: 'left' | 'right' }[]) {
        map[row.player_id] = row.direction
      }
      setTeamVotes(map)
    }
    void poll()
    const interval = setInterval(poll, 600)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [turn?.status, turn?.team_id, turnId, myTeamId])

  if (!turn) {
    return (
      <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
        <Starfield />
      </div>
    )
  }

  const isPsychic = myPlayerId === turn.psychic_player_id
  const isActiveTeam = myTeamId === turn.team_id
  const psychicName = players.find((p) => p.id === turn.psychic_player_id)?.display_name ?? 'Psychic'
  const activeTeamName = teams.find((t) => t.id === turn.team_id)?.name ?? 'Team'

  async function submitClue(skipped: boolean) {
    setActionError(null)
    if (!skipped && !clueText.trim()) {
      setActionError('Type a clue first, or tap "Said it out loud".')
      return
    }
    const { error } = await supabase.rpc('submit_clue', { p_turn_id: turnId, p_clue_text: skipped ? '' : clueText, p_skipped: skipped })
    if (error) setActionError(error.message)
  }

  async function rerollSpectrum(): Promise<boolean> {
    setActionError(null)
    const { error } = await supabase.rpc('reroll_spectrum', { p_turn_id: turnId })
    if (error) {
      setActionError(error.message)
      return false
    }
    return true
  }

  async function lockGuess() {
    setActionError(null)
    const { error } = await supabase.rpc('lock_guess', { p_turn_id: turnId, p_guess_position: localGuess })
    if (error) setActionError(error.message)
    // Show my lock right away rather than waiting for the next poll.
    else if (myPlayerId) setGuessLocks((prev) => (prev[myPlayerId] === undefined ? { ...Object.fromEntries(Object.entries(prev).filter(([, v]) => v === localGuess)), [myPlayerId]: localGuess } : prev))
  }

  async function castBetVote(direction: 'left' | 'right') {
    setActionError(null)
    const { error } = await supabase.rpc('cast_bet_vote', { p_turn_id: turnId, p_direction: direction })
    if (error) setActionError(error.message)
  }

  // Guess agreement: every guesser (team minus psychic) locks the same spot.
  const guessers = players.filter((p) => p.team_id === turn.team_id && p.id !== turn.psychic_player_id)
  const lockedPlayers = guessers.filter((p) => guessLocks[p.id] !== undefined)
  const iLocked = !!myPlayerId && guessLocks[myPlayerId] !== undefined

  const myTeamPlayers = players.filter((p) => p.team_id === myTeamId)
  const leftVoters = myTeamPlayers.filter((p) => teamVotes[p.id] === 'left')
  const rightVoters = myTeamPlayers.filter((p) => teamVotes[p.id] === 'right')
  const myVote = myPlayerId ? teamVotes[myPlayerId] : undefined
  const teamAgreed =
    myTeamPlayers.length > 0 &&
    (leftVoters.length === myTeamPlayers.length || rightVoters.length === myTeamPlayers.length)

  function moveGuess(v: number) {
    // Moving the dial means the team hasn't agreed yet — clear every lock.
    if (Object.keys(guessLocksRef.current).length > 0 && v !== lockedSpot) {
      guessLocksRef.current = {}
      setGuessLocks({})
      void supabase.rpc('clear_guess_locks', { p_turn_id: turnId })
    }
    setLocalGuess(v)
    setActiveMoverId(myPlayerId)
    broadcastMove(v, myPlayerId)
  }

  function endGuessDrag() {
    setActiveMoverId(null)
    broadcastDragEnd(myPlayerId)
  }

  function handleImpact(impact: DialImpact) {
    celebrateImpact(impact)
    outcomeRef.current?.then((o) => {
      const from = o.kind === 'bet' && o.direction ? (o.direction === 'left' ? impact.leftEnd : impact.rightEnd) : impact.point
      setFlight({ from, points: o.points, color: o.color, teamId: o.teamId, kind: o.kind })
    })
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      <Starfield />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 16px',
          boxSizing: 'border-box',
          gap: 12,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <GameHeader
          round={turn.round_number}
          total={totalRounds}
          onMenu={isHost ? () => setMenuOpen(true) : undefined}
          onLeave={() => setConfirmLeaveOpen(true)}
        />
        {actionError && (
          <p role="alert" style={{ margin: 0, textAlign: 'center', color: 'var(--comets)', font: '500 14px var(--font-body)' }}>
            {actionError}
          </p>
        )}
        {isHost && (
          <HostMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            partyId={turn.party_id}
            players={players}
            myPlayerId={myPlayerId}
          />
        )}
        {confirmLeaveOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(8,6,24,.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
              zIndex: 60,
            }}
            onClick={() => setConfirmLeaveOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 340,
                background: 'linear-gradient(180deg,#221B4F,#130F30)',
                border: '1px solid rgba(200,180,255,.2)',
                borderRadius: 24,
                padding: '24px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
                <span style={{ font: '700 18px var(--font-display)', color: 'var(--text)' }}>Leave the game?</span>
                <span style={{ font: '400 14px var(--font-body)', color: 'var(--text-muted)' }}>
                  This might end the game for everyone.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Btn kind="secondary" size="md" label="No, stay" onClick={() => setConfirmLeaveOpen(false)} />
                </div>
                <div style={{ flex: 1 }}>
                  <Btn kind="primary" size="md" label="Yes, leave" onClick={onLeave} />
                </div>
              </div>
            </div>
          </div>
        )}

        {turn.status === 'clue' && isPsychic && (
          <ClueCard
            label="ONLY YOU SEE THE TARGET"
            clue={clueText}
            tone="gold"
            editable
            onClueChange={setClueText}
            placeholder="Type a clue…"
          />
        )}
        {turn.status === 'clue' && !isPsychic && (
          <ClueCard label={`${activeTeamName}'S TURN`.toUpperCase()} clue={`${psychicName} is thinking…`} tone="default" editable={false} />
        )}
        {turn.status === 'guessing' && !isActiveTeam && (
          <ClueCard label={`${activeTeamName} ARE GUESSING`.toUpperCase()} clue={turn.clue_text ?? ''} tone="default" editable={false} live />
        )}
        {(turn.status === 'guessing' && isActiveTeam) || turn.status === 'betting' || turn.status === 'revealed' ? (
          <ClueCard label={`${psychicName}'S CLUE`.toUpperCase()} clue={turn.clue_text ?? ''} tone="default" editable={false} live={!isActiveTeam} />
        ) : null}

        <TeamScoreboard teams={displayedTeams} activeTeamId={turn.team_id} />

        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          {turn.status === 'clue' && isPsychic && (
            <DialFan
              key={turn.spectrum_id}
              value={turn.target_position ?? 0.5}
              revealedTarget={turn.target_position ?? undefined}
              showNeedle={false}
              glowWinner={false}
              left={spectrumLabels?.left}
              right={spectrumLabels?.right}
            />
          )}
          {turn.status === 'clue' && !isPsychic && (
            <>
              <DialFan value={0.5} left={spectrumLabels?.left} right={spectrumLabels?.right} />
              <NoteBox text={isActiveTeam ? 'Get ready to guess' : "Next: you'll bet left or right"} />
            </>
          )}
          {turn.status === 'guessing' && isActiveTeam && !isPsychic && (
            <>
              <DialFan
                value={localGuess}
                interactive
                onChange={moveGuess}
                onDragEnd={endGuessDrag}
                activeMover={activeMover}
                left={spectrumLabels?.left}
                right={spectrumLabels?.right}
              />
              <p style={{ margin: 0, textAlign: 'center', font: '400 13px var(--font-body)', color: 'var(--text-muted)' }}>
                Drag the needle — your team sees it move live
              </p>
            </>
          )}
          {turn.status === 'guessing' && isActiveTeam && isPsychic && (
            <>
              <DialFan value={localGuess} activeMover={activeMover} left={spectrumLabels?.left} right={spectrumLabels?.right} />
              <NoteBox text="Your team is guessing — you already gave the clue" />
            </>
          )}
          {turn.status === 'guessing' && !isActiveTeam && (
            <>
              <DialFan value={localGuess} activeMover={activeMover} left={spectrumLabels?.left} right={spectrumLabels?.right} />
              <NoteBox text="Get ready to bet left or right" />
            </>
          )}
          {turn.status === 'betting' && (
            <DialFan value={turn.guess_position ?? 0.5} left={spectrumLabels?.left} right={spectrumLabels?.right} />
          )}
          {turn.status === 'revealed' && (
            <DialFan
              key={turn.id}
              value={turn.guess_position ?? 0.5}
              revealedTarget={turn.target_position ?? undefined}
              revealHoldMs={1000}
              impactFx
              onImpact={handleImpact}
              left={spectrumLabels?.left}
              right={spectrumLabels?.right}
            />
          )}
          <ParticleLayer />
          {flight && <ScoreFlight spec={flight} onArrive={() => setDisplayedTeams(teamsRef.current)} />}
        </div>

        {turn.status === 'clue' && isPsychic && !turn.spectrum_rerolled && <RerollButton onReroll={rerollSpectrum} />}

        {turn.status === 'clue' && isPsychic && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 10 }}>
            <Btn kind="secondary" size="md" label="Said it out loud" onClick={() => submitClue(true)} />
            <Btn kind="primary" size="md" label="Send clue" onClick={() => submitClue(false)} />
          </div>
        )}

        {turn.status === 'guessing' && isActiveTeam && !isPsychic && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {iLocked ? (
              <Btn kind="secondary" size="lg" label="Locked in ✓" disabled />
            ) : (
              <Btn kind="primary" size="lg" label={lockedPlayers.length > 0 ? 'Agree & lock it in' : 'Lock it in'} onClick={lockGuess} />
            )}
            {guessers.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 26 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {guessers.map((p) => (
                    <span
                      key={p.id}
                      title={p.display_name}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 15,
                        background: guessLocks[p.id] !== undefined ? 'rgba(255,209,102,.25)' : 'rgba(255,255,255,.06)',
                        border: guessLocks[p.id] !== undefined ? '1.5px solid var(--gold)' : '1.5px dashed rgba(200,180,255,.3)',
                        opacity: guessLocks[p.id] !== undefined ? 1 : 0.55,
                        transition: 'all .2s ease',
                      }}
                    >
                      {p.avatar}
                    </span>
                  ))}
                </div>
                <span style={{ font: '500 12px var(--font-body)', color: 'var(--text-muted)' }}>
                  {lockedPlayers.length === 0
                    ? 'Everyone has to lock in the same spot'
                    : `${lockedPlayers.length} of ${guessers.length} locked in — moving the dial resets`}
                </span>
              </div>
            )}
          </div>
        )}

        {turn.status === 'betting' && !isActiveTeam && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <Btn
                  kind={myVote === 'left' ? 'primary' : 'secondary'}
                  size="md"
                  label="⟵ Left"
                  onClick={() => castBetVote('left')}
                  disabled={teamAgreed}
                />
                {leftVoters.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {leftVoters.map((p) => (
                      <span
                        key={p.id}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 15,
                          background: 'rgba(255,255,255,.08)',
                        }}
                      >
                        {p.avatar}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <Btn
                  kind={myVote === 'right' ? 'primary' : 'accent'}
                  size="md"
                  label="Right ⟶"
                  onClick={() => castBetVote('right')}
                  disabled={teamAgreed}
                />
                {rightVoters.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {rightVoters.map((p) => (
                      <span
                        key={p.id}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 15,
                          background: 'rgba(255,255,255,.08)',
                        }}
                      >
                        {p.avatar}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p style={{ margin: 0, textAlign: 'center', font: '400 12px var(--font-body)', color: 'var(--text-muted)' }}>
              {teamAgreed ? 'Locked in — waiting for reveal…' : "Your whole team needs to agree on a side"}
            </p>
          </div>
        )}
        {turn.status === 'betting' && isActiveTeam && <NoteBox text="Waiting for other teams to bet…" />}

        <Soundboard
          partyId={turn.party_id}
          myPlayerId={myPlayerId}
          mutedUntil={myMutedUntil}
          isHost={isHost}
          players={players}
          noisesEnabled={noisesEnabled}
        />
      </div>
    </div>
  )
}

function NoteBox({ text }: { text: string }) {
  return (
    <div
      style={{
        height: 58,
        borderRadius: 999,
        border: '1px dashed rgba(200,180,255,.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: '500 15px var(--font-body)',
        color: 'var(--text-muted)',
        textAlign: 'center',
        padding: '0 16px',
      }}
    >
      {text}
    </div>
  )
}
