import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Starfield } from '../../components/Starfield'
import { Btn } from '../../components/Btn'
import { errorMessage } from '../../lib/errorMessage'

type Pack = { id: string; name: string; share_code: string; card_count?: number }

// Long-press (touch and hold, or click-and-hold on desktop) opens the
// delete confirmation — short enough to not feel sluggish, long enough that
// a normal tap-to-open never fires it by accident.
const LONG_PRESS_MS = 550

const codePillStyle = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(8,6,24,.6)',
  border: '1px solid rgba(200,180,255,.14)',
  font: '700 13px/1 var(--font-mono)',
  letterSpacing: '.12em',
  color: 'var(--gold)',
}

export function PacksList({
  onOpenPack,
  onBack,
}: {
  onOpenPack: (packId: string) => void
  onBack?: () => void
}) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [starterCount, setStarterCount] = useState<number | null>(null)
  const [addCode, setAddCode] = useState('')
  const [newName, setNewName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)

  async function loadPacks() {
    const userId = (await supabase.auth.getUser()).data.user?.id
    const [{ data }, { data: starterRows }] = await Promise.all([
      supabase.from('packs').select('id, name, share_code, spectrums(count)').eq('owner_id', userId),
      supabase.from('packs').select('spectrums(count)').eq('share_code', 'STARTER'),
    ])
    setPacks(
      ((data as (Pack & { spectrums?: { count: number }[] })[]) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        share_code: p.share_code,
        card_count: p.spectrums?.[0]?.count ?? 0,
      }))
    )
    setStarterCount((starterRows as { spectrums?: { count: number }[] }[] | null)?.[0]?.spectrums?.[0]?.count ?? 0)
  }

  useEffect(() => {
    loadPacks()
  }, [])

  async function createPack() {
    const { data } = await supabase.rpc('create_pack', { p_name: newName.trim() || 'New pack' }).single()
    setNewName('')
    await loadPacks()
    if (data) onOpenPack((data as Pack).id)
  }

  function startLongPress(p: Pack) {
    longPressFiredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      setDeleteConfirm({ id: p.id, name: p.name })
    }, LONG_PRESS_MS)
  }

  function cancelLongPress() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
  }

  // A long press already opened the confirm dialog — the click that follows
  // releasing the press must not also navigate into the pack.
  function handlePackClick(p: Pack) {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return
    }
    onOpenPack(p.id)
  }

  async function confirmDeletePack() {
    if (!deleteConfirm) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const { error } = await supabase.rpc('delete_pack', { p_pack_id: deleteConfirm.id })
      if (error) throw error
      setDeleteConfirm(null)
      await loadPacks()
    } catch (err) {
      setDeleteError(errorMessage(err, 'Could not delete this pack. Try again.'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back"
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
          <span style={{ font: '700 26px/1 var(--font-body)', color: 'var(--text)' }}>My packs</span>
        </div>

        <div
          style={{
            borderRadius: 22,
            padding: 16,
            background: 'linear-gradient(135deg, rgba(255,209,102,.2), rgba(255,111,163,.12) 55%, rgba(140,107,255,.16))',
            border: '1px solid rgba(255,209,102,.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ font: '700 18px/1 var(--font-body)', color: 'var(--text)' }}>Starter deck</span>
            <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--text-muted)' }}>
              {starterCount ?? '…'} cards · always included
            </span>
          </div>
          <span
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              background: 'rgba(255,209,102,.16)',
              font: '600 11px/1 var(--font-body)',
              letterSpacing: '.1em',
              color: 'var(--gold)',
            }}
          >
            BUILT-IN
          </span>
        </div>

        {packs.length > 0 && (
          <span style={{ font: '400 12px/1 var(--font-body)', color: 'var(--text-subtle)', padding: '0 4px' }}>
            Press and hold a pack to delete it
          </span>
        )}
        {packs.map((p) => (
          <button
            key={p.id}
            onClick={() => handlePackClick(p)}
            onPointerDown={() => startLongPress(p)}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              borderRadius: 22,
              padding: '14px 16px',
              background: 'linear-gradient(180deg, rgba(52,40,110,.55), rgba(24,18,56,.6))',
              border: '1px solid rgba(200,180,255,.12)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <span style={{ font: '600 17px/1 var(--font-body)', color: 'var(--text)' }}>{p.name}</span>
              <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--text-muted)' }}>
                {p.card_count ?? 0} cards
              </span>
            </div>
            <span style={codePillStyle}>{p.share_code}</span>
            <span style={{ font: '500 20px/1 var(--font-body)', color: 'var(--text-muted)' }}>›</span>
          </button>
        ))}

        <div
          style={{
            borderRadius: 22,
            padding: 14,
            background: 'rgba(255,255,255,.03)',
            border: '1px dashed rgba(200,180,255,.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.16em', color: 'var(--text-muted)' }}>
            ADD A FRIEND'S PACK
          </span>
          <p style={{ margin: 0, font: '400 13px/1.4 var(--font-body)', color: 'var(--text-muted)' }}>
            Coming soon — for now, a host can attach a friend's pack by code from the lobby.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={addCode}
              onChange={(e) => setAddCode(e.target.value.toUpperCase())}
              placeholder="Share code"
              aria-label="Share code"
              disabled
              style={{
                flex: 1,
                minWidth: 0,
                height: 50,
                borderRadius: 999,
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                padding: '0 18px',
                color: 'var(--text)',
                font: '600 16px/1 var(--font-mono)',
                letterSpacing: '.14em',
                outline: 'none',
                textTransform: 'uppercase',
                boxSizing: 'border-box',
                opacity: 0.5,
              }}
            />
            <div style={{ width: 84 }}>
              <Btn kind="accent" size="sm" label="Add" disabled />
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="new-pack-name" style={{ font: '400 12px/1 var(--font-body)', color: 'var(--text-muted)', paddingLeft: 6 }}>
            New pack name
          </label>
          <input
            id="new-pack-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Food Fights"
            style={{
              height: 50,
              borderRadius: 999,
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              padding: '0 18px',
              color: 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <Btn kind="primary" size="lg" label="Create pack" onClick={createPack} />
        {deleteError && (
          <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
            {deleteError}
          </span>
        )}
      </div>

      {deleteConfirm && (
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
          onClick={() => setDeleteConfirm(null)}
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
              <span style={{ font: '700 18px var(--font-display)', color: 'var(--text)' }}>Delete {deleteConfirm.name}?</span>
              <span style={{ font: '400 14px var(--font-body)', color: 'var(--text-muted)' }}>
                This deletes the whole pack and all its cards. This can't be undone.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Btn kind="secondary" size="md" label="Cancel" onClick={() => setDeleteConfirm(null)} disabled={deleteBusy} />
              </div>
              <div style={{ flex: 1 }}>
                <Btn kind="primary" size="md" label={deleteBusy ? 'Deleting…' : 'Delete'} onClick={confirmDeletePack} disabled={deleteBusy} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
