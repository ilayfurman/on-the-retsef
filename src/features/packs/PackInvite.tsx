import { useEffect, useState } from 'react'
import { Starfield } from '../../components/Starfield'
import { Logo } from '../../components/Logo'
import { Btn } from '../../components/Btn'
import { errorMessage } from '../../lib/errorMessage'
import { copyPack, fetchPackPreview, type PackPreview } from './packLinks'

/**
 * Where a pack share link (#/pack/CODE) lands once signed in: shows what the
 * pack is and adds a copy to your packs on one tap — never silently, so an
 * accidental tap or a link preview can't dump packs into someone's account.
 */
export function PackInvite({
  shareCode,
  onOpenPack,
  onDone,
}: {
  shareCode: string
  /** Opens a pack in the editor (the new copy, or one you already have). */
  onOpenPack: (packId: string) => void
  /** Leaves without adding anything. */
  onDone: () => void
}) {
  const [preview, setPreview] = useState<PackPreview | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPackPreview(shareCode)
      .then(setPreview)
      .catch((err) => {
        setPreview(null)
        setError(errorMessage(err, 'Could not load this pack.'))
      })
  }, [shareCode])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      onOpenPack(await copyPack(shareCode))
    } catch (err) {
      setError(errorMessage(err, 'Could not add this pack. Try again.'))
      setBusy(false)
    }
  }

  const card = preview && (
    <div
      style={{
        width: '100%',
        borderRadius: 24,
        padding: '22px 18px',
        background: 'linear-gradient(180deg, rgba(52,40,110,.6), rgba(24,18,56,.65))',
        border: '1px solid rgba(255,209,102,.35)',
        boxShadow: '0 0 40px rgba(255,209,102,.12)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: 34 }} aria-hidden>
        🃏
      </span>
      <span style={{ font: '700 24px/1.15 var(--font-display)', color: 'var(--text)', textAlign: 'center', overflowWrap: 'anywhere' }}>{preview.name}</span>
      <span style={{ font: '500 14px var(--font-body)', color: 'var(--text-muted)' }}>
        {preview.card_count} card{preview.card_count === 1 ? '' : 's'}
      </span>
    </div>
  )

  let body
  if (preview === undefined) {
    body = <p style={{ margin: 0, font: '500 15px var(--font-body)', color: 'var(--text-muted)' }}>Loading pack…</p>
  } else if (preview === null) {
    body = (
      <>
        <h1 style={titleStyle}>Pack not found</h1>
        <p style={textStyle}>This pack link doesn&rsquo;t work anymore &mdash; the pack may have been deleted. Ask your friend to share it again.</p>
        <div style={{ width: '100%' }}>
          <Btn kind="primary" size="lg" label="Go to home" onClick={onDone} />
        </div>
      </>
    )
  } else if (preview.is_mine) {
    body = (
      <>
        <h1 style={titleStyle}>This is your pack</h1>
        {card}
        <p style={textStyle}>This is the link you share with friends &mdash; they each get their own copy.</p>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn kind="primary" size="lg" label="Go to home" onClick={onDone} />
        </div>
      </>
    )
  } else if (preview.my_copy_id) {
    const copyId = preview.my_copy_id
    body = (
      <>
        <h1 style={titleStyle}>You already have this pack</h1>
        {card}
        <p style={textStyle}>You added it before. Open your copy, or add a fresh one (handy if you&rsquo;ve changed yours).</p>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn kind="primary" size="lg" label="Open my copy" onClick={() => onOpenPack(copyId)} />
          <Btn kind="secondary" size="md" label={busy ? 'Adding…' : 'Add another copy'} onClick={add} disabled={busy} />
          <Btn kind="ghost" size="sm" label="Not now" onClick={onDone} />
        </div>
      </>
    )
  } else {
    body = (
      <>
        <h1 style={titleStyle}>A pack for you!</h1>
        {card}
        <p style={textStyle}>Add it and it&rsquo;s yours &mdash; your own copy to play, trim or add to.</p>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn kind="primary" size="lg" label={busy ? 'Adding…' : 'Add to my packs'} onClick={add} disabled={busy} />
          <Btn kind="ghost" size="sm" label="Not now" onClick={onDone} />
        </div>
      </>
    )
  }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Starfield />
      <div
        style={{
          position: 'relative',
          minHeight: '100dvh',
          maxWidth: 480,
          margin: '0 auto',
          padding: '28px 20px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <Logo variant="inline" size="sm" />
        {body}
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--comets)', font: '500 14px var(--font-body)', textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

const titleStyle = { margin: '6px 0 0', font: '700 28px/1.15 var(--font-display)', color: 'var(--text)', textAlign: 'center' } as const
const textStyle = { margin: 0, font: '400 15px/1.45 var(--font-body)', color: 'var(--text-muted)', textAlign: 'center', maxWidth: 340 } as const
