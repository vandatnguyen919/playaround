import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import './App.css'

// One origin for the browser: Vite proxies these paths to the gateway. Axios
// reads the XSRF-TOKEN cookie and echoes it in the X-XSRF-TOKEN header on
// unsafe requests. Credentials are included so the session cookie travels too.
const http = axios.create({
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      window.location.assign('/oauth2/authorization/gateway')
    } else if (status === 403) {
      window.location.assign('/forbidden')
    }
    return Promise.reject(error)
  },
)

type User = {
  name: string | null
  preferredUsername: string | null
  email: string | null
  roles: string[]
}

type State = 'loading' | 'anonymous' | 'signed-in'
type Route = '/' | '/me' | '/admin' | '/forbidden'

// Share one in-flight load so React StrictMode's double effect (and any double
// mount) does not fire parallel requests that race on the session.
let inFlight: Promise<void> | null = null

export default function App() {
  const route = (window.location.pathname || '/') as Route
  const [state, setState] = useState<State>('loading')
  const [user, setUser] = useState<User | null>(null)

  const loadProtectedRoute = useCallback((endpoint: '/bff/me' | '/bff/admin') => {
    if (inFlight) {
      return inFlight
    }
    setState('loading')
    inFlight = (async () => {
      try {
        // /bff/csrf makes the gateway write the XSRF-TOKEN cookie for Axios.
        await http.get('/bff/csrf')
        if (endpoint === '/bff/me') {
          const response = await http.get<User>(endpoint)
          setUser(response.data)
        } else {
          await http.get(endpoint)
        }
        setState('signed-in')
      } catch {
        setUser(null)
        setState('anonymous')
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }, [])

  useEffect(() => {
    if (route === '/me') {
      loadProtectedRoute('/bff/me')
    } else if (route === '/admin') {
      loadProtectedRoute('/bff/admin')
    } else {
      setState('anonymous')
    }
  }, [loadProtectedRoute, route])

  const signIn = () => {
    window.location.assign('/oauth2/authorization/gateway')
  }

  const signOut = () => {
    // POST /logout carries the X-XSRF-TOKEN header. The gateway ends the local
    // session and answers with the OIDC RP-initiated logout URL, which the
    // browser opens as a top-level request: Keycloak ends its session too and
    // sends the browser back to the application.
    http
      .post<{ logoutUrl: string }>('/logout')
      .then((response) => window.location.assign(response.data.logoutUrl))
      .catch(() => window.location.assign('/'))
  }

  if (route === '/forbidden') {
    return (
      <main className="shell">
        <h1>Access denied</h1>
        <p>You do not have permission to view this page.</p>
        <a href="/">Back to home</a>
      </main>
    )
  }

  if (route === '/admin') {
    return (
      <main className="shell">
        <h1>Admin</h1>
        {state === 'loading' && <p>Checking your permissions...</p>}
        {state === 'signed-in' && (
          <>
            <p>Admin access granted.</p>
            <button onClick={signOut}>Sign out</button>
          </>
        )}
      </main>
    )
  }

  if (route === '/me') {
    return (
      <main className="shell">
        <h1>Your profile</h1>
        {state === 'loading' && <p>Checking your session...</p>}
        {state === 'signed-in' && user && (
          <section>
            <h2>{user.name ?? user.preferredUsername ?? user.email}</h2>
            <dl>
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Username</dt>
              <dd>{user.preferredUsername}</dd>
              <dt>Roles</dt>
              <dd>{user.roles.join(', ')}</dd>
            </dl>
            <p><a href="/admin">Open admin area</a></p>
            <button onClick={signOut}>Sign out</button>
          </section>
        )}
      </main>
    )
  }

  return (
    <main className="shell">
      <h1>authn-authz-playground</h1>
      <p className="tagline">One cookie. Zero tokens.</p>
      <p>Sign in to access your profile and role-protected areas.</p>
      <p>
        <button onClick={signIn}>Sign in</button>
      </p>
      <p><a href="/me">Go to profile</a></p>
    </main>
  )
}
