import { supabase } from '../../lib/supabaseClient'

export type RoomStatus = 'open' | 'playing' | 'finished' | 'missing'

/** Whether an invite's room can be joined right now. Works signed out.
 * null = couldn't check (network etc.) — callers let the join go ahead and
 * fail normally rather than block on it. */
export async function checkRoom(roomCode: string): Promise<RoomStatus | null> {
  try {
    const { data, error } = await supabase.rpc('room_status', { p_room_code: roomCode })
    if (error) return null
    return (data as RoomStatus | null) ?? 'missing'
  } catch {
    return null
  }
}

/** Why a room can't be joined, in words — or null when it can. */
export function roomProblem(roomCode: string, status: RoomStatus | null): string | null {
  if (status === 'missing') return `There's no room ${roomCode}. Double-check the link with whoever sent it.`
  if (status === 'playing') return `The game in room ${roomCode} already started. You can join once they're back in the lobby.`
  if (status === 'finished') return `The party in room ${roomCode} has ended. Ask for a fresh link!`
  return null
}

/** The invite in the URL (#/join/CODE), if any. A malformed code (wrong
 * length, stray characters) still counts, so it can be called out rather
 * than silently ignored. */
export function readInviteHash(): { code: string; valid: boolean } | null {
  const m = window.location.hash.match(/^#\/join\/?(.*)$/i)
  if (!m) return null
  let code = m[1]
  try {
    code = decodeURIComponent(code)
  } catch {
    // leave as-is
  }
  code = code.trim().toUpperCase()
  return { code, valid: /^[A-Z]{4}$/.test(code) }
}

/** For a code that can't be a room at all — worded for a typed code or a link alike. */
export function invalidCodeMessage(code: string) {
  const shown = code ? `"${code.length > 12 ? `${code.slice(0, 12)}…` : code}"` : 'That'
  return `${shown} isn't a valid room code — codes are 4 letters. Double-check the link or code with whoever invited you.`
}
