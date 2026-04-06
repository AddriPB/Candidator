import { useEffect, useRef, useState } from 'react'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import JobCard from './JobCard'

const SOURCE_LABELS = {
  france_travail: 'France Travail',
  adzuna: 'Adzuna',
  jsearch: 'LinkedIn / Indeed',
  careerjet: 'Careerjet',
}
const ALL_SOURCES = Object.keys(SOURCE_LABELS)

export default function HomePage() {
  const { workspaceName, logout } = useAuth()

  // Offres
  const [jobs, setJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(true)

  // Offres postulées
  const [appliedJobIds, setAppliedJobIds] = useState([])

  // Recherche client-side
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  // Filtre source
  const [selectedSources, setSelectedSources] = useState(new Set(ALL_SOURCES))
  const [sourceDropOpen, setSourceDropOpen] = useState(false)
  const sourceDropRef = useRef(null)

  // Filtre état
  const [etatFilter, setEtatFilter] = useState('all')

  // Gear dropdown — keywords API par utilisateur
  const [gearOpen, setGearOpen] = useState(false)
  const [apiKeywords, setApiKeywords] = useState('')
  const [userKeywords, setUserKeywords] = useState([])
  const [gearSaving, setGearSaving] = useState(false)
  const [gearSaved, setGearSaved] = useState(false)
  const gearRef = useRef(null)

  // Charger les offres en temps réel
  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('addedAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setJobsLoading(false)
    })
    return unsub
  }, [])

  // Charger le profil utilisateur (offres postulées + keywords API)
  useEffect(() => {
    if (!workspaceName) return
    const userRef = doc(db, 'users', workspaceName)
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setAppliedJobIds(snap.data().appliedJobIds ?? [])
        const kws = snap.data().searchKeywords ?? []
        setUserKeywords(kws)
        setApiKeywords(kws.join(', '))
      } else {
        setDoc(userRef, { appliedJobIds: [], searchKeywords: [] })
      }
    })
    return unsub
  }, [workspaceName])

  // Fermer le source dropdown au clic extérieur
  useEffect(() => {
    if (!sourceDropOpen) return
    function handleClickOutside(e) {
      if (sourceDropRef.current && !sourceDropRef.current.contains(e.target)) {
        setSourceDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [sourceDropOpen])

  // Fermer le gear panel au clic extérieur ou Escape
  useEffect(() => {
    if (!gearOpen) return
    function handleClickOutside(e) {
      if (gearRef.current && !gearRef.current.contains(e.target)) {
        setGearOpen(false)
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setGearOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [gearOpen])

  async function handleMarkApplied(jobId) {
    const userRef = doc(db, 'users', workspaceName)
    await updateDoc(userRef, { appliedJobIds: arrayUnion(jobId) })
  }

  async function handleSaveApiKeywords() {
    setGearSaving(true)
    setGearSaved(false)
    const userRef = doc(db, 'users', workspaceName)
    const keywordsList = apiKeywords.split(',').map((k) => k.trim()).filter(Boolean)
    await setDoc(userRef, { searchKeywords: keywordsList }, { merge: true })
    setGearSaving(false)
    setGearSaved(true)
    setTimeout(() => setGearSaved(false), 3000)
  }

  function handleSearch() {
    setActiveSearch(searchQuery.trim())
  }

  // Filtres client-side
  function matchesSearch(job) {
    if (!activeSearch) return true
    const term = activeSearch.toLowerCase()
    return (
      job.title?.toLowerCase().includes(term) ||
      job.company?.toLowerCase().includes(term)
    )
  }

  function matchesUserKeywords(job) {
    if (!job.keyword || userKeywords.length === 0) return true
    return userKeywords.some((kw) => kw.toLowerCase() === job.keyword.toLowerCase())
  }

  function matchesSource(job) {
    if (selectedSources.size === 0 || selectedSources.size === ALL_SOURCES.length) return true
    return selectedSources.has(job.source)
  }

  const notApplied = jobs.filter((j) => !appliedJobIds.includes(j.id))
  const applied = jobs.filter((j) => appliedJobIds.includes(j.id))
  const filteredNotApplied = notApplied.filter((j) => matchesUserKeywords(j) && matchesSearch(j) && matchesSource(j))
  const filteredApplied = applied.filter((j) => matchesUserKeywords(j) && matchesSearch(j) && matchesSource(j))

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">Candidator</span>
          {!jobsLoading && (
            <span className="header-count">
              {activeSearch
                ? `${filteredNotApplied.length} résultat${filteredNotApplied.length !== 1 ? 's' : ''}`
                : `${notApplied.length} offre${notApplied.length !== 1 ? 's' : ''} en attente`}
            </span>
          )}
        </div>

        <div className="header-right">
          {/* Barre de recherche */}
          <div className="search-bar">
            <input
              className="search-input"
              type="text"
              placeholder="Rechercher…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn-search" onClick={handleSearch} aria-label="Rechercher">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="btn-search-label">Rechercher</span>
            </button>
          </div>

          {/* Gear — keywords API par utilisateur */}
          <div className="gear-dropdown" ref={gearRef}>
            <button
              className="btn-ghost btn-gear"
              onClick={() => setGearOpen((o) => !o)}
              aria-label="Paramètres"
            >
              ⚙
            </button>
            {gearOpen && (
              <div className="gear-panel">
                <div className="settings-field">
                  <label>Mots-clés API</label>
                  <input
                    type="text"
                    value={apiKeywords}
                    onChange={(e) => setApiKeywords(e.target.value)}
                    placeholder="Product Owner, Business Analyst"
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
                  <button
                    className="btn-save"
                    onClick={handleSaveApiKeywords}
                    disabled={gearSaving}
                  >
                    {gearSaving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  {gearSaved && (
                    <span className="settings-success">✓ Enregistré</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <span className="header-workspace">
            Espace : <strong>{workspaceName}</strong>
          </span>
          <button className="btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </header>

      <main className="app-main">
        {jobsLoading ? (
          <div className="jobs-empty">
            <p>Chargement des offres…</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="jobs-empty">
            <p>Aucune offre pour le moment</p>
            <p>
              Les offres sont ajoutées automatiquement chaque jour à 7h.
              Vous pouvez aussi déclencher manuellement le workflow GitHub Actions.
            </p>
          </div>
        ) : (
          <>
            {/* Barre de filtres */}
            <div className="filter-bar">
              <div className="source-drop-wrapper" ref={sourceDropRef}>
                <button
                  className="btn-filter-source"
                  onClick={() => setSourceDropOpen((o) => !o)}
                >
                  Sources
                  {selectedSources.size < ALL_SOURCES.length && ` (${selectedSources.size}/${ALL_SOURCES.length})`}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {sourceDropOpen && (
                  <div className="source-drop-panel">
                    <label className="source-checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedSources.size === ALL_SOURCES.length}
                        onChange={() =>
                          setSelectedSources(
                            selectedSources.size === ALL_SOURCES.length ? new Set() : new Set(ALL_SOURCES)
                          )
                        }
                      />
                      Toutes les sources
                    </label>
                    {ALL_SOURCES.map((src) => (
                      <label key={src} className="source-checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedSources.has(src)}
                          onChange={() => {
                            const next = new Set(selectedSources)
                            next.has(src) ? next.delete(src) : next.add(src)
                            setSelectedSources(next)
                          }}
                        />
                        {SOURCE_LABELS[src]}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="etat-pills">
                {[['all', 'Toutes'], ['pending', 'En attente'], ['applied', 'Postulé']].map(([v, label]) => (
                  <button
                    key={v}
                    className={`pill${etatFilter === v ? ' pill-active' : ''}`}
                    onClick={() => setEtatFilter(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(etatFilter === 'all' || etatFilter === 'pending') && filteredNotApplied.length > 0 && (
              <>
                <div className="jobs-section-title">
                  À candidater ({filteredNotApplied.length})
                </div>
                <div className="jobs-list">
                  {filteredNotApplied.map((job) => (
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

            {(etatFilter === 'all' || etatFilter === 'applied') && filteredApplied.length > 0 && (
              <>
                <div className="jobs-section-title">
                  Déjà postulé ({filteredApplied.length})
                </div>
                <div className="jobs-list">
                  {filteredApplied.map((job) => (
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

            {filteredNotApplied.length === 0 && filteredApplied.length === 0 && (
              <div className="jobs-empty">
                <p>Aucun résultat</p>
                <p>Essayez de modifier les filtres ou la recherche.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
