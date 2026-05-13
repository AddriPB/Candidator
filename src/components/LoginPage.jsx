import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!password.trim()) return
    setError('')
    setLoading(true)
    try {
      await login(password)
    } catch {
      setError('Mot de passe incorrect.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-mark">OR</div>
        <h1>Opportunity Radar</h1>
        <p>Radar privé PO / PM / BA / AMOA.</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" disabled={loading || !password.trim()}>
            {loading ? 'Connexion...' : 'Entrer'}
          </button>
        </form>
      </section>
    </main>
  )
}
