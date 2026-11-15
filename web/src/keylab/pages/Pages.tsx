import { useHealth } from '../api/useHealth.ts'

// KL0 ships the shell only. Each page fills in with its user story
// (docs/keylab/user-stories.md); until then it shows its title.

function PageHead({ label, title }: { label: string; title: string }) {
  return (
    <div className="page-head">
      <span className="lbl">{label}</span>
      <h1 className="h1">{title}</h1>
    </div>
  )
}

export function Placeholder({ label, title }: { label: string; title: string }) {
  return (
    <>
      <PageHead label={label} title={title} />
      <p className="page-note mut">This page is not built yet.</p>
    </>
  )
}

export function BuildPage() {
  return (
    <>
      <div className="page-head">
        <span className="sticker lime">New build</span>
        <h1 className="h1">Start a build</h1>
      </div>
      <ApiStatus />
    </>
  )
}

/** keylab-api as seen through the BFF: GET /bff/keylab/v1/health. */
function ApiStatus() {
  const health = useHealth()
  return (
    <section className="card status-card" aria-labelledby="api-status-h">
      <h2 id="api-status-h" className="lbl">
        API status
      </h2>
      <div role="status" className="status-row" data-testid="api-status" data-state={health.state}>
        {health.state === 'loading' && <span className="mono status-line">Checking…</span>}
        {health.state === 'ok' && (
          <>
            <span className="sticker lime">Online</span>
            <span className="mono status-line">
              revision {health.health.revision} ·{' '}
              {health.health.authenticated
                ? `signed in · ${health.health.roles.join(', ') || 'no KeyLab role'}`
                : 'guest'}
            </span>
          </>
        )}
        {health.state === 'error' && (
          <>
            <span className="sticker coral">Offline</span>
            <span className="mono status-line">
              {health.problem.userMessage} ({health.problem.code})
            </span>
          </>
        )}
      </div>
    </section>
  )
}
