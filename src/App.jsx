import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage from './components/LoginPage'
import HomePage from './components/HomePage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Chargement…</div>
  return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Chargement…</div>
  return user ? <Navigate to="/" replace /> : children
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  )
}
