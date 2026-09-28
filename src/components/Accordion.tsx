import { useState, type ReactNode } from 'react'
import './Accordion.css'

export function Accordion({
  title,
  defaultOpen = true,
  className,
  children,
}: {
  title: ReactNode
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`accordion ${className ?? ''}`}>
      <button type="button" className="accordion__header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="accordion__title">{title}</span>
        <span className={`accordion__chevron ${open ? 'accordion__chevron--open' : ''}`}>›</span>
      </button>
      {open && <div className="accordion__body">{children}</div>}
    </div>
  )
}
