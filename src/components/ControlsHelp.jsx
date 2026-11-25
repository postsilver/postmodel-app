import { useEffect, useId, useRef, useState } from 'react'
import mouseIcon from '../assets/controls/mouse.svg'
import scrollIcon from '../assets/controls/scroll.svg'
import cursorIcon from '../assets/controls/cursor.svg'
import keycapFrame from '../assets/controls/keycap-frame.svg'
import keyM from '../assets/controls/key-m.svg'
import keyZ from '../assets/controls/key-z.svg'
import keyR from '../assets/controls/key-r.svg'
import { POPOVER_SURFACE } from '../styles/popover.js'

// Controls help: a "Controls" button in the viewport that opens the Postmodel
// controls panel (Figma node 67:480) on hover, keyboard focus, or tap.

// Shows an SVG file unchanged, coloured from a token via CSS mask
// (the Figma exports are white; this lets them follow tokens.css).
function MaskIcon({ src, width, height, color = 'var(--color-text-primary)', style }) {
  return (
    <span aria-hidden="true" style={{
      display: 'block', width, height, flexShrink: 0, backgroundColor: color,
      WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`,
      WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
      WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
      ...style,
    }} />
  )
}

// 24×24 icon box; vectors sit centred at their Figma size
function IconBox({ children }) {
  return (
    <span aria-hidden="true" style={{ position: 'relative', width: 24, height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </span>
  )
}

function KeyCap({ letter, width }) {
  return (
    <IconBox>
      <MaskIcon src={keycapFrame} width={20} height={20} style={{ position: 'absolute' }} />
      <MaskIcon src={letter} width={width} height={10} style={{ position: 'absolute' }} />
    </IconBox>
  )
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

const headingStyle = {
  margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 400,
  fontSize: 'var(--font-size-body-lg)', lineHeight: 1.2, color: 'var(--color-text-primary)',
}
// 1px line under each heading (Figma: 325px wide, starting 2px right of the heading text)
const headingLine = { height: 1, width: 325, marginLeft: 2, background: 'var(--color-text-primary)' }
const listStyle = { listStyle: 'none', margin: 0, padding: 0 }
const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: 5, height: 32 }
const rowText = {
  fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-label)',
  lineHeight: '24px', color: 'var(--color-text-primary)', whiteSpace: 'nowrap',
}

function Row({ icon, srPrefix, children }) {
  return (
    <li style={rowStyle}>
      {icon}
      <span style={rowText}>{srPrefix && <span style={srOnly}>{srPrefix}</span>}{children}</span>
    </li>
  )
}

function ControlsPanel({ id, hidden }) {
  return (
    // Transparent 8px bridge under the panel keeps hover alive between button and panel
    <div id={id} hidden={hidden} style={{ position: 'absolute', left: 0, bottom: '100%', paddingBottom: 8 }}>
      <div style={{
        ...POPOVER_SURFACE,
        width: 340, height: 285, boxSizing: 'border-box', padding: '0 0 0 5px',
        overflow: 'hidden',
      }}>
        <h2 style={{ ...headingStyle, height: 29 }}>Navigation</h2>
        <div aria-hidden="true" style={headingLine} />
        <ul style={{ ...listStyle, marginTop: 1 }}>
          <Row icon={<IconBox><MaskIcon src={mouseIcon} width={14} height={20} /></IconBox>}>Left Click + Drag = Rotate camera</Row>
          <Row icon={<IconBox><MaskIcon src={mouseIcon} width={14} height={20} /></IconBox>}>Right Click + Drag = Pan camera</Row>
          <Row icon={<IconBox><MaskIcon src={scrollIcon} width={17.5} height={21.5} /></IconBox>}>Scroll Wheel = Zoom in/out</Row>
        </ul>
        <h2 style={{ ...headingStyle, height: 28, marginTop: 6 }}>Object Interaction</h2>
        <div aria-hidden="true" style={headingLine} />
        <ul style={{ ...listStyle, marginTop: 3 }}>
          <Row icon={<IconBox><MaskIcon src={cursorIcon} width={17.5} height={17.5} /></IconBox>}>Click Object = Select</Row>
          <Row icon={<KeyCap letter={keyM} width={8} />} srPrefix="M key: ">Move Object (toggle)</Row>
          <Row icon={<KeyCap letter={keyZ} width={6} />} srPrefix="Z key: ">Move on Vertical Axis (toggle)</Row>
          <Row icon={<KeyCap letter={keyR} width={6} />} srPrefix="R key: ">Show Rotation Panel</Row>
        </ul>
      </div>
    </div>
  )
}

export default function ControlsHelp({ style }) {
  const panelId = useId()
  const wrapRef = useRef(null)
  const lastPointerType = useRef(null)
  const [hovered, setHovered] = useState(false)   // mouse over button or panel
  const [focused, setFocused] = useState(false)   // keyboard focus on the button
  const [pinned, setPinned] = useState(false)     // opened by a tap (touch/pen)
  const [dismissed, setDismissed] = useState(false) // closed with Esc until next hover/focus/tap
  const open = !dismissed && (hovered || focused || pinned)

  // Esc closes; a tap outside closes a tap-opened panel
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { setDismissed(true); setPinned(false) } }
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setPinned(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', ...style }}
      onPointerEnter={e => { if (e.pointerType === 'mouse') { setHovered(true); setDismissed(false) } }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHovered(false) }}
    >
      <ControlsPanel id={panelId} hidden={!open} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={e => { lastPointerType.current = e.pointerType }}
        onClick={() => {
          // Mouse already opens on hover and keyboard on focus; taps toggle
          if (lastPointerType.current === 'touch' || lastPointerType.current === 'pen') {
            setPinned(p => !p)
            setDismissed(false)
          }
          lastPointerType.current = null
        }}
        onFocus={e => {
          // Only keyboard focus opens it; a mouse click focusing the button shouldn't pin it
          if (e.currentTarget.matches(':focus-visible')) { setFocused(true); setDismissed(false) }
        }}
        onBlur={() => setFocused(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: 'color-mix(in srgb, var(--color-background) 85%, transparent)',
          border: '1px solid var(--color-border)', borderRadius: 6,
          color: 'var(--color-text-primary)', cursor: 'pointer',
          fontSize: 'var(--font-size-label)', fontFamily: 'var(--font-body)',
          userSelect: 'none',
        }}
      >
        <MaskIcon src={mouseIcon} width={10} height={14} />
        Controls
      </button>
    </div>
  )
}
