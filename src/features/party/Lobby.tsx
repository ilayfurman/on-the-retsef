import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { errorMessage } from '../../lib/errorMessage'
import { Starfield } from '../../components/Starfield'
import { Btn } from '../../components/Btn'
import { ShuffleReveal } from './ShuffleReveal'
import { AvatarPicker, AVATAR_BG } from './AvatarPicker'
import { colorForTeam } from '../../components/TeamScoreboard'

type Player = { id: string; display_name: string; avatar: string; team_id: string | null; confirmed_rematch: boolean }
type Team = { id: string; name: string }
type TeamMode = 'random' | 'manual'

// Same rotation TeamScoreboard uses, so a team's color stays consistent
// between the lobby and the in-game scoreboard.

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 20,
  border: '1px solid var(--surface-border)',
  background: 'var(--surface)',
  boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 16,
  fontWeight: 600,
}

const mutedStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
}

const avatarChipStyle = (size: number): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: Math.round(size * 0.5),
  flex: 'none',
})

const segmentGroupStyle: CSSProperties = {
  display: 'flex',
  borderRadius: 999,
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  padding: 4,
  gap: 4,
}

function segmentButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '7px 14px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    fontWeight: 600,
    background: active ? 'var(--cream)' : 'transparent',
    color: active ? '#1A1233' : 'var(--text-muted)',
  }
}

function switchTrackStyle(checked: boolean): CSSProperties {
  return {
    width: 52,
    height: 32,
    borderRadius: 999,
    border: 'none',
    background: checked ? 'var(--gold-cta)' : 'var(--input-bg)',
    position: 'relative',
    cursor: 'pointer',
    padding: 3,
    flex: 'none',
    transition: 'background 0.15s ease',
    boxSizing: 'border-box',
  }
}

function switchDotStyle(checked: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: 3,
    left: checked ? 23 : 3,
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 2px 6px rgba(0,0,0,.3)',
    transition: 'left 0.15s ease',
  }
}

const stepperRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 36,
}

const stepperControlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}

const stepperButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: 'rgba(255,255,255,.08)',
  border: '1px solid rgba(200,180,255,.16)',
  color: 'var(--text)',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
}

const stepperValueStyle: CSSProperties = {
  minWidth: 20,
  textAlign: 'center',
  fontFamily: 'var(--font-body)',
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text)',
}

const pillStyle: CSSProperties = {
  height: 34,
  display: 'flex',
  alignItems: 'center',
  padding: '0 14px',
  borderRadius: 999,
  background: 'rgba(255,255,255,.06)',
  border: '1px solid var(--surface-border)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-muted)',
}

export function Lobby({
  partyId,
  roomCode,
  isHost,
  onStartGame,
  onLeave,
}: {
  partyId: string
  roomCode: string
  isHost: boolean
  onStartGame: () => Promise<void> | void
  // Also used to gate whether the back/leave affordance renders at all —
  // both the back chevron and any explicit leave action now do the exact
  // same thing (actually leave the party), so there's no separate
  // "just navigate away" option left to distinguish them by.
  onLeave?: () => void
}) {
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [players, setPlayers] = useState<Player[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [numTeams, setNumTeams] = useState(2)
  const [rounds, setRounds] = useState(3)
  const [teamMode, setTeamModeState] = useState<TeamMode>('random')
  const [noisesEnabled, setNoisesEnabledState] = useState(true)
  const [hasStarted, setHasStarted] = useState(false)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [editName, setEditName] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [identityBusy, setIdentityBusy] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [rematchBusy, setRematchBusy] = useState(false)
  const [rematchError, setRematchError] = useState<string | null>(null)
  const [attachedPacks, setAttachedPacks] = useState<{ id: string; name: string }[]>([])
  const [packSpectrumCounts, setPackSpectrumCounts] = useState<Record<string, number>>({})
  const [myPacks, setMyPacks] = useState<{ id: string; name: string; share_code: string }[]>([])
  const [packsExpanded, setPacksExpanded] = useState(false)
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [removePackConfirm, setRemovePackConfirm] = useState<{ id: string; name: string; remaining: number } | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [shuffleVersion, setShuffleVersion] = useState(0)
  // The reveal overlay restarts its animation whenever this changes. The
  // host sets it immediately on click (no network wait). Other players never
  // set it directly — they pick it up from the party's shuffle_nonce column
  // (bumped by shuffle_teams itself), diffed old-vs-new directly inside the
  // realtime UPDATE event for `parties` (see the channel subscription
  // below), not by comparing against a separately-fetched "baseline" value.
  // An earlier version did the latter and had a real race: if a player
  // joined right as the host clicked Shuffle/Start, their own first
  // settings fetch could land AFTER the nonce had already bumped, so it got
  // absorbed into the baseline and was never seen as a live event —
  // producing "the reveal only showed for the host". Diffing within one
  // atomic event can't race against a separate fetch the same way.
  const [shuffleRequestId, setShuffleRequestId] = useState(0)
  // Which shuffle's result `teams`/`players` are known to reflect. On a
  // reshuffle the OLD teams are still loaded when the reveal starts, so the
  // reveal must wait for this to match shuffleRequestId rather than just
  // "teams exist" — otherwise a slow network could reveal stale teams.
  const [revealReadyFor, setRevealReadyFor] = useState<number | null>(null)
  const [shuffling, setShuffling] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Full-screen animated reveal shown while/after shuffling — purely a local
  // flourish for whoever clicked Shuffle/Reshuffle (same as the team-card-in
  // stagger it replaces the inline version of), not synced to other players.
  const [revealOpen, setRevealOpen] = useState(false)
  // Where each avatar actually was on screen the instant Shuffle/Reshuffle
  // was clicked — captured synchronously before the overlay opens, so it can
  // animate avatars flying IN from their real starting spot instead of
  // popping into existence already centered.
  const [startRects, setStartRects] = useState<Record<string, DOMRect>>({})

  // Always read fresh inside the channel handler below, which is only set
  // up once per partyId (mount) — a plain closure over `isHost` there would
  // go stale if this player gets promoted to host mid-lobby.
  const isHostRef = useRef(isHost)
  isHostRef.current = isHost
  // Established by loadPartySettings; null means "not fetched yet" so the
  // very first fetch (mount) is never mistaken for a live change.
  const lastKnownNonceRef = useRef<number | null>(null)

  function captureAvatarRects(): Record<string, DOMRect> {
    const map: Record<string, DOMRect> = {}
    document.querySelectorAll<HTMLElement>('[data-avatar-id]').forEach((el) => {
      const id = el.dataset.avatarId
      if (id) map[id] = el.getBoundingClientRect()
    })
    return map
  }

  async function loadPlayers() {
    const { data, error } = await supabase
      .from('players')
      .select('id, display_name, avatar, team_id, confirmed_rematch')
      .eq('party_id', partyId)
      .order('created_at')
    if (error) {
      setLoadError(errorMessage(error, 'Could not load players.'))
      return
    }
    setPlayers((data as Player[]) ?? [])
  }

  async function loadTeams() {
    const { data, error } = await supabase
      .from('teams')
      .select('id, name')
      .eq('party_id', partyId)
      .order('created_at')
    if (error) {
      setLoadError(errorMessage(error, 'Could not load teams.'))
      return
    }
    setTeams((data as Team[]) ?? [])
  }

  async function loadAttachedPacks() {
    const { data } = await supabase
      .from('party_packs')
      .select('pack_id, packs(name)')
      .eq('party_id', partyId)
    const packs = ((data as { pack_id: string; packs: { name: string }[] | null }[]) ?? []).map((row) => ({
      id: row.pack_id,
      name: row.packs?.[0]?.name ?? 'Unnamed pack',
    }))
    setAttachedPacks(packs)

    if (packs.length === 0) {
      setPackSpectrumCounts({})
      return
    }
    // Per-pack counts, for the "you'd still have N cards left" removal
    // confirmation — fetched as plain rows and counted client-side rather
    // than a nested count() aggregate, which PostgREST doesn't support two
    // relations deep (party_packs -> packs -> spectrums(count)).
    const { data: specRows } = await supabase
      .from('spectrums')
      .select('pack_id')
      .in('pack_id', packs.map((p) => p.id))
    const counts: Record<string, number> = {}
    for (const row of (specRows as { pack_id: string }[]) ?? []) {
      counts[row.pack_id] = (counts[row.pack_id] ?? 0) + 1
    }
    setPackSpectrumCounts(counts)
  }

  function requestRemovePack(pack: { id: string; name: string }) {
    setPackError(null)
    const total = Object.values(packSpectrumCounts).reduce((sum, n) => sum + n, 0)
    const remaining = total - (packSpectrumCounts[pack.id] ?? 0)
    if (remaining === 0) {
      setPackError(`Can't remove "${pack.name}" — it's the only pack with cards left right now.`)
      return
    }
    setRemovePackConfirm({ id: pack.id, name: pack.name, remaining })
  }

  async function confirmRemovePack() {
    if (!removePackConfirm) return
    setPackBusy(true)
    setPackError(null)
    try {
      const { error } = await supabase.rpc('remove_party_pack', { p_party_id: partyId, p_pack_id: removePackConfirm.id })
      if (error) throw error
      setRemovePackConfirm(null)
      await loadAttachedPacks()
    } catch (err) {
      setPackError(errorMessage(err, 'Could not remove that pack. Try again.'))
      setRemovePackConfirm(null)
    } finally {
      setPackBusy(false)
    }
  }

  async function loadMyPacks() {
    const userId = (await supabase.auth.getUser()).data.user?.id
    if (!userId) return
    // Includes public packs (the Starter deck) alongside the host's own —
    // otherwise, once Starter is removed from a party, it has no share code
    // visible anywhere in the UI to type back in, and becomes permanently
    // unreachable except by someone who already happens to know it's "STARTER".
    const { data } = await supabase.from('packs').select('id, name, share_code').or(`owner_id.eq.${userId},is_public.eq.true`)
    setMyPacks((data as { id: string; name: string; share_code: string }[]) ?? [])
  }

  async function addPackByCode(code: string) {
    // Attaches one of the host's own packs (or Starter) — the lobby no longer
    // takes a friend's code; friends share packs as copies instead.
    if (!code.trim()) return
    setPackBusy(true)
    setPackError(null)
    try {
      const { error } = await supabase.rpc('add_pack_by_code', { p_party_id: partyId, p_share_code: code.trim().toUpperCase() })
      if (error) throw error
      await loadAttachedPacks()
    } catch (err) {
      setPackError(errorMessage(err, 'Could not add that pack. Check the code and try again.'))
    } finally {
      setPackBusy(false)
    }
  }

  async function loadPartySettings() {
    const { data } = await supabase
      .from('parties')
      .select('num_teams, rounds, team_mode, noises_enabled, has_started, shuffle_nonce')
      .eq('id', partyId)
      .single()
    if (data) {
      setNumTeams(data.num_teams)
      setRounds(data.rounds)
      setTeamModeState(data.team_mode as TeamMode)
      setNoisesEnabledState(data.noises_enabled)
      setHasStarted(data.has_started)
      // Non-host players pick up the host's Shuffle/Start reveal here,
      // regardless of whether this call came from the realtime subscription,
      // the focus listener, or the polling fallback below — one path, so a
      // dropped realtime event still gets caught within a poll tick instead
      // of silently skipping the reveal forever. Only fires once the ref has
      // already been established by a PRIOR call: on the very first call
      // (mount), whatever value is fetched is this player's starting state,
      // not a "change" to react to.
      if (!isHostRef.current) {
        if (lastKnownNonceRef.current !== null && data.shuffle_nonce !== lastKnownNonceRef.current) {
          const nonce = data.shuffle_nonce
          setStartRects(captureAvatarRects())
          setShuffleRequestId(nonce)
          setRevealReadyFor(null)
          setRevealOpen(true)
          // The nonce is bumped inside shuffle_teams itself, so a fetch issued
          // after seeing it is guaranteed to read the new teams.
          void Promise.all([loadTeams(), loadPlayers()]).then(() => setRevealReadyFor(nonce))
        }
        lastKnownNonceRef.current = data.shuffle_nonce
      }
    }
  }

  async function loadMyPlayerId() {
    const userId = (await supabase.auth.getUser()).data.user?.id
    if (!userId) return
    const { data } = await supabase
      .from('players')
      .select('id')
      .eq('party_id', partyId)
      .eq('account_id', userId)
      .single()
    setMyPlayerId(data?.id ?? null)
  }

  useEffect(() => {
    // Lobby isn't remounted when switching between parties (no `key` on it
    // in App.tsx) — an overlay left open from whatever party was open
    // before would otherwise survive into this one.
    setRevealOpen(false)
    lastKnownNonceRef.current = null
    loadPlayers()
    loadTeams()
    loadPartySettings()
    loadMyPlayerId()
    loadAttachedPacks()
    // Host-only, and loaded upfront (not just when the panel expands) so the
    // collapsed "X/Y packs selected" summary is correct immediately.
    if (isHost) loadMyPacks()
    const channel = supabase
      .channel(`lobby:${partyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `party_id=eq.${partyId}` }, () => {
        loadPlayers()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `party_id=eq.${partyId}` }, () => {
        loadTeams()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` }, () => {
        loadPartySettings()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_packs', filter: `party_id=eq.${partyId}` }, () => {
        loadAttachedPacks()
      })
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
    function resync() {
      loadPlayers()
      loadTeams()
      loadPartySettings()
      loadAttachedPacks()
      if (isHost) loadMyPacks()
    }
    function onVisible() {
      if (document.visibilityState === 'visible') resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const interval = setInterval(resync, 4000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, isHost])

  async function reshuffle() {
    const req = Date.now()
    setStartRects(captureAvatarRects())
    setShuffleRequestId(req)
    setRevealReadyFor(null)
    setShuffling(true)
    setRevealOpen(true)
    try {
      await supabase.rpc('shuffle_teams', { p_party_id: partyId })
      // Don't rely solely on realtime to reflect our own action — refetch
      // explicitly so the acting client's own view is guaranteed correct
      // even if that delivery is delayed or missed.
      await Promise.all([loadTeams(), loadPlayers()])
      setRevealReadyFor(req)
      setShuffleVersion((v) => v + 1)
    } finally {
      setShuffling(false)
    }
  }

  async function saveSettings(overrides?: { teamMode?: TeamMode; noisesEnabled?: boolean; numTeams?: number; rounds?: number }) {
    const { error } = await supabase.rpc('set_party_settings', {
      p_party_id: partyId,
      p_num_teams: overrides?.numTeams ?? numTeams,
      p_rounds: overrides?.rounds ?? rounds,
      p_team_mode: overrides?.teamMode ?? teamMode,
      p_noises_enabled: overrides?.noisesEnabled ?? noisesEnabled,
    })
    if (error) {
      setSettingsError(errorMessage(error, 'Could not save settings. Try again.'))
      // Revert the optimistic local update — the server rejected it, so the
      // UI must not keep showing a mode the party isn't actually in.
      void loadPartySettings()
    }
  }

  async function selectTeamMode(mode: TeamMode) {
    setSettingsError(null)
    setTeamModeState(mode)
    await saveSettings({ teamMode: mode })
    if (mode === 'manual') {
      const { error } = await supabase.rpc('create_pick_teams', { p_party_id: partyId })
      if (error) {
        setSettingsError(errorMessage(error, 'Could not set up teams. Try again.'))
      } else {
        await loadTeams()
      }
    }
  }

  function toggleNoises() {
    const next = !noisesEnabled
    setNoisesEnabledState(next)
    void saveSettings({ noisesEnabled: next })
  }

  function changeNumTeams(next: number) {
    // 1 team is valid (everyone together); above that, every team needs at
    // least 2 players, so this can't exceed maxTeams.
    const clamped = Math.min(maxTeams, Math.max(1, next))
    setNumTeams(clamped)
    void saveSettings({ numTeams: clamped })
  }

  function changeRounds(next: number) {
    const clamped = Math.max(1, next)
    setRounds(clamped)
    void saveSettings({ rounds: clamped })
  }

  async function joinTeam(teamName: string) {
    if (!myPlayerId || !teamName.trim()) return
    await supabase.rpc('assign_manual_team', {
      p_party_id: partyId,
      p_player_id: myPlayerId,
      p_team_name: teamName.trim(),
    })
  }

  async function shuffleAndReveal() {
    const req = Date.now()
    setStartRects(captureAvatarRects())
    setShuffleRequestId(req)
    setRevealReadyFor(null)
    setStartError(null)
    setShuffling(true)
    setRevealOpen(true)
    try {
      const { error } = await supabase.rpc('shuffle_teams', { p_party_id: partyId })
      if (error) throw error
      // Don't rely solely on realtime to reflect our own action — refetch
      // explicitly so the acting client's own view is guaranteed correct
      // even if that delivery is delayed or missed.
      await Promise.all([loadTeams(), loadPlayers()])
      setRevealReadyFor(req)
      setShuffleVersion((v) => v + 1)
    } catch (err) {
      setStartError(errorMessage(err, 'Could not shuffle teams. Try again.'))
      setRevealOpen(false)
    } finally {
      setShuffling(false)
    }
  }

  async function handleStartGame() {
    setStartError(null)
    setStarting(true)
    try {
      // With fewer than 4 players there's no shuffle step to click through
      // (see forcedSingleTeam), so no team may exist yet at all. start_game
      // only auto-shuffles server-side in Random mode — if team_mode was
      // left as 'manual' from before the player count dropped this low,
      // it would otherwise reject with "No teams assigned yet". Setting up
      // the single team directly here works regardless of that setting.
      //
      // The "Everyone's on one team" moment itself is shown by PartyRoom
      // (App.tsx), not here — every client (host included) renders it
      // locally off its own freshly-fetched `status`/`teams` the instant it
      // sees the lobby->playing transition, instead of the host trying to
      // time a fixed wait against every other client's realtime delivery.
      // That used to be a real race: a slow/stale connection could make a
      // guest's client miss the host's shuffle-nonce bump entirely before
      // the host moved on to actually starting the game, skipping their
      // reveal outright. Doing it off `status` instead removes the race —
      // there's nothing to miss, since `status` flipping to 'playing' is
      // the same fetch that already delivers the final teams.
      if (forcedSingleTeam && teams.length === 0) {
        const { error } = await supabase.rpc('shuffle_teams', { p_party_id: partyId })
        if (error) throw error
      }
      await onStartGame()
    } catch (err) {
      setStartError(errorMessage(err, 'Could not start the game. Try again.'))
    } finally {
      setStarting(false)
    }
  }

  async function confirmRematch() {
    setRematchBusy(true)
    setRematchError(null)
    try {
      const { error } = await supabase.rpc('confirm_rematch', { p_party_id: partyId })
      if (error) throw error
    } catch (err) {
      setRematchError(errorMessage(err, 'Could not confirm. Try again.'))
    } finally {
      setRematchBusy(false)
    }
  }

  async function leaveGame() {
    setRematchBusy(true)
    setRematchError(null)
    try {
      const { error } = await supabase.rpc('leave_party', { p_party_id: partyId })
      if (error) throw error
      onLeave?.()
    } catch (err) {
      setRematchError(errorMessage(err, 'Could not leave. Try again.'))
    } finally {
      setRematchBusy(false)
    }
  }

  async function copyShareLink() {
    const link = `${window.location.origin}${window.location.pathname}#/join/${roomCode}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // Clipboard access can be denied by the browser; the room code is
      // already on screen so the player can still share it manually.
    }
  }

  function openIdentityEditor(currentName: string, currentAvatar: string) {
    setEditName(currentName)
    setEditAvatar(currentAvatar)
    setIdentityError(null)
    setEditingIdentity(true)
  }

  async function saveIdentityEdit() {
    if (!editName.trim()) {
      setIdentityError('Name cannot be empty.')
      return
    }
    setIdentityBusy(true)
    setIdentityError(null)
    try {
      const { error } = await supabase.rpc('update_my_player_identity', {
        p_party_id: partyId,
        p_display_name: editName.trim(),
        p_avatar: editAvatar,
      })
      if (error) throw error
      try {
        localStorage.setItem('wavelength-identity', JSON.stringify({ displayName: editName.trim(), avatar: editAvatar }))
      } catch {
        // non-critical convenience only
      }
      setEditingIdentity(false)
      await loadPlayers()
    } catch (err) {
      setIdentityError(errorMessage(err, 'Could not update your name/avatar. Try again.'))
    } finally {
      setIdentityBusy(false)
    }
  }

  // Every team needs at least 2 players, so the number of teams can never
  // exceed half the player count — matches the floor the shuffle/pick RPCs
  // enforce server-side.
  const maxTeams = Math.max(1, Math.floor(players.length / 2))

  // The party's num_teams defaults to 2 at creation time, before anyone else
  // has joined — so with only 1-2 players in the room it starts out above
  // the current max. Auto-correct it down (host only, since only the host
  // can persist settings) rather than leaving the stepper showing a value
  // that's already invalid. Never auto-*raises* it — growing the count back
  // up as more players join is still a deliberate host choice.
  useEffect(() => {
    if (isHost && numTeams > maxTeams) {
      changeNumTeams(maxTeams)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, numTeams, maxTeams])

  // With fewer than 4 players, there's no real DECISION to make — a single
  // team is the only possible outcome. This only controls which buttons the
  // host sees (skip the Random/Pick toggle and the Shuffle step, go
  // straight to Start) — it must NOT make the "everyone's on one team"
  // reveal itself appear early. That reveal still waits for something to
  // actually happen (see singleTeamMode below): showing it the instant
  // someone joins, before the host has done anything at all, is exactly
  // the same "looks decided, then could change" problem this was meant to
  // avoid, just in a different case.
  const forcedSingleTeam = maxTeams <= 1

  // With only one team, "team" framing (colors, "vs" language, a separate
  // roster per team) is just confusing — everyone's playing together, so
  // show one plain unified list instead. Deliberately checks the REAL
  // teams.length only, regardless of forcedSingleTeam — a team row only
  // exists once the host has actually clicked Shuffle, or Start (which
  // creates it server-side first when forced). Before that, everyone (host
  // and guests alike) just sees the plain "no teams yet" waiting state.
  const singleTeamMode = teams.length === 1

  // forcedSingleTeam (not singleTeamMode, which is now strictly post-reveal)
  // is what must unblock Start here — with fewer than 4 players nobody's
  // team_id ever gets set before Start is clicked (handleStartGame sets the
  // team up server-side at that point), and that's fine: assignment is
  // meaningless anyway when everyone's on the only possible team.
  const allTeamsAssigned = forcedSingleTeam || (players.length > 0 && players.every((p) => p.team_id !== null))
  // Random mode auto-shuffles on Start, but only when NO teams exist yet —
  // once teams exist (e.g. a reshuffled lobby that a new player then joined),
  // a leftover unassigned player would otherwise silently sit out the whole
  // game. Blocking Start in both modes until everyone has a team forces the
  // host to Reshuffle (or manually assign) first.
  const startDisabled = players.length < 2 || !allTeamsAssigned || starting
  const unassignedPlayers = players.filter((p) => p.team_id === null)

  // Stable color per team, keyed by id so colors don't shuffle across renders.
  const sortedTeams = [...teams].sort((a, b) => a.id.localeCompare(b.id))
  const teamColor = new Map(sortedTeams.map((t) => [t.id, colorForTeam(teams, t.id)]))
  const playersByTeam = new Map(teams.map((t) => [t.id, players.filter((p) => p.team_id === t.id)]))

  const me = players.find((p) => p.id === myPlayerId)
  const myTeamId = me?.team_id ?? null
  const myTeam = teams.find((t) => t.id === myTeamId)
  const otherTeams = teams.filter((t) => t.id !== myTeamId)
  const iNeedToPick = teamMode === 'manual' && !myTeamId

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Starfield />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 16px',
          boxSizing: 'border-box',
          gap: 8,
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {onLeave && (
              <button
                onClick={leaveGame}
                aria-label="Leave party"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(200,180,255,.16)',
                  color: 'var(--text)',
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                  flex: 'none',
                }}
              >
                ‹
              </button>
            )}
            <span style={{ font: '600 17px var(--font-body)', color: 'var(--text)' }}>Lobby</span>
          </div>
          {isHost && (
            <span
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                background: 'rgba(255,209,102,.14)',
                color: 'var(--gold)',
                font: '700 11px/1 var(--font-body)',
                letterSpacing: '.12em',
              }}
            >
              HOST
            </span>
          )}
        </div>

        {loadError && (
          <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13, textAlign: 'center' }}>
            {loadError}
          </span>
        )}

        <div
          style={{
            ...cardStyle,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
              ROOM CODE
            </span>
            <span style={{ font: '700 40px/1 var(--font-display)', letterSpacing: '.1em', color: 'var(--text)' }}>{roomCode}</span>
          </div>
          <div style={{ width: 116 }}>
            <Btn kind="accent" size="sm" label={linkCopied ? 'Copied!' : 'Share link'} onClick={copyShareLink} />
          </div>
        </div>

        {me &&
          (editingIdentity ? (
            <div style={cardStyle}>
              <span style={{ ...labelStyle, fontSize: 13 }}>Edit your name &amp; avatar</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    ...avatarChipStyle(48),
                    background: AVATAR_BG[editAvatar] ?? 'var(--violet)',
                    flex: 'none',
                  }}
                >
                  {editAvatar}
                </span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Your name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 42,
                    borderRadius: 999,
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    padding: '0 16px',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 15,
                    fontWeight: 600,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <AvatarPicker value={editAvatar} onChange={setEditAvatar} />
              {identityError && (
                <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                  {identityError}
                </span>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Btn kind="secondary" size="sm" label="Cancel" onClick={() => setEditingIdentity(false)} disabled={identityBusy} />
                </div>
                <div style={{ flex: 1 }}>
                  <Btn kind="primary" size="sm" label={identityBusy ? 'Saving…' : 'Save'} onClick={saveIdentityEdit} disabled={identityBusy} />
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                ...cardStyle,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...avatarChipStyle(40), background: AVATAR_BG[me.avatar] ?? 'var(--violet)' }}>{me.avatar}</span>
                <span style={{ ...labelStyle, fontSize: 15 }}>{me.display_name}</span>
              </div>
              <button
                type="button"
                onClick={() => openIdentityEditor(me.display_name, me.avatar)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  font: '600 13px var(--font-body)',
                  cursor: 'pointer',
                  padding: '4px 6px',
                }}
              >
                Edit
              </button>
            </div>
          ))}

        {hasStarted && (
          <div style={cardStyle}>
            <span style={{ ...labelStyle, whiteSpace: 'nowrap' }}>
              Rematch <span style={{ ...mutedStyle, fontWeight: 400 }}>&middot; {players.filter((p) => p.confirmed_rematch).length}/{players.length} in</span>
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {players.map((p) => {
                const isMe = p.id === myPlayerId
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        ...avatarChipStyle(48),
                        background: 'rgba(255,255,255,.08)',
                        opacity: p.confirmed_rematch ? 1 : 0.35,
                        filter: p.confirmed_rematch ? 'none' : 'grayscale(1)',
                        boxShadow: isMe ? '0 0 0 3px #120F2E, 0 0 0 5px var(--gold)' : 'none',
                        transition: 'opacity 0.2s ease, filter 0.2s ease',
                      }}
                    >
                      {p.avatar}
                    </span>
                    <span style={{ font: '600 12px var(--font-body)', color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>
                      {isMe ? 'You' : p.display_name}
                    </span>
                  </div>
                )
              })}
            </div>
            {me && !me.confirmed_rematch && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rematchError && (
                  <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14, textAlign: 'center' }}>
                    {rematchError}
                  </span>
                )}
                <Btn kind="primary" size="md" label="Play again" onClick={confirmRematch} disabled={rematchBusy} />
                <Btn kind="secondary" size="sm" label="Leave game" onClick={leaveGame} disabled={rematchBusy} />
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {isHost && (
            <div style={cardStyle}>
              {settingsError && (
                <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                  {settingsError}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ ...labelStyle, whiteSpace: 'nowrap' }}>
                  Teams <span style={{ ...mutedStyle, fontWeight: 400 }}>&middot; {players.length} players</span>
                </span>
                {!forcedSingleTeam && (
                  <div style={{ ...segmentGroupStyle, maxWidth: 160 }} role="radiogroup" aria-label="Team mode">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={teamMode === 'random'}
                      style={segmentButtonStyle(teamMode === 'random')}
                      onClick={() => selectTeamMode('random')}
                    >
                      Random
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={teamMode === 'manual'}
                      style={segmentButtonStyle(teamMode === 'manual')}
                      onClick={() => selectTeamMode('manual')}
                    >
                      Pick
                    </button>
                  </div>
                )}
              </div>

              {singleTeamMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ ...mutedStyle }}>
                    {forcedSingleTeam
                      ? "You'll need at least 4 players to split into teams — for now, everyone's playing together."
                      : "Everyone's playing together — no teams to split up yet."}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    {players.map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span data-avatar-id={p.id} style={{ ...avatarChipStyle(36), background: 'rgba(255,255,255,.08)' }}>{p.avatar}</span>
                        <span style={{ font: '500 14px var(--font-body)', color: 'var(--text)' }}>{p.display_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {teams.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      {teams.map((t, teamIndex) => {
                        const color = teamColor.get(t.id)!
                        const members = playersByTeam.get(t.id) ?? []
                        const alreadyOnThisTeam = myTeamId === t.id
                        return (
                          <div
                            key={`${t.id}-${shuffleVersion}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              padding: 12,
                              borderRadius: 20,
                              background: rgba(color, 0.08),
                              border: `1.5px solid ${rgba(color, 0.45)}`,
                              animation: teamMode === 'random' ? `team-card-in .35s ease-out ${teamIndex * 120}ms both` : undefined,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <span style={{ font: '700 15px var(--font-body)', color }}>{t.name}</span>
                              {teamMode === 'manual' && (
                                <span style={mutedStyle}>
                                  {members.length} player{members.length === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            {members.map((p, memberIndex) => (
                              <div
                                key={`${p.id}-${shuffleVersion}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  animation:
                                    teamMode === 'random'
                                      ? `team-member-in .4s ease-out ${teamIndex * 120 + 200 + memberIndex * 90}ms both`
                                      : `team-member-in .4s ease-out ${memberIndex * 90}ms both`,
                                }}
                              >
                                <span data-avatar-id={p.id} style={{ ...avatarChipStyle(32), background: rgba(color, 0.2) }}>{p.avatar}</span>
                                <span style={{ font: '500 14px var(--font-body)', color: 'var(--text)' }}>{p.display_name}</span>
                              </div>
                            ))}
                            {teamMode === 'manual' && !alreadyOnThisTeam && (
                              <button
                                type="button"
                                onClick={() => joinTeam(t.name)}
                                style={{
                                  height: 40,
                                  borderRadius: 999,
                                  background: 'transparent',
                                  border: `1.5px dashed ${rgba(color, 0.6)}`,
                                  color,
                                  font: '600 13px var(--font-body)',
                                  cursor: 'pointer',
                                }}
                              >
                                + Join {t.name}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {unassignedPlayers.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                      <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
                        {teamMode === 'manual' ? 'STILL PICKING' : 'PLAYERS JOINED'}
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                        {unassignedPlayers.map((p) => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span data-avatar-id={p.id} style={{ ...avatarChipStyle(36), background: 'rgba(255,255,255,.08)' }}>{p.avatar}</span>
                            <span style={{ font: '500 14px var(--font-body)', color: 'var(--text)' }}>{p.display_name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {teamMode === 'random' && teams.length > 0 && (
                    <Btn kind="secondary" size="sm" label={shuffling ? 'Shuffling…' : 'Reshuffle'} onClick={reshuffle} disabled={shuffling} />
                  )}
                </>
              )}
            </div>
          )}

          {!isHost && iNeedToPick && teams.length > 0 && (
            <div style={cardStyle}>
              <span style={labelStyle}>Pick your team</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                {teams.map((t) => {
                  const color = teamColor.get(t.id)!
                  const members = playersByTeam.get(t.id) ?? []
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: 12,
                        borderRadius: 20,
                        background: rgba(color, 0.08),
                        border: `1.5px solid ${rgba(color, 0.45)}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ font: '700 15px var(--font-body)', color }}>{t.name}</span>
                        <span style={mutedStyle}>
                          {members.length} player{members.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {members.map((p) => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ ...avatarChipStyle(32), background: rgba(color, 0.2) }}>{p.avatar}</span>
                          <span style={{ font: '500 14px var(--font-body)', color: 'var(--text)' }}>{p.display_name}</span>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => joinTeam(t.name)}
                        style={{
                          height: 40,
                          borderRadius: 999,
                          background: 'transparent',
                          border: `1.5px dashed ${rgba(color, 0.6)}`,
                          color,
                          font: '600 13px var(--font-body)',
                          cursor: 'pointer',
                        }}
                      >
                        + Join {t.name}
                      </button>
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: 0, textAlign: 'center', ...mutedStyle }}>
                {unassignedPlayers.length} player{unassignedPlayers.length === 1 ? '' : 's'} still need a team
              </p>
            </div>
          )}

          {!isHost && !iNeedToPick && singleTeamMode && (
            <div
              style={{
                borderRadius: 26,
                padding: '20px 16px',
                background: 'radial-gradient(120% 100% at 50% 0%, rgba(255,209,102,.16), rgba(255,209,102,.03) 70%)',
                border: '1.5px solid rgba(255,209,102,.4)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
                PLAYING TOGETHER
              </span>
              <span style={{ font: '700 24px/1.3 var(--font-display)', color: 'var(--text)', textAlign: 'center' }}>
                Everyone's on one team
              </span>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
                {players.map((p) => {
                  const isMe = p.id === myPlayerId
                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span
                        data-avatar-id={p.id}
                        style={{
                          ...avatarChipStyle(58),
                          background: 'rgba(255,255,255,.08)',
                          boxShadow: isMe ? '0 0 0 3px #120F2E, 0 0 0 5px var(--gold)' : 'none',
                        }}
                      >
                        {p.avatar}
                      </span>
                      <span style={{ font: '600 13px var(--font-body)', color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>
                        {isMe ? 'You' : p.display_name}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isHost && !iNeedToPick && !singleTeamMode && myTeam && (
            <div
              style={{
                borderRadius: 26,
                padding: '20px 16px',
                background: `radial-gradient(120% 100% at 50% 0%, ${rgba(teamColor.get(myTeam.id)!, 0.3)}, ${rgba(teamColor.get(myTeam.id)!, 0.05)} 70%)`,
                border: `1.5px solid ${rgba(teamColor.get(myTeam.id)!, 0.5)}`,
                boxShadow: `0 0 30px ${rgba(teamColor.get(myTeam.id)!, 0.18)}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
                YOU'RE ON
              </span>
              <span style={{ font: '700 36px/1 var(--font-display)', color: 'var(--text)' }}>{myTeam.name}</span>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
                {(playersByTeam.get(myTeam.id) ?? []).map((p) => {
                  const isMe = p.id === myPlayerId
                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span
                        data-avatar-id={p.id}
                        style={{
                          ...avatarChipStyle(58),
                          background: rgba(teamColor.get(myTeam.id)!, 0.25),
                          boxShadow: isMe ? '0 0 0 3px #120F2E, 0 0 0 5px #fff' : 'none',
                        }}
                      >
                        {p.avatar}
                      </span>
                      <span style={{ font: '600 13px var(--font-body)', color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>
                        {isMe ? 'You' : p.display_name}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isHost && !iNeedToPick && !singleTeamMode && !myTeam && (
            <div style={cardStyle}>
              <span style={{ ...labelStyle, whiteSpace: 'nowrap' }}>
                Players joined <span style={{ ...mutedStyle, fontWeight: 400 }}>&middot; {players.length}</span>
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {players.map((p) => {
                  const isMe = p.id === myPlayerId
                  return (
                    <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span
                        data-avatar-id={p.id}
                        style={{
                          ...avatarChipStyle(52),
                          background: 'rgba(255,255,255,.08)',
                          boxShadow: isMe ? '0 0 0 3px #120F2E, 0 0 0 5px var(--gold)' : 'none',
                        }}
                      >
                        {p.avatar}
                      </span>
                      <span style={{ font: '600 13px var(--font-body)', color: isMe ? 'var(--text)' : 'var(--text-muted)' }}>
                        {isMe ? 'You' : p.display_name}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Only alongside YOUR OWN team card — showing "other teams" while
              you're still unassigned looked like a second, contradictory
              state (a stray team card next to the "still joining" list). */}
          {!isHost && !iNeedToPick && !singleTeamMode && myTeam && otherTeams.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {otherTeams.map((t) => {
                const color = teamColor.get(t.id)!
                const members = playersByTeam.get(t.id) ?? []
                return (
                  <div
                    key={t.id}
                    style={{
                      ...cardStyle,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ font: '700 14px var(--font-body)', color }}>{t.name}</span>
                    <div style={{ display: 'flex' }}>
                      {members.map((p, i) => (
                        <span
                          key={p.id}
                          data-avatar-id={p.id}
                          style={{
                            ...avatarChipStyle(34),
                            background: rgba(color, 0.25),
                            border: '2px solid #1C1642',
                            marginLeft: i === 0 ? 0 : -8,
                          }}
                        >
                          {p.avatar}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!isHost && !iNeedToPick && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                <span style={pillStyle}>
                  {numTeams} team{numTeams === 1 ? '' : 's'}
                </span>
                <span style={pillStyle}>
                  {rounds} round{rounds === 1 ? '' : 's'}
                </span>
                <span style={pillStyle}>{attachedPacks.length} pack{attachedPacks.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ display: 'flex', gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)' }} />
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', opacity: 0.6 }} />
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', opacity: 0.3 }} />
                </span>
                <span style={{ font: '500 16px var(--font-body)', color: 'var(--text-muted)' }}>Waiting for the host to start</span>
              </div>
            </>
          )}

          {isHost && (
            <div style={cardStyle}>
              <div style={stepperRowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={labelStyle}>Number of teams</span>
                  <span style={mutedStyle}>Needs at least 2 players per team</span>
                </div>
                <div style={stepperControlsStyle}>
                  <button
                    type="button"
                    style={{ ...stepperButtonStyle, opacity: numTeams <= 1 ? 0.4 : 1, cursor: numTeams <= 1 ? 'not-allowed' : 'pointer' }}
                    onClick={() => changeNumTeams(numTeams - 1)}
                    disabled={numTeams <= 1}
                    aria-label="Decrease number of teams"
                  >
                    &minus;
                  </button>
                  <span style={stepperValueStyle}>{numTeams}</span>
                  <button
                    type="button"
                    style={{ ...stepperButtonStyle, opacity: numTeams >= maxTeams ? 0.4 : 1, cursor: numTeams >= maxTeams ? 'not-allowed' : 'pointer' }}
                    onClick={() => changeNumTeams(numTeams + 1)}
                    disabled={numTeams >= maxTeams}
                    aria-label="Increase number of teams"
                  >
                    +
                  </button>
                </div>
              </div>
              <div style={stepperRowStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={labelStyle}>Rounds</span>
                  <span style={mutedStyle}>Times each player is psychic</span>
                </div>
                <div style={stepperControlsStyle}>
                  <button type="button" style={stepperButtonStyle} onClick={() => changeRounds(rounds - 1)} aria-label="Decrease rounds">
                    &minus;
                  </button>
                  <span style={stepperValueStyle}>{rounds}</span>
                  <button type="button" style={stepperButtonStyle} onClick={() => changeRounds(rounds + 1)} aria-label="Increase rounds">
                    +
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !packsExpanded
                  setPacksExpanded(next)
                  if (next) void loadMyPacks()
                }}
                style={{
                  ...stepperRowStyle,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={labelStyle}>Packs</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={mutedStyle}>
                    {attachedPacks.length}/
                    {new Set([...attachedPacks.map((p) => p.id), ...myPacks.map((p) => p.id)]).size} packs selected
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 18, transform: packsExpanded ? 'rotate(90deg)' : 'none' }}>›</span>
                </span>
              </button>

              {packsExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 2 }}>
                  {packError && (
                    <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                      {packError}
                    </span>
                  )}
                  {attachedPacks.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ font: '600 14px var(--font-body)', color: 'var(--text)' }}>
                        {p.name} <span style={{ ...mutedStyle, fontWeight: 400 }}>&middot; {packSpectrumCounts[p.id] ?? 0} cards</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => requestRemovePack(p)}
                        disabled={packBusy}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--comets)',
                          font: '600 13px var(--font-body)',
                          cursor: packBusy ? 'not-allowed' : 'pointer',
                          padding: '4px 6px',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {myPacks.filter((p) => !attachedPacks.some((a) => a.id === p.id)).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                      <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
                        YOUR PACKS
                      </span>
                      {myPacks
                        .filter((p) => !attachedPacks.some((a) => a.id === p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addPackByCode(p.share_code)}
                            disabled={packBusy}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              height: 40,
                              padding: '0 12px',
                              borderRadius: 12,
                              background: 'rgba(255,255,255,.05)',
                              border: '1px solid rgba(200,180,255,.14)',
                              color: 'var(--text)',
                              font: '500 14px var(--font-body)',
                              cursor: packBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {p.name}
                            <span style={{ color: 'var(--gold)', fontWeight: 700 }}>+ Add</span>
                          </button>
                        ))}
                    </div>
                  )}

                </div>
              )}

              <div style={stepperRowStyle}>
                <span style={labelStyle}>Noises</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={noisesEnabled}
                  aria-label="Toggle noises"
                  style={switchTrackStyle(noisesEnabled)}
                  onClick={toggleNoises}
                >
                  <span style={switchDotStyle(noisesEnabled)} />
                </button>
              </div>
            </div>
          )}

          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 'auto' }}>
              {startError && (
                <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
                  {startError}
                </span>
              )}
              {!forcedSingleTeam && teamMode === 'random' && teams.length === 0 ? (
                <Btn
                  kind="primary"
                  size="lg"
                  label={shuffling ? 'Shuffling…' : 'Shuffle teams'}
                  onClick={shuffleAndReveal}
                  disabled={shuffling || players.length === 0}
                />
              ) : (
                <>
                  <Btn kind="primary" size="lg" label={starting ? 'Starting…' : 'Start game'} onClick={handleStartGame} disabled={startDisabled} />
                  {!allTeamsAssigned && players.length >= 2 && (
                    <p style={{ margin: 0, textAlign: 'center', ...mutedStyle }}>
                      {unassignedPlayers.length === 1 ? '1 player still needs a team' : `${unassignedPlayers.length} players still need a team`}
                      {' — '}
                      {teamMode === 'random' ? 'reshuffle' : 'assign them'} to start
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {rematchError && (
            <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14, textAlign: 'center' }}>
              {rematchError}
            </span>
          )}
        </div>
      </div>

      {removePackConfirm && (
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
          onClick={() => setRemovePackConfirm(null)}
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
              <span style={{ font: '700 18px var(--font-display)', color: 'var(--text)' }}>Remove {removePackConfirm.name}?</span>
              <span style={{ font: '400 14px var(--font-body)', color: 'var(--text-muted)' }}>
                You'll have {removePackConfirm.remaining} card{removePackConfirm.remaining === 1 ? '' : 's'} left in the remaining packs.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Btn kind="secondary" size="md" label="Cancel" onClick={() => setRemovePackConfirm(null)} disabled={packBusy} />
              </div>
              <div style={{ flex: 1 }}>
                <Btn kind="primary" size="md" label={packBusy ? 'Removing…' : 'Remove'} onClick={confirmRemovePack} disabled={packBusy} />
              </div>
            </div>
          </div>
        </div>
      )}

      <ShuffleReveal
        open={revealOpen}
        shuffleRequestId={shuffleRequestId}
        players={players}
        startRects={startRects}
        numTeamsPredicted={Math.min(numTeams, maxTeams)}
        teams={teams}
        playersByTeam={playersByTeam}
        myPlayerId={myPlayerId}
        myTeamId={myTeamId}
        canAct={isHost}
        skipAnimation={forcedSingleTeam}
        resultsReady={revealReadyFor === shuffleRequestId}
        onStartGame={handleStartGame}
        onReshuffle={reshuffle}
        onDismiss={() => setRevealOpen(false)}
        starting={starting}
        shuffling={shuffling}
        startError={startError}
      />
    </div>
  )
}
