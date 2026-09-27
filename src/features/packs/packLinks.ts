import { supabase } from '../../lib/supabaseClient'

/** The pack share code in the URL (#/pack/CODE), if any. */
export function readPackHash(): string | null {
  const m = window.location.hash.match(/^#\/pack\/([A-Z0-9]{4,12})$/i)
  return m ? m[1].toUpperCase() : null
}

export function packLink(shareCode: string) {
  return `${window.location.origin}${window.location.pathname}#/pack/${shareCode}`
}

/** Phone share sheet when there is one (WhatsApp, Messages…), else copies the
 * link. Resolves to what happened so the button can say so. */
export async function sharePack(shareCode: string, name: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = packLink(shareCode)
  const text = `Here's my "${name}" pack for On the Retsef — tap to add your own copy:`
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: name, text, url })
      return 'shared'
    } catch (err) {
      // Closing the share sheet isn't a failure worth falling back from.
      if ((err as Error)?.name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export type PackPreview = { name: string; card_count: number; is_mine: boolean; my_copy_id: string | null }

/** null = no pack with that code (deleted, or a bad link). */
export async function fetchPackPreview(shareCode: string): Promise<PackPreview | null> {
  const { data, error } = await supabase.rpc('pack_preview', { p_share_code: shareCode })
  if (error) throw error
  return ((data as PackPreview[] | null) ?? [])[0] ?? null
}

/** Copies the pack into the signed-in account; returns the new pack's id. */
export async function copyPack(shareCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('copy_pack', { p_share_code: shareCode }).single()
  if (error) throw error
  return (data as { id: string }).id
}
