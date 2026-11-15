import { useState } from 'react'
import { Link } from 'react-router'

// Toast.dc.html: success, error or info, with an optional action link.

export type Notice = {
  kind: 'success' | 'error' | 'info'
  title: string
  body: string
  action?: { label: string; to: string }
}

const ICON = {
  success: 'M5 12.5l4.5 4.5L19 7.5',
  error: 'M12 6v8M12 17.5v.5',
  info: 'M12 10v8M12 6.5v.5',
}

export default function Toast({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) {
    return null
  }
  const dismiss = onDismiss ?? (() => setHidden(true))
  const error = notice.kind === 'error'
  return (
    <div className="tst-wrap">
      <div className={`tst ${notice.kind}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
        <span aria-hidden="true" className="tst-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
            <path d={ICON[notice.kind]} />
          </svg>
        </span>
        <div className="tst-text">
          <span className="tst-title">{notice.title}</span>
          <span className="tst-body">{notice.body}</span>
        </div>
        {notice.action && (
          <Link className="tst-btn" to={notice.action.to}>
            {notice.action.label}
          </Link>
        )}
        <button type="button" className="tst-x" aria-label="Dismiss" onClick={dismiss}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
