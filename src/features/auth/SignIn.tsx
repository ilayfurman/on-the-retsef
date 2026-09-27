import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Starfield } from '../../components/Starfield'
import { Logo } from '../../components/Logo'
import { Btn } from '../../components/Btn'
import { DialFan } from '../../components/DialFan'

const CODE_LENGTH = 6

const pillInputStyle = {
  height: 58,
  borderRadius: 999,
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  padding: '0 22px',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 17,
  fontWeight: 500,
  outline: 'none',
  boxSizing: 'border-box' as const,
  width: '100%',
}

const digitBoxStyle = {
  height: 64,
  borderRadius: 16,
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 28,
  fontWeight: 700,
  textAlign: 'center' as const,
  boxSizing: 'border-box' as const,
}

const backButtonStyle = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: 'rgba(255,255,255,.06)',
  border: '1px solid rgba(200,180,255,.16)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  flex: 'none',
}

export function SignIn() {
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const digitRefs = useRef<Array<HTMLInputElement | null>>([])
  // Arrived from a friend's "Share link" (#/join/CODE)? Say so, so it's clear
  // signing in is a quick step on the way to their party, not a detour.
  const [inviteCode] = useState(() => window.location.hash.match(/^#\/join\/([A-Z]{4})$/i)?.[1]?.toUpperCase() ?? null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) setError(error.message)
    else setCodeSent(true)
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const code = digits.join('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) setError(error.message)
  }

  function handleDigitChange(index: number, value: string) {
    const char = value.slice(-1).replace(/[^0-9]/g, '')
    setDigits((prev) => {
      const next = [...prev]
      next[index] = char
      return next
    })
    if (char && index < CODE_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus()
    }
  }

  function handleDigitKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && digits[index] === '' && index > 0) {
      digitRefs.current[index - 1]?.focus()
    }
  }

  function handleDigitPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '')
    if (!pasted) return
    e.preventDefault()
    setDigits((prev) => {
      const next = [...prev]
      let cursor = index
      for (const char of pasted) {
        if (cursor >= CODE_LENGTH) break
        next[cursor] = char
        cursor += 1
      }
      const focusIndex = Math.min(cursor, CODE_LENGTH - 1)
      digitRefs.current[focusIndex]?.focus()
      return next
    })
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
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '20px 20px',
          boxSizing: 'border-box',
        }}
      >
        {!codeSent ? (
          <form onSubmit={sendCode} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ width: '100%', maxWidth: 190 }}>
                <DialFan value={0.3} revealedTarget={0.64} />
              </div>
              <Logo variant="stacked" size="md" />
              <p
                style={{
                  margin: 0,
                  font: '400 16px/1.4 var(--font-body)',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                Give a clue. Guess the spot.
                <br />
                How close can you get?
              </p>
              {inviteCode && (
                <p
                  style={{
                    margin: '4px 0 0',
                    padding: '8px 14px',
                    borderRadius: 999,
                    background: 'rgba(255,209,102,.12)',
                    border: '1px solid rgba(255,209,102,.35)',
                    font: '600 14px/1.3 var(--font-body)',
                    color: 'var(--text)',
                    textAlign: 'center',
                  }}
                >
                  You&rsquo;re invited to room <span style={{ color: 'var(--gold)', letterSpacing: '.08em' }}>{inviteCode}</span> &mdash; sign in to join
                </p>
              )}
              <input
                id="email"
                aria-label="Email"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ ...pillInputStyle, width: '100%', marginTop: 8 }}
              />
              <div style={{ width: '100%' }}>
                <Btn kind="primary" size="lg" label="Send code" />
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={verifyCode} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button
              type="button"
              onClick={() => setCodeSent(false)}
              aria-label="Back"
              style={backButtonStyle}
            >
              &lsaquo;
            </button>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
              <h1 style={{ margin: 0, font: '700 32px/1.1 var(--font-display)', color: 'var(--text)' }}>
                Check your email
              </h1>
              <p style={{ margin: 0, font: '400 16px/1.45 var(--font-body)', color: 'var(--text-muted)' }}>
                We sent a {CODE_LENGTH}-digit code to{' '}
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{email}</span>
              </p>
              <div
                role="group"
                aria-labelledby="otp-group-label"
                style={{ display: 'grid', gridTemplateColumns: `repeat(${CODE_LENGTH}, minmax(0,1fr))`, gap: 8, marginTop: 6 }}
              >
                <span id="otp-group-label" style={{ display: 'none' }}>
                  6-digit code
                </span>
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    id={`otp-${index}`}
                    aria-label={`Code digit ${index + 1}`}
                    ref={(el) => {
                      digitRefs.current[index] = el
                    }}
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(index, e)}
                    onPaste={(e) => handleDigitPaste(index, e)}
                    style={digitBoxStyle}
                  />
                ))}
              </div>
              <p style={{ margin: '4px 0 0', font: '400 14px var(--font-body)', color: 'var(--text-muted)' }}>
                Didn&rsquo;t get it?{' '}
                <button
                  type="button"
                  onClick={() => sendCode({ preventDefault() {} } as FormEvent)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-subtle-2)', font: 'inherit' }}
                >
                  Resend code
                </button>
              </p>
              <Btn kind="primary" size="lg" label="Verify" />
            </div>
          </form>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--comets)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
