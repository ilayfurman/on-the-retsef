import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AuthProvider } from './features/auth/AuthProvider'
import { useAuth } from './features/auth/useAuth'
import { SignIn } from './features/auth/SignIn'
import { Home } from './features/home/Home'
import { NameAvatarStep } from './features/party/NameAvatarStep'
import { createAndJoinParty } from './features/party/CreateParty'
import { joinParty } from './features/party/JoinParty'
import { Lobby } from './features/party/Lobby'
import { ShuffleReveal } from './features/party/ShuffleReveal'
import { GameScreen } from './features/game/GameScreen'
import { FinalScoreboard } from './features/game/FinalScoreboard'
import { RematchWaiting } from './features/game/RematchWaiting'
import { PacksList } from './features/packs/PacksList'
import { PackEditor } from './features/packs/PackEditor'
import { supabase } from './lib/supabaseClient'
import { errorMessage } from './lib/errorMessage'
import { Starfield } from './components/Starfield'
import { Logo } from './components/Logo'

type Route =
  | { name: 'home' }
  | { name: 'join'; roomCode: string }
  | { name: 'lobby'; partyId: string; roomCode: string; isHost: boolean }
  | { name: 'packs' }
  | { name: 'packEditor'; packId: string }

function Splash() {
  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Starfield />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: '32px 20px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          <Logo variant="icon" size="lg" />
          <Logo variant="stacked" size="xl" />
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: 17, fontWeight: 500 }}>
            The Guess-the-Dial Party Game
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', opacity: 0.55 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', opacity: 0.25 }} />
        </div>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-subtle)' }}>
          retsef <span style={{ color: 'var(--lavender)' }}>(RET-sef)</span> &middot; Hebrew for &quot;continuum&quot;
        </span>
      </div>
    </div>
  )
}

function PartyRoom({
  partyId,
  roomCode,
  isHost,
  onBackToHome,
}: {
  partyId: string
  roomCode: string
  isHost: boolean
  onBackToHome: () => void
}) {
  const [status, setStatus] = useState<'lobby' | 'playing' | 'finished' | null>(null)
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null)
  const [teams, setTeams] = useState<{ id: string; name: string; score: number }[]>([])
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myMutedUntil, setMyMutedUntil] = useState<string | null>(null)
  const [players, setPlayers] = useState<
    { id: string; display_name: string; avatar: string; confirmed_rematch: boolean; team_id: string | null }[]
  >([])
  // Shown in place of GameScreen for a beat right as `status` flips to
  // 'playing', when the party only ever had one team — see the effect below
  // for why this replaced a host-side timed wait.
  const [quickRevealActive, setQuickRevealActive] = useState(false)
  const prevStatusRef = useRef<typeof status>(null)
  // `hasStarted` means "any game has ever started in this party" and never
  // resets — used to tell apart the party's very first lobby->playing edge
  // from a rematch's (a rematch reopens the lobby, but the team was already
  // revealed once; replaying that reveal on the exact same team just reads
  // as a glitch, not new information).
  const prevHasStartedRef = useRef(false)
  // Tags each reloadPartyState() call so an out-of-order (stale) response
  // can be dropped instead of overwriting a newer one — see the comment in
  // reloadPartyState itself.
  const reloadSeqRef = useRef(0)
  const [rounds, setRounds] = useState(3)
  const [noisesEnabled, setNoisesEnabled] = useState(true)
  // Whether any game has ever started in this party — used to tell apart a
  // brand-new party's first 'lobby' (everyone belongs there immediately)
  // from a rematch's reopened 'lobby' (a player who hasn't personally
  // confirmed yet must stay on their own end screen, not get swept in by
  // someone else's — namely the host's — action).
  const [hasStarted, setHasStarted] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  // Derived fresh on every reload from the party's real host_id — never a
  // static flag from whenever this player first created/joined. Otherwise a
  // host-leaves promotion (leave_party reassigns host_id server-side) would
  // never be reflected client-side: the newly-promoted player would be
  // stuck seeing the non-host "waiting" view forever, since nothing ever
  // told their screen the prop-level isHost it started with was stale.
  const [isHostLive, setIsHostLive] = useState(isHost)
  const [endedReason, setEndedReason] = useState<string | null>(null)

  async function reloadPartyState() {
    // This is triggered from several independent sources — the parties/
    // teams/players realtime subscriptions (any of which can fire close
    // together, e.g. start_game touches both parties and players), the
    // focus listener, and the poll — so more than one call can be in
    // flight at once. Each does 5 parallel network queries, so nothing
    // guarantees an EARLIER call's response actually arrives first: a call
    // that started before start_game committed (reading the old
    // confirmed_rematch=true/status='lobby' state) can resolve AFTER a
    // later call that already applied the fresh 'playing' state, silently
    // overwriting it and flashing the old "waiting on rematch" screen for a
    // frame before the next reload corrects it. Tagging each call and
    // dropping any whose result is no longer the latest one issued closes
    // that gap.
    const seq = ++reloadSeqRef.current
    // `myPlayerId`/`myTeamId`/`myMutedUntil` are derived from this SAME
    // playerRows fetch (matched by account_id) rather than a second,
    // sequential query — a separate later `await` here previously caused an
    // extra render in between where `myPlayerId` was still its stale/initial
    // value while `players`/`status`/`hasStarted` had already updated. For a
    // player who just joined a reopened rematch lobby, that gap made `me`
    // resolve to undefined for one render, which the "hasn't confirmed yet"
    // gate misread as true — flashing the old game's final scoreboard before
    // snapping to the real lobby.
    const [{ data: party }, { data: teamRows }, { data: turnRows }, { data: playerRows }, { data: userData }] = await Promise.all([
      supabase.from('parties').select('status, rounds, noises_enabled, host_id, has_started, ended_reason').eq('id', partyId).single(),
      supabase.from('teams').select('id, name, score').eq('party_id', partyId),
      supabase.from('turns_view').select('id').eq('party_id', partyId).order('created_at', { ascending: false }).limit(1),
      supabase.from('players').select('id, account_id, display_name, avatar, team_id, muted_until, confirmed_rematch').eq('party_id', partyId),
      supabase.auth.getUser(),
    ])
    if (seq !== reloadSeqRef.current) return
    const userId = userData.user?.id
    const me = (playerRows ?? []).find((p) => p.account_id === userId)
    setStatus(party!.status)
    setRounds(party!.rounds)
    setNoisesEnabled(party!.noises_enabled)
    setIsHostLive(party!.host_id === userId)
    setHasStarted(party!.has_started)
    setEndedReason(party!.ended_reason)
    setTeams(teamRows ?? [])
    setCurrentTurnId(turnRows?.[0]?.id ?? null)
    setPlayers(
      (playerRows ?? []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        avatar: p.avatar,
        confirmed_rematch: p.confirmed_rematch,
        team_id: p.team_id,
      })),
    )
    setMyPlayerId(me?.id ?? null)
    setMyTeamId(me?.team_id ?? null)
    setMyMutedUntil(me?.muted_until ?? null)
  }

  useEffect(() => {
    reloadPartyState()
    // No 'turns' subscription: the base table has no SELECT RLS policy (by
    // design, so turns_view's redaction of target_position stays real
    // security, not just client-side hiding), so Realtime can never
    // authorize a postgres_changes subscription on it. start_game and
    // advance_turn both also touch `parties`, so the parties subscription
    // below already picks up "a new turn started" reliably.
    const channel = supabase
      .channel(`party-room:${partyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` }, reloadPartyState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `party_id=eq.${partyId}` }, reloadPartyState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `party_id=eq.${partyId}` }, reloadPartyState)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  // Safety net for realtime silently going stale (observed after very long
  // sessions — some events stop arriving on a given tab's socket while
  // others keep working, with no visible disconnect to react to, and it can
  // affect any table/event, not just one). Refetching only on focus still
  // leaves a tab that's just sitting there, actively being watched, stuck
  // until something else happens to it — so this also polls on a short
  // timer regardless of focus, closing that gap without waiting on a real
  // fix for whatever's making the realtime connection unreliable here.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') reloadPartyState()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const interval = setInterval(reloadPartyState, 4000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  // Detects the lobby->playing edge locally, off state this client already
  // has from its own latest reloadPartyState fetch — deliberately not a
  // cross-client timing race (a host trying to hold the game open for
  // exactly as long as it takes every guest's connection to catch up). A
  // single-team party has nothing to actually reveal via shuffle, so this is
  // the one moment worth pausing on before the game screen appears.
  useEffect(() => {
    const prevStatus = prevStatusRef.current
    const prevHasStarted = prevHasStartedRef.current
    prevStatusRef.current = status
    prevHasStartedRef.current = hasStarted
    // Must be a genuine lobby->playing edge, not just "the first fetch after
    // a refresh happened to land on 'playing'" — `prevStatus` starts out
    // `null` on every mount, so a page reload mid-game would otherwise look
    // identical to a fresh start and replay this reveal on top of an
    // already-running game. `!prevHasStarted` further restricts it to the
    // party's actual first game, not a rematch reusing the same team.
    if (status === 'playing' && prevStatus === 'lobby' && !prevHasStarted && teams.length === 1) {
      setQuickRevealActive(true)
      // ShuffleReveal's single-team "huddle" runs ~3.1s (run in, 1-2-3
      // chant, TEAM! jump, hop into the box), then a ~0.9s beat on the
      // result before moving on to the game.
      const timer = setTimeout(() => setQuickRevealActive(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [status, hasStarted, teams.length])

  if (status === null) {
    return <Splash />
  }

  const handleLeave = async () => {
    setLeaveError(null)
    const { error } = await supabase.rpc('leave_party', { p_party_id: partyId })
    if (error) {
      setLeaveError(errorMessage(error, 'Could not leave the party. Try again.'))
      return
    }
    onBackToHome()
  }
  const me = players.find((p) => p.id === myPlayerId)
  const leaveErrorBanner = leaveError && (
    <p
      role="alert"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'var(--comets)',
        fontFamily: 'var(--font-body)',
        fontSize: 14,
        zIndex: 50,
      }}
    >
      {leaveError}
    </p>
  )

  if (status === 'lobby' && hasStarted && !me?.confirmed_rematch) {
    // The host has already reopened the shared lobby for a rematch, but
    // *this* player hasn't personally decided yet — their own navigation
    // must never be driven by someone else's click, so they stay right
    // here (their final scoreboard) until they choose Play Again or Leave.
    return (
      <>
        <FinalScoreboard
          teams={teams}
          onPlayAgain={async () => {
            const { error } = await supabase.rpc('confirm_rematch', { p_party_id: partyId })
            if (error) throw error
          }}
          onLeave={handleLeave}
        />
        {leaveErrorBanner}
      </>
    )
  }
  if (status === 'lobby') {
    return (
      <Lobby
        partyId={partyId}
        roomCode={roomCode}
        isHost={isHostLive}
        onStartGame={async () => {
          const { error } = await supabase.rpc('start_game', { p_party_id: partyId })
          if (error) throw error
        }}
        onLeave={onBackToHome}
      />
    )
  }
  if (status === 'playing' && quickRevealActive && myPlayerId && myTeamId) {
    const playersByTeam = new Map<string, typeof players>()
    for (const p of players) {
      if (!p.team_id) continue
      playersByTeam.set(p.team_id, [...(playersByTeam.get(p.team_id) ?? []), p])
    }
    return (
      <ShuffleReveal
        open
        shuffleRequestId={0}
        players={players}
        startRects={{}}
        numTeamsPredicted={1}
        teams={teams}
        playersByTeam={playersByTeam}
        myPlayerId={myPlayerId}
        myTeamId={myTeamId}
        canAct={false}
        skipAnimation
        onStartGame={() => {}}
        onReshuffle={() => {}}
        onDismiss={() => {}}
      />
    )
  }
  if (status === 'playing' && currentTurnId && myPlayerId && myTeamId) {
    return (
      <>
        <GameScreen
          key={currentTurnId}
          turnId={currentTurnId}
          myPlayerId={myPlayerId}
          myTeamId={myTeamId}
          teams={teams}
          isHost={isHostLive}
          myMutedUntil={myMutedUntil}
          players={players}
          totalRounds={rounds}
          noisesEnabled={noisesEnabled}
          onLeave={handleLeave}
        />
        {leaveErrorBanner}
      </>
    )
  }
  if (status === 'finished') {
    if (me?.confirmed_rematch) {
      // Only the host's own confirmation actually opens the shared lobby —
      // a non-host who's already confirmed just waits here, personally,
      // without affecting (or being affected by) anyone else's screen.
      return (
        <>
          <RematchWaiting players={players} myPlayerId={myPlayerId ?? ''} onLeave={handleLeave} />
          {leaveErrorBanner}
        </>
      )
    }
    return (
      <>
        <FinalScoreboard
          teams={teams}
          endedReason={endedReason}
          onPlayAgain={async () => {
            const { error } = await supabase.rpc('confirm_rematch', { p_party_id: partyId })
            if (error) throw error
          }}
          onLeave={handleLeave}
        />
        {leaveErrorBanner}
      </>
    )
  }
  return <Splash />
}

// A per-viewer convenience only (never read back by the server or other
// players) — if it's unavailable (private browsing, blocked storage) the
// screen just falls back to generic defaults, which is fine.
function readSavedIdentity(): { displayName: string; avatar: string } | null {
  try {
    const raw = localStorage.getItem('wavelength-identity')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.displayName === 'string' && typeof parsed?.avatar === 'string') return parsed
  } catch {
    // ignore — storage can throw in private/blocked contexts
  }
  return null
}

function saveIdentity(displayName: string, avatar: string) {
  try {
    localStorage.setItem('wavelength-identity', JSON.stringify({ displayName, avatar }))
  } catch {
    // ignore — non-critical convenience only
  }
}

// What the player is trying to do, once they've picked a name/avatar for
// THIS party — chosen fresh each time rather than reusing one identity
// across every game, so onContinue below knows which action to resume.
type PendingAction = { type: 'create' } | { type: 'join'; roomCode: string }

function Gate() {
  const { session, loading } = useAuth()
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const saved = readSavedIdentity()
  const [displayName, setDisplayName] = useState(saved?.displayName ?? 'Player')
  const [avatar, setAvatar] = useState(saved?.avatar ?? '🌮')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [homeBusy, setHomeBusy] = useState<'create' | 'join' | null>(null)
  const [rehydrating, setRehydrating] = useState(true)

  useEffect(() => {
    const hash = window.location.hash.match(/^#\/join\/([A-Z]{4})$/i)
    if (hash) setRoute({ name: 'join', roomCode: hash[1].toUpperCase() })
  }, [])

  // Recover "which party am I in" after a page reload — route state otherwise
  // lives only in memory, so a refresh would silently strand a player mid-game.
  useEffect(() => {
    if (loading) return // auth hasn't resolved yet — don't judge "no session" prematurely
    if (!session) {
      setRehydrating(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('players')
        .select('display_name, avatar, party_id, parties(room_code, host_id, status, created_at)')
        .eq('account_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(5)
      if (cancelled) return
      type Row = {
        display_name: string
        avatar: string
        party_id: string
        parties: { room_code: string; host_id: string; status: string; created_at: string } | null
      }
      // Only rejoin a party that's genuinely still going — an old party
      // abandoned mid-game (everyone just closed the tab, never played to
      // 'finished') would otherwise stay "active" forever and silently drop
      // a returning player straight back into a stale game from days ago.
      const REJOIN_WINDOW_MS = 24 * 60 * 60 * 1000
      const active = (data as Row[] | null)?.find(
        (row) =>
          row.parties &&
          row.parties.status !== 'finished' &&
          Date.now() - new Date(row.parties.created_at).getTime() < REJOIN_WINDOW_MS,
      )
      if (active && active.parties) {
        setDisplayName(active.display_name)
        setAvatar(active.avatar)
        saveIdentity(active.display_name, active.avatar)
        setRoute({
          name: 'lobby',
          partyId: active.party_id,
          roomCode: active.parties.room_code,
          isHost: active.parties.host_id === session.user.id,
        })
      }
      setRehydrating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [session, loading])

  if (loading) return <div data-testid="app-root"><Splash /></div>
  if (!session) return <div data-testid="app-root"><SignIn /></div>
  if (rehydrating) return <div data-testid="app-root"><Splash /></div>

  async function handleCreate(name: string, chosenAvatar: string) {
    setDisplayName(name)
    setAvatar(chosenAvatar)
    saveIdentity(name, chosenAvatar)
    setHomeBusy('create')
    try {
      const { partyId, roomCode } = await createAndJoinParty(name, chosenAvatar)
      setPendingAction(null)
      setRoute({ name: 'lobby', partyId, roomCode, isHost: true })
    } finally {
      setHomeBusy(null)
    }
  }

  async function handleJoin(roomCode: string, name: string, chosenAvatar: string) {
    setDisplayName(name)
    setAvatar(chosenAvatar)
    saveIdentity(name, chosenAvatar)
    setJoinError(null)
    setHomeBusy('join')
    try {
      const player = (await joinParty(roomCode, name, chosenAvatar)) as { party_id: string }
      setPendingAction(null)
      setRoute({ name: 'lobby', partyId: player.party_id, roomCode, isHost: false })
    } catch (err) {
      setJoinError(errorMessage(err, 'Could not join that room. Check the code and try again.'))
    } finally {
      setHomeBusy(null)
    }
  }

  return (
    <div data-testid="app-root">
      {route.name === 'home' || route.name === 'join' ? (
        pendingAction ? (
          <NameAvatarStep
            initialName={displayName}
            initialAvatar={avatar}
            title={pendingAction.type === 'create' ? 'Who are you tonight?' : `Joining ${pendingAction.roomCode}`}
            continueLabel={pendingAction.type === 'create' ? 'Create party' : 'Join party'}
            onBack={() => setPendingAction(null)}
            onContinue={(name, chosenAvatar) =>
              pendingAction.type === 'create'
                ? handleCreate(name, chosenAvatar)
                : handleJoin(pendingAction.roomCode, name, chosenAvatar)
            }
          />
        ) : (
          <>
            <Home
              email={session.user.email}
              onCreate={() => setPendingAction({ type: 'create' })}
              onJoin={(code) => setPendingAction({ type: 'join', roomCode: code })}
              onOpenPacks={() => setRoute({ name: 'packs' })}
              onSignOut={() => supabase.auth.signOut()}
              busy={homeBusy}
            />
            {joinError && (
              <p role="alert" style={{ position: 'fixed', bottom: 16, left: 0, right: 0, textAlign: 'center', color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
                {joinError}
              </p>
            )}
          </>
        )
      ) : route.name === 'packs' ? (
        <PacksList onOpenPack={(packId) => setRoute({ name: 'packEditor', packId })} onBack={() => setRoute({ name: 'home' })} />
      ) : route.name === 'packEditor' ? (
        <PackEditor packId={route.packId} onBack={() => setRoute({ name: 'packs' })} />
      ) : (
        <PartyRoom
          partyId={route.partyId}
          roomCode={route.roomCode}
          isHost={route.isHost}
          onBackToHome={() => setRoute({ name: 'home' })}
        />
      )}
    </div>
  )
}

// Dev-only reveal FX playground (see RevealPreview). import.meta.env.DEV is
// statically false in production builds, so this whole import is dropped.
const RevealPreview = import.meta.env.DEV ? lazy(() => import('./features/dev/RevealPreview')) : null
const ShufflePreview = import.meta.env.DEV ? lazy(() => import('./features/dev/ShufflePreview')) : null

export default function App() {
  if (RevealPreview && window.location.hash === '#/fx-preview') {
    return (
      <Suspense fallback={null}>
        <RevealPreview />
      </Suspense>
    )
  }
  if (ShufflePreview && window.location.hash.startsWith('#/shuffle-preview')) {
    return (
      <Suspense fallback={null}>
        <ShufflePreview />
      </Suspense>
    )
  }
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
