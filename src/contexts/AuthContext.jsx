import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext(null)

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false))
  }, [])

  async function login(password) {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
    setAuthenticated(true)
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setAuthenticated(false)
  }

  return (
    <AuthContext.Provider value={{ user: authenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
