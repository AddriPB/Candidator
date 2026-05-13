import { useEffect, useMemo, useState } from 'react'

const DEFAULT_API_BASE = import.meta.env.VITE_PUBLIC_API_BASE || ''

export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [checks, setChecks] = useState([])

  const api = useMemo(() => createApi(DEFAULT_API_BASE), [])

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
          username: form.get('username'),
          password: form.get('password'),
        }),
      })
      setAuthenticated(true)
      setMessage('Connexion active.')
    } catch {
      setMessage('Connexion refusée.')
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
        <p className="eyebrow">Radar privé</p>
        <h1>Opportunity Radar</h1>
        <p>Front statique public, données protégées par le backend du Pi.</p>

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

function createApi(apiBase) {
  return async function api(path, options = {}) {
    const res = await fetch(`${apiBase}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
}
