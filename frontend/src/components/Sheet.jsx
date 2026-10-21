import { useEffect, useState } from 'react'

// Slides up when `open`, slides away when it turns false; the sheet stays mounted until then.
export function Sheet({ open, onClose, label, children }) {
  const [shown, setShown] = useState(open), [up, setUp] = useState(false)
  useEffect(() => {
    if (open) { setShown(true); const r = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true))); return () => cancelAnimationFrame(r) }
    setUp(false)
    const t = setTimeout(() => setShown(false), 320)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    if (!open) return
    const k = e => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  if (!shown) return null
  return <>
    <div className={'scrim' + (up ? ' open' : '')} onClick={onClose} />
    <div className={'sheet' + (up ? ' open' : '')} role="dialog" aria-modal="true" aria-label={label}>
      <div className="grab" />
      {children}
    </div>
  </>
}
