import { useEffect, useState } from 'react'
import { POPOVER_SURFACE } from '../styles/popover.js'

// Mesh upload feedback: one small card per upload, top-left of the viewport.
// Doesn't cover or block anything else in the editor.
//
// Each upload: { id, name, size, loaded, pct, status, error, retryable, startedAt }
// status: 'preparing' | 'uploading' | 'finishing' | 'done' | 'error'

const SLOW_AFTER_MS = 10000

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

const STATUS_TEXT = {
  preparing: 'Starting upload…',
  uploading: 'Uploading…',
  finishing: 'Finishing…',
  done: 'Uploaded',
}

const small = { fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-caption)', lineHeight: 1.3 }
const btn = {
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
  fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-label)',
}

function UploadCard({ upload, now, onRetry, onDismiss }) {
  const { name, size, loaded, pct, status, error, retryable, startedAt } = upload
  const active = status === 'preparing' || status === 'uploading' || status === 'finishing'
  const percent = Math.max(0, Math.min(100, Math.floor(pct ?? 0)))
  const slow = active && now - startedAt > SLOW_AFTER_MS
  const isError = status === 'error'

  return (
    <div style={{
      ...POPOVER_SURFACE,
      ...(isError && { borderLeft: '3px solid var(--color-error)' }),
      pointerEvents: 'auto', width: 280, boxSizing: 'border-box', padding: '10px 12px',
      color: 'var(--color-text-primary)',
    }}>
      {/* File name and size */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span title={name} style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-label)', fontWeight: 700,
        }}>{name}</span>
        <span style={{ ...small, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{formatBytes(size)}</span>
      </div>

      {!isError && <>
        {/* Progress bar */}
        <div
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={status === 'done' ? 'Uploaded' : `${percent}%`}
          style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'var(--color-surface-raised)', overflow: 'hidden' }}
        >
          <div style={{
            height: '100%', width: `${status === 'done' ? 100 : percent}%`,
            background: status === 'done' ? 'var(--color-success)' : 'var(--color-button)',
            transition: 'width 0.2s linear',
          }} />
        </div>

        {/* Percentage, amount and status */}
        <div style={{ ...small, marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--color-text-secondary)' }}>
          <span role="status" style={{ color: status === 'done' ? 'var(--color-text-primary)' : undefined }}>
            {STATUS_TEXT[status]}
          </span>
          <span>
            {status === 'uploading' && loaded > 0 && size > 0 && `${formatBytes(loaded)} of ${formatBytes(size)} · `}
            {status === 'done' ? '100%' : `${percent}%`}
          </span>
        </div>

        {slow && (
          <div role="status" style={{ ...small, marginTop: 4, color: 'var(--color-text-primary)' }}>
            Large file or slow connection, still uploading
          </div>
        )}
      </>}

      {isError && <>
        <div role="alert" style={{ ...small, marginTop: 6, color: 'var(--color-text-primary)' }}>
          Upload failed. {error}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {retryable && (
            <button type="button" onClick={onRetry} style={{
              ...btn, border: 'none', background: 'var(--color-button)', color: 'var(--color-button-text)',
            }}>Try again</button>
          )}
          <button type="button" onClick={onDismiss} aria-label={`Dismiss upload error for ${name}`} style={{
            ...btn, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)',
          }}>Dismiss</button>
        </div>
      </>}
    </div>
  )
}

export default function UploadProgress({ uploads, onRetry, onDismiss, style }) {
  // Tick once a second while anything is uploading, for the "still uploading" note
  const [now, setNow] = useState(() => Date.now())
  const anyActive = uploads.some(u => u.status === 'preparing' || u.status === 'uploading' || u.status === 'finishing')
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyActive])

  if (uploads.length === 0) return null
  return (
    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none', ...style }}>
      {uploads.map(u => (
        <UploadCard key={u.id} upload={u} now={now}
          onRetry={() => onRetry(u.id)} onDismiss={() => onDismiss(u.id)} />
      ))}
    </div>
  )
}
