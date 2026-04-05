import { useEffect, useState } from 'react'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import JobCard from './JobCard'

export default function HomePage() {
  const { workspaceName, logout } = useAuth()

  // Offres
  const [jobs, setJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)

  // Offres postulées
  const [appliedJobIds, setAppliedJobIds] = useState([])

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keywords, setKeywords] = useState('')
  const [location, setLocation] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Charger les offres en temps réel
  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('addedAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setJobsLoading(false)
    })
    return unsub
  }, [])

  // Charger le profil utilisateur (offres postulées)
  useEffect(() => {
    if (!workspaceName) return
    const userRef = doc(db, 'users', workspaceName)
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setAppliedJobIds(snap.data().appliedJobIds ?? [])
      } else {
        // Créer le document utilisateur s'il n'existe pas
        setDoc(userRef, { appliedJobIds: [] })
      }
    })
    return unsub
  }, [workspaceName])

  // Charger les paramètres de recherche
  useEffect(() => {
    const configRef = doc(db, 'config', 'search_params')
    getDoc(configRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setKeywords((data.keywords ?? []).join(', '))
        setLocation(data.location ?? '')
      }
    })
  }, [])

  async function handleMarkApplied(jobId) {
    const userRef = doc(db, 'users', workspaceName)
    await updateDoc(userRef, { appliedJobIds: arrayUnion(jobId) })
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    setSettingsSaved(false)
    const configRef = doc(db, 'config', 'search_params')
    const keywordsList = keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    await setDoc(configRef, { keywords: keywordsList, location: location.trim() })
    setSettingsSaving(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
  }

  // Tri : non postulé en premier, puis par date décroissante (déjà ordonnée par Firestore)
  const notApplied = jobs.filter((j) => !appliedJobIds.includes(j.id))
  const applied = jobs.filter((j) => appliedJobIds.includes(j.id))

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">Candidator</span>
          {!jobsLoading && (
            <span className="header-count">
              {notApplied.length} offre{notApplied.length !== 1 ? 's' : ''} en attente
            </span>
          )}
        </div>
        <div className="header-right">
          <span className="header-workspace">
            Espace : <strong>{workspaceName}</strong>
          </span>
          <button className="btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* Settings */}
        <div className="settings-panel">
          <button
            className="settings-toggle"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <span>Paramètres de recherche</span>
            <span className={`settings-toggle-icon${settingsOpen ? ' open' : ''}`}>▼</span>
          </button>

          {settingsOpen && (
            <div className="settings-body">
              <div className="settings-field">
                <label>Mots-clés de recherche</label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="Product Owner, Business Analyst"
                />
                <span className="settings-hint">Séparer par des virgules</span>
              </div>
              <div className="settings-field">
                <label>Localisation</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Île-de-France"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  className="btn-save"
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                >
                  {settingsSaving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                {settingsSaved && (
                  <span className="settings-success">✓ Enregistré</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Liste des offres */}
        {jobsLoading ? (
          <div className="jobs-empty">
            <p>Chargement des offres…</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="jobs-empty">
            <p>Aucune offre pour le moment</p>
            <p>
              Les offres seront ajoutées automatiquement chaque jour à 7h.
              Vous pouvez aussi déclencher manuellement le workflow GitHub Actions.
            </p>
          </div>
        ) : (
          <>
            {notApplied.length > 0 && (
              <>
                <div className="jobs-section-title">
                  À candidater ({notApplied.length})
                </div>
                <div className="jobs-list">
                  {notApplied.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      isApplied={false}
                      onMarkApplied={handleMarkApplied}
                    />
                  ))}
                </div>
              </>
            )}

            {applied.length > 0 && (
              <>
                <div className="jobs-section-title">
                  Déjà postulé ({applied.length})
                </div>
                <div className="jobs-list">
                  {applied.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      isApplied={true}
                      onMarkApplied={handleMarkApplied}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
