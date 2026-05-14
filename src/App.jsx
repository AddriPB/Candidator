import { useEffect, useMemo, useState } from 'react'

const API_BASE = String(import.meta.env.VITE_PUBLIC_API_BASE || '').replace(/\/$/, '')
const SESSION_TOKEN_KEY = 'opportunity_radar_session_token'
const ROLE_FILTERS = [
  { value: 'all', label: 'Tous les postes', terms: [] },
  { value: 'po', label: 'PO / Product Owner', terms: ['po', 'product owner'] },
  { value: 'pm', label: 'PM / Product Manager', terms: ['pm', 'product manager'] },
  { value: 'ba', label: 'BA / Business Analyst', terms: ['ba', 'business analyst'] },
  { value: 'proxy-po', label: 'Proxy PO / Proxy Product Owner', terms: ['proxy po', 'proxy product owner'] },
  { value: 'chef-projet-digital', label: 'Chef de projet digital', terms: ['chef de projet digital'] },
  { value: 'amoa', label: 'AMOA / Consultant AMOA', terms: ['amoa', 'consultant amoa'] },
  { value: 'moa', label: 'MOA / Consultant MOA', terms: ['moa', 'consultant moa'] },
]

export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [view, setView] = useState(currentView())
  const [offers, setOffers] = useState([])
  const [offersRunAt, setOffersRunAt] = useState(null)
  const [offersLoading, setOffersLoading] = useState(false)
  const [offersError, setOffersError] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [checks, setChecks] = useState([])
  const [checksRunAt, setChecksRunAt] = useState(null)
  const [checksLoading, setChecksLoading] = useState(false)
  const [checksError, setChecksError] = useState('')

  const api = useMemo(() => createApi(API_BASE), [])
  const filteredOffers = useMemo(
    () => filterOffersByRole(offers, ROLE_FILTERS.find((filter) => filter.value === roleFilter)),
    [offers, roleFilter],
  )

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => {
        clearSessionToken()
        setAuthenticated(false)
      })
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => {
    const onPopState = () => setView(currentView())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!authenticated) return
    loadOffers()
  }, [authenticated])

  async function login(event) {
    event.preventDefault()
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: String(form.get('username') || '').trim(),
          password: form.get('password'),
        }),
      })
      saveSessionToken(data.token)
      setAuthenticated(true)
      setMessage('Connexion active.')
      navigate('offers')
    } catch (error) {
      setMessage(loginErrorMessage(error))
    }
  }

  async function loadOffers() {
    setOffersLoading(true)
    setOffersError('')
    try {
      const data = await api('/api/offers')
      setOffers(data.offers || [])
      setOffersRunAt(data.startedAt || null)
    } catch (error) {
      if (handleAuthError(error)) return
      setOffersError(apiErrorMessage(error, 'Impossible de charger les offres.'))
    } finally {
      setOffersLoading(false)
    }
  }

  async function runSourceCheck() {
    setChecksLoading(true)
    setChecksError('')
    setMessage('Test des sources en cours...')
    try {
      const data = await api('/api/source-check', { method: 'POST' })
      setChecks(data.checks || [])
      setChecksRunAt(data.checkedAt || null)
      setMessage('Test terminé.')
    } catch (error) {
      if (handleAuthError(error)) return
      const errorMessage = apiErrorMessage(error, 'Impossible de tester les sources.')
      setChecksError(errorMessage)
    } finally {
      setChecksLoading(false)
    }
  }

  function handleAuthError(error) {
    if (!(error instanceof ApiError) || error.status !== 401) return false
    clearSessionToken()
    setAuthenticated(false)
    setMessage('Session expirée. Reconnecte-toi pour relancer le test.')
    return true
  }

  function navigate(nextView) {
    const basePath = window.location.pathname.startsWith('/Opportunity-Radar') ? '/Opportunity-Radar' : ''
    const nextPath = nextView === 'test' ? `${basePath}/test` : `${basePath}/`
    window.history.pushState({}, '', nextPath)
    setView(nextView)
  }

  if (loading) return <main className="page"><section className="panel">Chargement...</section></main>

  return (
    <main className={authenticated ? 'app-shell' : 'page'}>
      <section className={authenticated ? 'app-panel' : 'panel'}>
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
          <>
            <nav className="tabs" aria-label="Navigation principale">
              <button className={view === 'offers' ? 'active' : ''} type="button" onClick={() => navigate('offers')}>
                Offres
              </button>
              <button className={view === 'test' ? 'active' : ''} type="button" onClick={() => navigate('test')}>
                Test
              </button>
            </nav>

            {view === 'test' ? (
              <TestScreen
                checks={checks}
                checksError={checksError}
                checksLoading={checksLoading}
                checksRunAt={checksRunAt}
                onRunSourceCheck={runSourceCheck}
              />
            ) : (
              <OffersScreen
                filteredOffers={filteredOffers}
                offers={offers}
                offersError={offersError}
                offersLoading={offersLoading}
                offersRunAt={offersRunAt}
                onRefresh={loadOffers}
                roleFilter={roleFilter}
                setRoleFilter={setRoleFilter}
              />
            )}
          </>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </main>
  )
}

function OffersScreen({ filteredOffers, offers, offersError, offersLoading, offersRunAt, onRefresh, roleFilter, setRoleFilter }) {
  return (
    <div className="stack">
      <div className="toolbar">
        <label>
          Poste
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            {ROLE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onRefresh}>Actualiser</button>
      </div>

      <div className="summary">
        <strong>{filteredOffers.length}</strong>
        <span>offre{filteredOffers.length > 1 ? 's' : ''} affichée{filteredOffers.length > 1 ? 's' : ''}</span>
        {offersRunAt && <span>Dernier run : {formatDateTime(offersRunAt)}</span>}
      </div>

      {offersError && <div className="error">{offersError}</div>}

      {offersLoading ? (
        <p>Chargement des offres...</p>
      ) : offers.length === 0 ? (
        <div className="empty">Aucune offre disponible dans le dernier résultat d'API.</div>
      ) : filteredOffers.length === 0 ? (
        <div className="empty">Aucune offre ne correspond à ce filtre.</div>
      ) : (
        <div className="offer-list">
          {filteredOffers.map((offer) => (
            <article className="offer" key={offer.id}>
              <div>
                <h2>{offer.title || 'Poste sans titre'}</h2>
                <p>{offer.company || 'Entreprise non renseignée'} · {offer.location || 'Lieu non renseigné'}</p>
              </div>
              <div className="meta">
                <span>{formatSources(offer)}</span>
                {formatOfferDate(offer) && <span>{formatOfferDate(offer)}</span>}
                {offer.verdict && <span>{offer.verdict}</span>}
                {Number.isFinite(offer.score) && <span>{offer.score}/100</span>}
                {offer.remote && <span>{offer.remote}</span>}
                {formatSalary(offer) && <span>{formatSalary(offer)}</span>}
              </div>
              {offer.link && <a href={offer.link} target="_blank" rel="noreferrer">Voir l'offre</a>}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function TestScreen({ checks, checksError, checksLoading, checksRunAt, onRunSourceCheck }) {
  return (
    <div className="stack">
      <button type="button" onClick={onRunSourceCheck} disabled={checksLoading}>
        {checksLoading ? 'Test en cours...' : 'Tester les API emploi'}
      </button>
      {checksRunAt && <p>Dernier test : {formatDateTime(checksRunAt)}</p>}
      {checksError && <div className="error">{checksError}</div>}
      <div className="checks">
        {checks.map((check) => (
          <div className={`check ${check.ok ? 'ok' : 'fail'}`} key={check.source}>
            <strong>{check.source}</strong>
            <span>{check.ok ? 'OK' : 'Échec'}</span>
            {check.detail && <small>{check.detail}</small>}
          </div>
        ))}
      </div>
    </div>
  )
}

function createApi(apiBase) {
  return async function api(path, options = {}) {
    let res
    const token = readSessionToken()
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      res = await fetch(`${apiBase}${path}`, {
        ...options,
        credentials: 'include',
        headers,
      })
    } catch (error) {
      throw new ApiError('network', { cause: error })
    }
    const data = await readResponseBody(res)
    if (!res.ok) throw new ApiError('http', { status: res.status, statusText: res.statusText, data })
    return data
  }
}

function saveSessionToken(token) {
  if (!token) return
  try {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token)
  } catch {
    // The HttpOnly cookie remains the fallback when localStorage is unavailable.
  }
}

function readSessionToken() {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

function clearSessionToken() {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  const text = await res.text()
  return text ? { message: text } : null
}

function currentView() {
  return window.location.pathname.endsWith('/test') ? 'test' : 'offers'
}

function filterOffersByRole(offers, filter) {
  if (!filter || filter.value === 'all') return offers
  return offers.filter((offer) => {
    const text = normalizeSearchText([offer.title, offer.query, offer.description].join(' '))
    return filter.terms.some((term) => matchesRoleTerm(text, term))
  })
}

function matchesRoleTerm(text, term) {
  const normalizedTerm = normalizeSearchText(term)
  if (normalizedTerm.length <= 4) return new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`).test(text)
  return text.includes(normalizedTerm)
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatOfferDate(offer) {
  const value = offer.publishedAt || offer.collectedAt
  if (!value) return ''
  return formatDateTime(value)
}

function formatSources(offer) {
  const sources = Array.isArray(offer.sources) && offer.sources.length > 0 ? offer.sources : [offer.source].filter(Boolean)
  return sources.length > 0 ? sources.join(', ') : 'Source inconnue'
}

function formatSalary(offer) {
  const currency = offer.currency || 'EUR'
  if (offer.salaryMin && offer.salaryMax) return `${formatMoney(offer.salaryMin, currency)} - ${formatMoney(offer.salaryMax, currency)}`
  if (offer.salaryMin) return `${formatMoney(offer.salaryMin, currency)} min.`
  if (offer.salaryMax) return `${formatMoney(offer.salaryMax, currency)} max.`
  return ''
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function loginErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) return 'Identifiant ou mot de passe incorrect.'
  if (error instanceof ApiError && error.kind === 'network') return 'API injoignable.'
  return 'Connexion impossible.'
}

function apiErrorMessage(error, fallback) {
  if (!(error instanceof ApiError)) return fallback
  if (error.kind === 'network') {
    const target = API_BASE || window.location.origin
    return `${fallback} Erreur réseau ou CORS vers ${target}. Vérifie VITE_PUBLIC_API_BASE et CORS_ORIGINS.`
  }
  const backendMessage = extractBackendMessage(error.data)
  return `${fallback} HTTP ${error.status}${backendMessage ? ` - ${backendMessage}` : ''}`
}

function extractBackendMessage(data) {
  if (!data || typeof data !== 'object') return ''
  return String(data.message || data.error || data.detail || '').trim()
}

class ApiError extends Error {
  constructor(kind, options = {}) {
    super(kind === 'http' ? `HTTP ${options.status}` : 'Network error', options)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
    this.statusText = options.statusText
    this.data = options.data
  }
}
