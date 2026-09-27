import type { CSSProperties } from 'react'
import './Btn.css'

type Kind = 'primary' | 'secondary' | 'accent' | 'ghost'
type Size = 'lg' | 'md' | 'sm'

interface BtnProps {
  kind: Kind
  size: Size
  label: string
  onClick?: () => void
  disabled?: boolean
  /** Inside a form a plain button submits it — pass 'button' when it shouldn't. */
  type?: 'button' | 'submit'
}

const sizeMap: Record<Size, [number, number]> = {
  lg: [62, 21],
  md: [54, 17],
  sm: [44, 15],
}

const kindStyles: Record<Kind, CSSProperties> = {
  primary: {
    background: 'linear-gradient(180deg,#FFE08A 0%,#FFC94D 55%,#F2A93B 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6), 0 10px 28px rgba(255,190,70,.35)',
    color: '#1A1233',
    fontWeight: 700,
  },
  secondary: {
    background: 'rgba(255,255,255,.07)',
    border: '1px solid rgba(200,180,255,.18)',
    color: '#F4F2FB',
    fontWeight: 600,
  },
  accent: {
    background: 'rgba(169,139,255,.16)',
    border: '1px solid rgba(169,139,255,.5)',
    color: '#CFC0FF',
    fontWeight: 600,
  },
  ghost: {
    background: 'transparent',
    border: 'none',
    color: '#A9A3C9',
    fontWeight: 500,
  },
}

export function Btn({ kind, size, label, onClick, disabled, type }: BtnProps) {
  const [height, fontSize] = sizeMap[size]

  const buttonStyle: CSSProperties = {
    width: '100%',
    height: `${height}px`,
    padding: '0 20px',
    borderRadius: '999px',
    fontSize: `${fontSize}px`,
    fontFamily: 'Rubik, system-ui, sans-serif',
    whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    boxSizing: 'border-box',
    ...kindStyles[kind],
  }

  const handleClick = () => {
    if (!disabled && onClick) {
      onClick()
    }
  }

  return (
    <button
      type={type}
      style={buttonStyle}
      onClick={handleClick}
      disabled={disabled}
      className="btn-active"
    >
      {label}
    </button>
  )
}
