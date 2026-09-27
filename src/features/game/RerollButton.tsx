import { useState } from 'react'

/** The psychic's one-per-turn "deal me a different spectrum" control. */
export function RerollButton({ onReroll }: { onReroll: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    const ok = await onReroll()
    // On success the button unmounts once the turn reports it's been used;
    // only a failure needs to hand control back.
    if (!ok) setBusy(false)
  }

  return (
    <button type="button" className="reroll-btn" onClick={handleClick} disabled={busy} aria-busy={busy}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={busy ? 'reroll-icon reroll-icon--spin' : 'reroll-icon'}
      >
        <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
        <path d="M4 3v5h5" />
        <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
        <path d="M20 21v-5h-5" />
      </svg>
      <span>{busy ? 'Dealing…' : 'New spectrum'}</span>
      {!busy && <span className="reroll-note">once per turn</span>}
    </button>
  )
}
