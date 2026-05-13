import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import JobCard from './JobCard'

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

export default function HomePage() {
  const { logout } = useAuth()
  const [offers, setOffers] = useState([])
  const [settings, setSettings] = useState(null)
  const [query, setQuery] = useState('')
  const [verdict, setVerdict] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scanState, setScanState] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [offersData, settingsData] = await Promise.all([
      api('/api/offers?limit=200'),
      api('/api/settings'),
    ])
    setOffers(offersData.offers)
    setSettings(settingsData.settings)
    setLoading(false)
  }

  async function saveSettings(event) {
    event.preventDefault()
    setSaving(true)
    const form = new FormData(event.currentTarget)
    const patch = {
      salaire_min: Number(form.get('salaire_min')),
      annees_experience: Number(form.get('annees_experience')),
      teletravail_min_jours: Number(form.get('teletravail_min_jours')),
      keywords: splitLines(form.get('keywords')),
      sources_actives: form.getAll('sources_actives'),
      blacklist_entreprises: splitLines(form.get('blacklist_entreprises')),
      blacklist_secteurs: splitLines(form.get('blacklist_secteurs')),
    }
    const data = await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })
    setSettings(data.settings)
    setSaving(false)
  }

  async function runScan() {
    setScanState('Scan en cours...')
    try {
      const data = await api('/api/scan', { method: 'POST' })
      setScanState(`${data.run.keptCount} offres conservées sur ${data.run.fetchedCount}`)
      await load()
    } catch (error) {
      setScanState(`Erreur scan: ${error.message}`)
    }
  }

  async function updateStatus(id, status) {
    await api(`/api/offers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
    setOffers((current) => current.map((offer) => offer.id === id ? { ...offer, status } : offer))
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return offers.filter((offer) => {
      const matchesVerdict = verdict === 'all' || offer.verdict === verdict
      const matchesQuery = !term || `${offer.title} ${offer.company} ${offer.location}`.toLowerCase().includes(term)
      return matchesVerdict && matchesQuery
    })
  }, [offers, query, verdict])

  const stats = useMemo(() => ({
    candidate: offers.filter((offer) => offer.verdict === 'à candidater').length,
    watch: offers.filter((offer) => offer.verdict === 'à surveiller').length,
    reject: offers.filter((offer) => offer.verdict === 'à rejeter').length,
  }), [offers])

  if (loading) return <div className="loading-screen">Chargement...</div>

  return (
    <main className="radar-shell">
      <header className="radar-header">
        <div>
          <div className="eyebrow">Radar privé</div>
          <h1>Opportunity Radar</h1>
          <p>PO / PM / BA / AMOA, CDI, IDF ou full remote France.</p>
        </div>
        <button className="secondary" onClick={logout}>Déconnexion</button>
      </header>

      <section className="metrics-grid">
        <Metric label="À candidater" value={stats.candidate} />
        <Metric label="À surveiller" value={stats.watch} />
        <Metric label="À rejeter" value={stats.reject} />
      </section>

      <section className="toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher titre, entreprise, lieu" />
        <select value={verdict} onChange={(event) => setVerdict(event.target.value)}>
          <option value="all">Tous les verdicts</option>
          <option value="à candidater">À candidater</option>
          <option value="à surveiller">À surveiller</option>
          <option value="à rejeter">À rejeter</option>
        </select>
        <button onClick={runScan}>Scanner maintenant</button>
      </section>
      {scanState && <div className="scan-state">{scanState}</div>}

      <section className="settings-panel">
        <h2>Paramètres</h2>
        <form onSubmit={saveSettings}>
          <label>Salaire minimum <input name="salaire_min" type="number" defaultValue={settings.salaire_min} /></label>
          <label>Années d'expérience <input name="annees_experience" type="number" defaultValue={settings.annees_experience} /></label>
          <label>Télétravail min. jours <input name="teletravail_min_jours" type="number" defaultValue={settings.teletravail_min_jours} /></label>
          <label>Keywords <textarea name="keywords" defaultValue={settings.keywords.join('\n')} /></label>
          <fieldset>
            <legend>Sources actives</legend>
            {['france_travail', 'adzuna', 'jsearch', 'careerjet'].map((source) => (
              <label key={source} className="checkbox-row">
                <input name="sources_actives" type="checkbox" value={source} defaultChecked={settings.sources_actives.includes(source)} />
                {source}
              </label>
            ))}
          </fieldset>
          <label>Blacklist entreprises <textarea name="blacklist_entreprises" defaultValue={settings.blacklist_entreprises.join('\n')} /></label>
          <label>Blacklist secteurs <textarea name="blacklist_secteurs" defaultValue={settings.blacklist_secteurs.join('\n')} /></label>
          <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
        </form>
      </section>

      <section className="offers-list">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucune offre ne correspond aux filtres.</div>
        ) : filtered.map((offer) => (
          <JobCard key={offer.id} offer={offer} onStatus={updateStatus} />
        ))}
      </section>
    </main>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function splitLines(value) {
  return String(value || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean)
}
