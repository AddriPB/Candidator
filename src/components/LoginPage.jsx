import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [workspace, setWorkspace] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!workspace.trim() || pin.length !== 4) return
    setError('')
    setLoading(true)
    try {
      await login(workspace.trim().toLowerCase(), pin)
    } catch {
      setError('Espace ou PIN incorrect. Vérifiez vos informations.')
    } finally {
      setLoading(false)
    }
  }

  function handlePinChange(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(val)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">Candidator</div>
        <p className="login-subtitle">Votre espace de suivi des offres d'emploi</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="workspace">Nom de l'espace</label>
            <input
              id="workspace"
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="monespace"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="pin">PIN (4 chiffres)</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={handlePinChange}
              placeholder="••••"
              className="pin-input"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !workspace.trim() || pin.length !== 4}
          >
            {loading ? 'Connexion…' : 'Accéder à mon espace'}
          </button>
        </form>
      </div>
    </div>
  )
}
