import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon.jsx'

// A gesture that starts here belongs to the control, not to swipe-to-dismiss.
const NODRAG = 'input[type=range], textarea, [data-nodrag]'

// A bottom sheet (or, with `center`, a centred dialog), myGym's way: it slides up with a spring,
// follows the finger down and goes on a long pull or a quick flick, and slides away when closed
// (`.closing`) before it is removed. `children` is a function of `close`, so a Save button closes
// with the same animation. `onClosed` runs once it is gone.
export function Sheet({ label, onClosed, center, children }) {
  const root = useRef(null), panel = useRef(null), gone = useRef(false)

  const close = useCallback(() => {
    if (gone.current) return
    gone.current = true
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onClosed()
    root.current.classList.add('closing')
    setTimeout(onClosed, 260)
  }, [onClosed])

  useEffect(() => {
    const k = e => e.key === 'Escape' && close()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [close])

  useEffect(() => {
    const el = panel.current
    if (center) return
    let d = null
    const start = e => {
      const t = e.touches[0]
      d = e.target.closest(NODRAG) || el.scrollTop > 0 ? null : { x: t.clientX, y: t.clientY, axis: null, dy: 0, vy: 0, ly: t.clientY, lt: performance.now() }
    }
    const move = e => {
      if (!d) return
      const t = e.touches[0], dx = t.clientX - d.x, dy = t.clientY - d.y
      // axis lock after ~8 px: a clearly vertical pull is the sheet's, anything else is a scroll
      if (!d.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        d.axis = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'y' : 'x'
      }
      if (d.axis !== 'y') return
      const now = performance.now()
      if (now > d.lt) { d.vy = (t.clientY - d.ly) / (now - d.lt); d.ly = t.clientY; d.lt = now }
      if (dy > 0 && el.scrollTop <= 0) {
        // not preventing this is what let the pull drag the page (and reload it in Safari)
        e.preventDefault()
        d.dy = dy
        el.style.transition = 'none'
        el.style.transform = `translateY(${dy}px)`
      } else if (d.dy > 0) {
        e.preventDefault()
        d.dy = 0
        el.style.transform = ''
      }
    }
    const end = () => {
      if (!d) return
      const flick = d.dy > 30 && d.vy > 0.6
      el.style.transition = 'transform .22s var(--ease)'
      if (d.dy > 90 || flick) {
        gone.current = true
        el.style.transform = 'translateY(110%)'
        root.current.classList.add('dragged-away')
        setTimeout(onClosed, 220)
      } else el.style.transform = ''
      d = null
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [center, onClosed])

  // the page behind must not scroll or rubber-band while a sheet is up
  const block = e => e.preventDefault()
  useEffect(() => {
    const s = root.current.firstChild
    s.addEventListener('touchmove', block, { passive: false })
    return () => s.removeEventListener('touchmove', block)
  }, [])

  // on <body>: inside another sheet (will-change: transform) a fixed layer would be pinned to it
  return createPortal(<div className="layer" ref={root}>
    <div className="scrim" onClick={close} />
    <div className={center ? 'center' : 'sheet'} ref={panel} role="dialog" aria-modal="true" aria-label={label}>
      {!center && <div className="grab" />}
      {children(close)}
    </div>
  </div>, document.body)
}

// Title row with a close button, so a sheet can always be dismissed without the gesture.
export const SheetHead = ({ title, sub, close }) => <div className="sheet-head">
  <div><h2>{title}</h2>{sub && <div className="muted">{sub}</div>}</div>
  <button className="iconbtn sm" onClick={close} aria-label="Close"><Icon name="close" /></button>
</div>

// A centred yes/no for destructive actions.
export function Confirm({ title, body, action, onConfirm, onClosed }) {
  return <Sheet center label={title} onClosed={onClosed}>{close => <div className="stack" style={{ gap: 10 }}>
    <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
    {body && <div className="muted small">{body}</div>}
    <button className="btn danger" onClick={() => { onConfirm(); close() }}>{action}</button>
    <button className="btn ghost" onClick={close}>Cancel</button>
  </div>}</Sheet>
}
