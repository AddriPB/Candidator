import { createContext, useContext, useEffect, useState } from 'react'
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [workspaceName, setWorkspaceName] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // Extraire le nom d'espace depuis l'email (format: workspace@candidator.internal)
        const name = firebaseUser.email.replace('@candidator.internal', '')
        setUser(firebaseUser)
        setWorkspaceName(name)
      } else {
        setUser(null)
        setWorkspaceName(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  // L'utilisateur entre workspace + PIN → on construit email et password
  async function login(workspace, pin) {
    const email = `${workspace}@candidator.internal`
    const password = `${workspace}_${pin}`
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    await signOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, workspaceName, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
