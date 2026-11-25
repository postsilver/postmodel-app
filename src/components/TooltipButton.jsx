import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TOOLTIP_STYLE } from '../styles/popover.js'

const HOVER_DELAY = 400      // ms before a hover tooltip appears
const HIDE_DELAY = 100       // ms grace period when leaving, so the tooltip itself can be hovered
const LONG_PRESS = 500       // ms finger hold before a touch tooltip appears
const TOUCH_LINGER = 1500    // ms a touch tooltip stays after the finger lifts
const TOUCH_SLOP = 10        // px a finger may wobble before the long press is cancelled
const GAP = 6                // px between button and tooltip
const EDGE = 8               // px minimum distance from the window edge

/**
 * A <button> with the shared Postmodel tooltip (see styles/popover.js).
 * - Mouse: shows after 400ms hover; stays while the pointer is on the button or tooltip.
 * - Keyboard: shows immediately on keyboard focus.
 * - Touch: shows on long press; the tap that ends a long press is swallowed so the
 *   button doesn't also fire.
 * - Esc hides it. Rendered in a portal so scrolling sidebars can't clip it.
 *
 * Props: `tooltip` (text), `tooltipPlacement` ('top' | 'bottom'); everything else goes
 * to the <button>. Give the button its own aria-label; when the tooltip says more than
 * that, it's linked with aria-describedby.
 */
export default function TooltipButton({
  tooltip, tooltipPlacement = 'top', children, style,
  onPointerEnter, onPointerLeave, onFocus, onBlur, onPointerDown, onPointerMove,
  onPointerUp, onPointerCancel, onClickCapture, onContextMenu,
  ...buttonProps
}) {
  const id = useId()
  const anchorRef = useRef(null)
  const tipRef = useRef(null)
  const timers = useRef({})
  const press = useRef(null) // { x, y, fired } for the current touch
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)

  const clear = (name) => { clearTimeout(timers.current[name]); timers.current[name] = null }
  const show = useCallback(() => { clear('hide'); setOpen(true) }, [])
  const hide = useCallback(() => { clear('show'); clear('hide'); setOpen(false) }, [])
  const showSoon = (delay) => { clear('hide'); clear('show'); timers.current.show = setTimeout(show, delay) }
  const hideSoon = (delay) => { clear('show'); clear('hide'); timers.current.hide = setTimeout(hide, delay) }

  useEffect(() => {
    const t = timers.current
    return () => Object.values(t).forEach(clearTimeout)
  }, [])

  // Esc dismisses; scrolling or resizing hides (the position would be stale)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  // Place above (or below) the button, flipping and clamping to stay on screen
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return
    const a = anchorRef.current.getBoundingClientRect()
    const t = tipRef.current.getBoundingClientRect()
    let top = tooltipPlacement === 'bottom' ? a.bottom + GAP : a.top - t.height - GAP
    if (top < EDGE) top = a.bottom + GAP
    if (top + t.height > window.innerHeight - EDGE) top = Math.max(EDGE, a.top - t.height - GAP)
    const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - EDGE)
    setPos({ top, left }) // measured layout, applied before paint
  }, [open, tooltipPlacement, tooltip])

  const describes = tooltip && tooltip !== buttonProps['aria-label']

  return (
    <>
      <button
        type="button"
        {...buttonProps}
        ref={anchorRef}
        aria-describedby={open && describes ? id : buttonProps['aria-describedby']}
        style={{ WebkitTouchCallout: 'none', ...style }} // no iOS long-press callout
        onPointerEnter={(e) => { onPointerEnter?.(e); if (e.pointerType === 'mouse') showSoon(HOVER_DELAY) }}
        onPointerLeave={(e) => { onPointerLeave?.(e); if (e.pointerType === 'mouse') hideSoon(HIDE_DELAY) }}
        onFocus={(e) => { onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) show() }}
        onBlur={(e) => { onBlur?.(e); hide() }}
        onPointerDown={(e) => {
          onPointerDown?.(e)
          if (e.pointerType === 'mouse') { hide(); return } // clicking dismisses a hover tooltip
          press.current = { x: e.clientX, y: e.clientY, fired: false }
          clear('show')
          timers.current.show = setTimeout(() => { if (press.current) press.current.fired = true; show() }, LONG_PRESS)
        }}
        onPointerMove={(e) => {
          onPointerMove?.(e)
          const pr = press.current
          if (pr && !pr.fired && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > TOUCH_SLOP) { clear('show'); press.current = null }
        }}
        onPointerUp={(e) => {
          onPointerUp?.(e)
          if (e.pointerType === 'mouse') return
          if (press.current?.fired) hideSoon(TOUCH_LINGER)
          else clear('show')
        }}
        onPointerCancel={(e) => { onPointerCancel?.(e); clear('show'); press.current = null; hideSoon(TOUCH_LINGER) }}
        // A long press shows the tooltip; it must not also press the button
        onClickCapture={(e) => {
          onClickCapture?.(e)
          if (press.current?.fired) { e.preventDefault(); e.stopPropagation() }
          press.current = null
        }}
        onContextMenu={(e) => { onContextMenu?.(e); if (press.current) e.preventDefault() }} // Android long-press menu
      >
        {children}
      </button>
      {open && tooltip && createPortal(
        <div
          id={id}
          ref={tipRef}
          role="tooltip"
          onPointerEnter={() => clear('hide')}
          onPointerLeave={() => hideSoon(HIDE_DELAY)}
          style={{
            ...TOOLTIP_STYLE,
            position: 'fixed', zIndex: 1000,
            top: pos?.top ?? -9999, left: pos?.left ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </>
  )
}
