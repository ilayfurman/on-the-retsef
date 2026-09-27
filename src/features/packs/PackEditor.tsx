import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Starfield } from '../../components/Starfield'
import { Btn } from '../../components/Btn'
import { parsePasteLines } from './pasteImport'
import { AiPromptSheet } from './AiPromptSheet'
import { sharePack } from './packLinks'
import { errorMessage } from '../../lib/errorMessage'

type Pack = { id: string; name: string; share_code: string }
type Spectrum = { id: string; left_label: string; right_label: string }
type Mode = 'one' | 'paste' | 'replace'

// How far a spectrum row slides left to reveal the delete button underneath.
const SWIPE_REVEAL_PX = 76

const inputStyle = {
  minWidth: 0,
  height: 50,
  borderRadius: 999,
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  padding: '0 16px',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 16,
  outline: 'none',
  boxSizing: 'border-box' as const,
}

const cardStyle = {
  borderRadius: 22,
  padding: 14,
  background: 'linear-gradient(180deg, rgba(52,40,110,.55), rgba(24,18,56,.6))',
  border: '1px solid rgba(200,180,255,.12)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 10,
  boxSizing: 'border-box' as const,
}

const rowTagStyle: Record<'ok' | 'needs-format' | 'duplicate', { color: string; text: string }> = {
  ok: { color: 'var(--novas, #5BD6FF)', text: 'Ready' },
  'needs-format': { color: 'var(--comets, #FF6FA3)', text: 'Needs Left | Right' },
  duplicate: { color: 'var(--text-muted)', text: 'Already in pack' },
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    height: 38,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    background: active ? '#F3ECDD' : 'transparent',
    color: active ? '#1A1233' : 'var(--text-muted)',
    font: '600 14px/1 var(--font-body)',
    cursor: 'pointer',
    border: 'none',
  }
}

export function PackEditor({ packId, onBack }: { packId: string; onBack?: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null)
  const [spectrums, setSpectrums] = useState<Spectrum[]>([])
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [mode, setMode] = useState<Mode>('one')
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [showAiSheet, setShowAiSheet] = useState(false)
  const [replaceText, setReplaceText] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaceResult, setReplaceResult] = useState<{ removed: number; added: number; skipped: number } | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<'copied' | null>(null)
  // Tap the name to edit it; saves on Enter or when leaving the field.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  async function saveName() {
    if (renaming === null || !pack) return
    const name = renaming.trim()
    setRenaming(null)
    if (!name || name === pack.name) return
    const previous = pack.name
    setPack({ ...pack, name })
    setRenameError(null)
    const { error } = await supabase.rpc('rename_pack', { p_pack_id: pack.id, p_name: name })
    if (error) {
      setPack((p) => (p ? { ...p, name: previous } : p))
      setRenameError(errorMessage(error, 'Could not rename this pack. Try again.'))
    }
  }
  const [deletePackConfirm, setDeletePackConfirm] = useState(false)
  const [deletingPack, setDeletingPack] = useState(false)
  const [deletePackError, setDeletePackError] = useState<string | null>(null)
  const [spectrumError, setSpectrumError] = useState<string | null>(null)
  // Which row is fully open (revealing its delete button) once a swipe past
  // the threshold finishes, vs. the row currently being actively dragged —
  // kept separate so mid-drag movement can track the pointer 1:1 (no
  // transition) while a completed swipe snaps open/closed smoothly.
  const [openSpectrumId, setOpenSpectrumId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [liveOffset, setLiveOffset] = useState(0)
  const dragStartXRef = useRef(0)
  // Whether the current press moved enough to be a swipe rather than a tap.
  const movedRef = useRef(false)

  async function load() {
    const [{ data: packRows }, { data }] = await Promise.all([
      supabase.from('packs').select('id, name, share_code').eq('id', packId),
      supabase.from('spectrums').select('id, left_label, right_label').eq('pack_id', packId),
    ])
    setPack((packRows as Pack[])?.[0] ?? null)
    // spectrums has no created_at column; reverse the natural insertion order
    // (Postgres returns rows roughly in that order) to approximate "newest first".
    setSpectrums(((data as Spectrum[]) ?? []).slice().reverse())
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])

  async function addSpectrum() {
    await supabase.rpc('add_spectrum', { p_pack_id: packId, p_left_label: left, p_right_label: right })
    setLeft('')
    setRight('')
    await load()
  }

  // Tapping a card opens it in the "Add one" form, filled in, to edit.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const leftInputRef = useRef<HTMLInputElement>(null)

  function startEdit(sp: Spectrum) {
    setMode('one')
    setEditingId(sp.id)
    setLeft(sp.left_label)
    setRight(sp.right_label)
    setSpectrumError(null)
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      leftInputRef.current?.focus({ preventScroll: true })
    })
  }

  // Switching to "Paste a list"/"Full replace" drops an edit in progress.
  useEffect(() => {
    if (mode !== 'one' && editingId) cancelEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function cancelEdit() {
    setEditingId(null)
    setLeft('')
    setRight('')
  }

  async function saveEdit() {
    if (!editingId) return
    setSavingEdit(true)
    setSpectrumError(null)
    try {
      const { error } = await supabase.rpc('update_spectrum', { p_spectrum_id: editingId, p_left_label: left.trim(), p_right_label: right.trim() })
      if (error) throw error
      cancelEdit()
      await load()
    } catch (err) {
      setSpectrumError(errorMessage(err, 'Could not save this card. Try again.'))
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteSpectrum(id: string) {
    setOpenSpectrumId(null)
    if (id === editingId) cancelEdit()
    setSpectrumError(null)
    try {
      const { error } = await supabase.rpc('delete_spectrum', { p_spectrum_id: id })
      if (error) throw error
      await load()
    } catch (err) {
      setSpectrumError(errorMessage(err, 'Could not delete this card. Try again.'))
    }
  }

  async function confirmDeletePack() {
    setDeletingPack(true)
    setDeletePackError(null)
    try {
      const { error } = await supabase.rpc('delete_pack', { p_pack_id: packId })
      if (error) throw error
      onBack?.()
    } catch (err) {
      setDeletePackError(errorMessage(err, 'Could not delete this pack. Try again.'))
      setDeletePackConfirm(false)
    } finally {
      setDeletingPack(false)
    }
  }

  function handleRowPointerDown(id: string, e: ReactPointerEvent<HTMLDivElement>) {
    dragStartXRef.current = e.clientX
    movedRef.current = false
    setDraggingId(id)
    setLiveOffset(openSpectrumId === id ? -SWIPE_REVEAL_PX : 0)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handleRowPointerMove(id: string, e: ReactPointerEvent<HTMLDivElement>) {
    if (draggingId !== id) return
    const base = openSpectrumId === id ? -SWIPE_REVEAL_PX : 0
    const delta = e.clientX - dragStartXRef.current
    if (Math.abs(delta) > 6) movedRef.current = true
    setLiveOffset(Math.max(-SWIPE_REVEAL_PX, Math.min(0, base + delta)))
  }

  function handleRowPointerUp(id: string, tap = true) {
    if (draggingId !== id) return
    setDraggingId(null)
    // A tap (no drag) edits the card — or just closes it if it was swiped open.
    if (tap && !movedRef.current) {
      const wasOpen = openSpectrumId === id
      setOpenSpectrumId(null)
      const sp = spectrums.find((x) => x.id === id)
      if (!wasOpen && sp) startEdit(sp)
      return
    }
    setOpenSpectrumId(liveOffset <= -SWIPE_REVEAL_PX / 2 ? id : null)
  }

  const parsed = useMemo(
    () =>
      parsePasteLines(
        pasteText,
        spectrums.map((s) => ({ left_label: s.left_label, right_label: s.right_label }))
      ),
    [pasteText, spectrums]
  )

  async function importPasted() {
    setImporting(true)
    try {
      const remainingLines: string[] = []
      let validIndex = 0
      for (const r of parsed.results) {
        if (r.status !== 'ok') {
          // Keep lines that were never imported (bad format / duplicate) so the
          // user can see and fix them instead of losing them silently.
          remainingLines.push(r.line)
          continue
        }
        const pair = parsed.valid[validIndex]
        validIndex += 1
        const { error } = await supabase.rpc('add_spectrum', {
          p_pack_id: packId,
          p_left_label: pair.left,
          p_right_label: pair.right,
        })
        if (error) {
          // Failed to import (e.g. network/RPC error) — keep the line so it isn't lost.
          remainingLines.push(r.line)
        }
      }
      setPasteText(remainingLines.join('\n'))
      await load()
    } finally {
      setImporting(false)
    }
  }

  const pasteCta = parsed.valid.length > 0 ? `Add ${parsed.valid.length} spectrums` : 'Add spectrums'

  // Same "Left | Right" format the paste-import expects, so a round trip
  // (export → edit with an AI → paste back for a full replace) just works.
  const exportText = useMemo(() => spectrums.map((s) => `${s.left_label} | ${s.right_label}`).join('\n'), [spectrums])

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied by the browser; the list is already
      // visible/selectable in the export view so the user can copy manually.
    }
  }

  // Empty `existing` here (not `spectrums`) — a full replace treats every
  // valid line as wanted, including ones that happen to already be in the
  // pack; only dedupes against itself within the pasted text.
  const parsedReplace = useMemo(() => parsePasteLines(replaceText, []), [replaceText])

  async function runReplace() {
    setReplacing(true)
    setReplaceError(null)
    setReplaceResult(null)
    try {
      const { data, error } = await supabase
        .rpc('replace_pack_spectrums', {
          p_pack_id: packId,
          p_pairs: parsedReplace.valid.map((v) => ({ left: v.left, right: v.right })),
        })
        .single()
      if (error) throw error
      const result = data as { removed: number; added: number; skipped_in_use: number }
      setReplaceResult({ removed: result.removed, added: result.added, skipped: result.skipped_in_use })
      await load()
    } catch (err) {
      setReplaceError(errorMessage(err, 'Could not replace the list. Try again.'))
    } finally {
      setReplacing(false)
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
          {renaming !== null ? (
            <input
              autoFocus
              aria-label="Pack name"
              value={renaming}
              maxLength={40}
              onChange={(e) => setRenaming(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
              style={{
                flex: 1,
                minWidth: 0,
                height: 42,
                borderRadius: 14,
                background: 'var(--input-bg)',
                border: '1px solid rgba(255,209,102,.5)',
                padding: '0 12px',
                color: 'var(--text)',
                font: '700 20px/1 var(--font-body)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <button
              onClick={() => pack && setRenaming(pack.name)}
              aria-label="Rename pack"
              disabled={!pack}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: pack ? 'pointer' : 'default',
                textAlign: 'left',
              }}
            >
              <span style={{ font: '700 24px/1.1 var(--font-body)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pack?.name ?? 'Pack editor'}
              </span>
              {pack && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              )}
            </button>
          )}
          {pack?.share_code && (
            <button
              onClick={async () => {
                const result = await sharePack(pack.share_code, pack.name)
                setShareState(result === 'copied' ? 'copied' : null)
                if (result === 'copied') setTimeout(() => setShareState(null), 2200)
              }}
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 999,
                background: 'rgba(255,209,102,.12)',
                border: '1px solid rgba(255,209,102,.4)',
                font: '700 14px/1 var(--font-body)',
                color: 'var(--gold)',
                cursor: 'pointer',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12M7 8l5-5 5 5" />
                <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              {shareState === 'copied' ? 'Link copied!' : 'Share'}
            </button>
          )}
        </div>
        {renameError && (
          <p role="alert" style={{ margin: 0, color: 'var(--comets)', font: '500 13px var(--font-body)' }}>
            {renameError}
          </p>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            padding: 4,
            borderRadius: 999,
            background: 'rgba(8,6,24,.6)',
            border: '1px solid rgba(200,180,255,.12)',
          }}
        >
          <button style={segStyle(mode === 'one')} onClick={() => setMode('one')}>
            One at a time
          </button>
          <button style={segStyle(mode === 'paste')} onClick={() => setMode('paste')}>
            Paste a list
          </button>
          <button
            style={segStyle(mode === 'replace')}
            onClick={() => {
              setMode('replace')
              setReplaceText(exportText)
              setReplaceResult(null)
              setReplaceError(null)
            }}
          >
            Full replace
          </button>
        </div>

        {mode === 'one' && (
          <div ref={formRef} style={editingId ? { ...cardStyle, border: '1px solid rgba(255,209,102,.45)', boxShadow: '0 0 24px rgba(255,209,102,.12)' } : cardStyle}>
            {editingId && (
              <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.14em', color: 'var(--gold)', padding: '0 4px' }}>EDITING CARD</span>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 8, alignItems: 'center' }}>
              <input ref={leftInputRef} aria-label="Left label" placeholder="Left" value={left} onChange={(e) => setLeft(e.target.value)} style={inputStyle} />
              <span style={{ font: '400 20px/1 var(--font-body)', color: 'var(--text-muted)' }}>⟷</span>
              <input aria-label="Right label" placeholder="Right" value={right} onChange={(e) => setRight(e.target.value)} style={inputStyle} />
            </div>
            {editingId ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
                <Btn kind="ghost" size="sm" label="Cancel" onClick={cancelEdit} disabled={savingEdit} />
                <Btn kind="primary" size="sm" label={savingEdit ? 'Saving…' : 'Save'} onClick={saveEdit} disabled={savingEdit || !left.trim() || !right.trim()} />
              </div>
            ) : (
              <Btn kind="secondary" size="sm" label="Add spectrum" onClick={addSpectrum} disabled={!left.trim() || !right.trim()} />
            )}
          </div>
        )}

        {mode === 'paste' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
              <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                ONE PER LINE · <span style={{ color: '#F3ECDD', fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>Left | Right</span>
              </span>
              <button
                onClick={() => setPasteText('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', font: '500 13px var(--font-body)', cursor: 'pointer', padding: 4 }}
              >
                Clear
              </button>
            </div>
            <textarea
              aria-label="Paste a list"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your list here…"
              style={{
                height: 150,
                resize: 'none',
                borderRadius: 16,
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                padding: '12px 14px',
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                lineHeight: 1.55,
                outline: 'none',
                boxSizing: 'border-box',
                width: '100%',
              }}
            />
            <Btn kind="accent" size="sm" label="Get an AI prompt for this format" onClick={() => setShowAiSheet(true)} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px' }}>
              <span style={{ font: '600 15px/1 var(--font-body)', color: 'var(--text)' }}>Preview</span>
              <span style={{ font: '400 12px/1 var(--font-body)', color: 'var(--text-muted)' }}>
                {parsed.valid.length} ready · {parsed.results.length - parsed.valid.length} need attention
              </span>
            </div>
            {pasteText.trim().length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {parsed.results.map((r, i) => {
                  const tag = rowTagStyle[r.status]
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minHeight: 40,
                        padding: '0 14px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,.04)',
                        border: '1px solid rgba(200,180,255,.08)',
                        opacity: r.status === 'ok' ? 1 : 0.7,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          font: '500 14px/1 var(--font-body)',
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.line}
                      </span>
                      <span style={{ flex: 'none', font: '600 11px/1 var(--font-body)', color: tag.color, whiteSpace: 'nowrap' }}>
                        {tag.text}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <Btn kind="primary" size="lg" label={pasteCta} disabled={parsed.valid.length === 0 || importing} onClick={importPasted} />
          </div>
        )}

        {mode === 'replace' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
              <span style={{ font: '600 11px/1 var(--font-body)', letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                FULL LIST · <span style={{ color: '#F3ECDD', fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>Left | Right</span>
              </span>
              <button
                onClick={copyExport}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', font: '500 13px var(--font-body)', cursor: 'pointer', padding: 4 }}
              >
                {copied ? 'Copied!' : 'Copy list'}
              </button>
            </div>
            <p style={{ margin: '0 4px', font: '400 13px/1.4 var(--font-body)', color: 'var(--text-muted)' }}>
              Pre-filled with what's in the pack now — edit it directly, or copy it out, hand it to an AI with what you want changed, and paste the result back. Replacing removes anything not in this list and adds anything new.
            </p>
            <textarea
              aria-label="Full pack list"
              value={replaceText}
              onChange={(e) => {
                setReplaceText(e.target.value)
                setReplaceResult(null)
              }}
              style={{
                height: 220,
                resize: 'none',
                borderRadius: 16,
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                padding: '12px 14px',
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                lineHeight: 1.55,
                outline: 'none',
                boxSizing: 'border-box',
                width: '100%',
              }}
            />
            <span style={{ font: '400 12px/1 var(--font-body)', color: 'var(--text-muted)', padding: '0 4px' }}>
              {parsedReplace.valid.length} valid line{parsedReplace.valid.length === 1 ? '' : 's'}
              {parsedReplace.results.length - parsedReplace.valid.length > 0 &&
                ` · ${parsedReplace.results.length - parsedReplace.valid.length} need${parsedReplace.results.length - parsedReplace.valid.length === 1 ? 's' : ''} attention`}
            </span>
            {replaceError && (
              <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                {replaceError}
              </span>
            )}
            {replaceResult && (
              <span style={{ font: '500 13px var(--font-body)', color: 'var(--novas, #5BD6FF)' }}>
                Added {replaceResult.added}, removed {replaceResult.removed}
                {replaceResult.skipped > 0 && ` (kept ${replaceResult.skipped} that have already been played in a game and can't be removed)`}.
              </span>
            )}
            <Btn
              kind="primary"
              size="lg"
              label={replacing ? 'Replacing…' : 'Replace pack with this list'}
              disabled={replacing || parsedReplace.valid.length === 0}
              onClick={runReplace}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 4px 0' }}>
          <span style={{ font: '600 16px/1 var(--font-body)', color: 'var(--text)' }}>{spectrums.length} cards</span>
          <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--text-muted)' }}>Swipe left to delete</span>
        </div>
        {spectrumError && (
          <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
            {spectrumError}
          </span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {spectrums.map((s) => (
            <div key={s.id} style={{ position: 'relative', overflow: 'hidden', borderRadius: 999 }}>
              <button
                onClick={() => deleteSpectrum(s.id)}
                aria-label={`Delete ${s.left_label} / ${s.right_label}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  right: 0,
                  width: SWIPE_REVEAL_PX,
                  background: 'var(--comets)',
                  border: 'none',
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                🗑
              </button>
              <div
                onPointerDown={(e) => handleRowPointerDown(s.id, e)}
                onPointerMove={(e) => handleRowPointerMove(s.id, e)}
                onPointerUp={() => handleRowPointerUp(s.id)}
                onPointerCancel={() => handleRowPointerUp(s.id, false)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) 56px minmax(0,1fr)',
                  gap: 10,
                  alignItems: 'center',
                  minHeight: 50,
                  padding: '0 16px',
                  borderRadius: 999,
                  background: '#181038',
                  border: editingId === s.id ? '1px solid rgba(255,209,102,.6)' : '1px solid rgba(200,180,255,.08)',
                  cursor: 'pointer',
                  position: 'relative',
                  touchAction: 'pan-y',
                  transform: `translateX(${draggingId === s.id ? liveOffset : openSpectrumId === s.id ? -SWIPE_REVEAL_PX : 0}px)`,
                  transition: draggingId === s.id ? 'none' : 'transform 0.2s ease',
                }}
              >
                <span style={{ font: '500 15px/1 var(--font-body)', color: 'var(--text)', textAlign: 'right' }}>{s.left_label}</span>
                <span
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background:
                      'linear-gradient(90deg,#2E2266 0 30%,#8C6BFF 30% 38%,#FF6FA3 38% 44%,#FFD166 44% 56%,#FF6FA3 56% 62%,#8C6BFF 62% 70%,#2E2266 70%)',
                  }}
                />
                <span style={{ font: '500 15px/1 var(--font-body)', color: 'var(--text)' }}>{s.right_label}</span>
              </div>
            </div>
          ))}
        </div>

        <Btn
          kind="secondary"
          size="md"
          label="Delete pack"
          onClick={() => setDeletePackConfirm(true)}
        />
        {deletePackError && (
          <span role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
            {deletePackError}
          </span>
        )}

        {showAiSheet && <AiPromptSheet onClose={() => setShowAiSheet(false)} />}
      </div>

      {deletePackConfirm && (
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
          onClick={() => setDeletePackConfirm(false)}
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
              <span style={{ font: '700 18px var(--font-display)', color: 'var(--text)' }}>Delete {pack?.name ?? 'this pack'}?</span>
              <span style={{ font: '400 14px var(--font-body)', color: 'var(--text-muted)' }}>
                This deletes the whole pack and all its cards. This can't be undone.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Btn kind="secondary" size="md" label="Cancel" onClick={() => setDeletePackConfirm(false)} disabled={deletingPack} />
              </div>
              <div style={{ flex: 1 }}>
                <Btn kind="primary" size="md" label={deletingPack ? 'Deleting…' : 'Delete'} onClick={confirmDeletePack} disabled={deletingPack} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
