import { useEffect, useMemo, useState } from 'react'

export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [checks, setChecks] = useState([])

  const api = useMemo(() => createApi(), [])

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false))
  }, [api])

  async function login(event) {
    event.preventDefault()
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: String(form.get('username') || '').trim(),
          password: form.get('password'),
        }),
      })
      setAuthenticated(true)
      setMessage('Connexion active.')
    } catch (error) {
      setMessage(loginErrorMessage(error))
    }
  }

  async function runSourceCheck() {
    setMessage('Test des sources en cours...')
    try {
      const data = await api('/api/source-check', { method: 'POST' })
      setChecks(data.checks)
      setMessage('Test terminé.')
    } catch {
      setMessage('Impossible de tester les sources.')
    }
  }

  if (loading) return <main className="page"><section className="panel">Chargement...</section></main>

  return (
    <main className="page">
      <section className="panel">
        <h1>Opportunity Radar</h1>

        {!authenticated ? (
          <form className="stack" onSubmit={login}>
            <label>
              Identifiant
              <input name="username" autoComplete="username" />
            </label>
            <label>
              Mot de passe
              <input name="password" type="password" autoComplete="current-password" />
            </label>
            <button type="submit">Se connecter</button>
          </form>
        ) : (
          <div className="stack">
            <button type="button" onClick={runSourceCheck}>Tester les API emploi</button>
            <div className="checks">
              {checks.map((check) => (
                <div className={`check ${check.ok ? 'ok' : 'fail'}`} key={check.source}>
                  <strong>{check.source}</strong>
                  <span>{check.ok ? 'OK' : 'Échec'} - {check.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </main>
  )
}

function createApi() {
  return async function api(path, options = {}) {
    let res
    try {
      res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      })
    } catch (error) {
      throw new ApiError('network', { cause: error })
    }
    if (!res.ok) throw new ApiError('http', { status: res.status })
    return res.json()
  }
}

function loginErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) return 'Identifiant ou mot de passe incorrect.'
  if (error instanceof ApiError && error.kind === 'network') return 'API injoignable.'
  return 'Connexion impossible.'
}

class ApiError extends Error {
  constructor(kind, options = {}) {
    super(kind === 'http' ? `HTTP ${options.status}` : 'Network error', options)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
  }
}
