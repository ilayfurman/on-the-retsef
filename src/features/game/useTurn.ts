import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export type Turn = {
  id: string
  party_id: string
  round_number: number
  team_id: string
  psychic_player_id: string
  spectrum_id: string
  target_position: number | null
  clue_text: string | null
  guess_position: number | null
  status: 'clue' | 'guessing' | 'betting' | 'revealed'
  spectrum_rerolled: boolean
}

// `turns` deliberately has no SELECT RLS policy on the base table — that's
// what makes turns_view's column redaction (hiding target_position from
// non-psychic players) actually secure. But Supabase Realtime authorizes
// postgres_changes against the base table's RLS, not the view, so it can
// never deliver change events here — and even if it could, the raw payload
// would include the hidden target_position for every subscriber, which is
// exactly what turns_view exists to prevent. So this polls the safe view
// instead of subscribing to postgres_changes. 600ms is tight enough to feel
// close to instant for people playing in the same room, without the
// complexity of a proper broadcast-from-database setup.
const POLL_INTERVAL_MS = 600

export function useTurn(turnId: string) {
  const [turn, setTurn] = useState<Turn | null>(null)

  async function reload() {
    const { data } = await supabase.from('turns_view').select('*').eq('id', turnId).single()
    setTurn(data as Turn)
  }

  useEffect(() => {
    reload()
    const interval = setInterval(reload, POLL_INTERVAL_MS)
    return () => {
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId])

  return turn
}
