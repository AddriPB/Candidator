import { useEffect, useMemo, useState } from 'react'

const API_BASE = String(import.meta.env.VITE_PUBLIC_API_BASE || '').replace(/\/$/, '')
const SESSION_TOKEN_KEY = 'opportunity_radar_session_token'
const SELECTED_PROFILE_KEY = 'opportunity_radar_selected_profile'
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
const APPLICATION_STATUS_FILTERS = [
  { value: 'to-apply', label: 'À candidater' },
  { value: 'applied', label: 'Candidatées' },
  { value: 'all', label: 'Toutes' },
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
  const [applicationStatusFilter, setApplicationStatusFilter] = useState('to-apply')
  const [checks, setChecks] = useState([])
  const [checksRunAt, setChecksRunAt] = useState(null)
  const [checksLoading, setChecksLoading] = useState(false)
  const [checksError, setChecksError] = useState('')
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState('')
  const [testEmailLoading, setTestEmailLoading] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState(null)
  const [testEmailError, setTestEmailError] = useState('')
  const [cvState, setCvState] = useState(null)
  const [profileState, setProfileState] = useState(null)
  const [cvLoading, setCvLoading] = useState(false)
  const [cvError, setCvError] = useState('')
  const [cvUploading, setCvUploading] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(readSelectedProfile())
  const [profileToggleLoading, setProfileToggleLoading] = useState(false)
  const [profileToggleError, setProfileToggleError] = useState('')

  const api = useMemo(() => createApi(API_BASE), [])
  const roleFilteredOffers = useMemo(
    () => filterOffersByRole(offers, ROLE_FILTERS.find((filter) => filter.value === roleFilter)),
    [offers, roleFilter],
  )
  const filteredOffers = useMemo(
    () => filterOffersByApplicationStatus(roleFilteredOffers, applicationStatusFilter),
    [roleFilteredOffers, applicationStatusFilter],
  )
  const visibleCvState = profileState?.mode === 'multi' && cvState?.pseudo !== selectedProfile ? null : cvState

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
    loadProfiles()
  }, [authenticated])

  useEffect(() => {
    if (!authenticated || !isProfileReady(profileState, selectedProfile)) return
    loadOffers()
  }, [authenticated, profileState?.mode, selectedProfile])

  useEffect(() => {
    if (!authenticated || view !== 'cv' || !isProfileReady(profileState, selectedProfile)) return
    loadCv()
  }, [authenticated, view, profileState?.mode, selectedProfile])

  useEffect(() => {
    if (!authenticated || view !== 'test' || !isProfileReady(profileState, selectedProfile)) return
    loadHealthcheck()
  }, [authenticated, view, profileState?.mode, selectedProfile])

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
      const data = await api(`/api/offers${profileState?.mode === 'multi' ? profileQuery(selectedProfile) : ''}`)
      setOffers(data.offers || [])
      setOffersRunAt(data.startedAt || null)
    } catch (error) {
      if (handleAuthError(error)) return
      setOffersError(apiErrorMessage(error, 'Impossible de charger les offres.'))
    } finally {
      setOffersLoading(false)
    }
  }

  async function loadProfiles() {
    try {
      const data = await api('/api/profiles')
      setProfileState(data)
      if (data.mode === 'multi') {
        const pseudos = new Set((data.profiles || []).map((profile) => profile.pseudo))
        const nextProfile = pseudos.has(selectedProfile) ? selectedProfile : data.profiles?.[0]?.pseudo || ''
        updateSelectedProfile(nextProfile)
      }
    } catch (error) {
      if (handleAuthError(error)) return
      setProfileState(null)
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

  async function loadHealthcheck() {
    setHealthLoading(true)
    setHealthError('')
    try {
      const data = await api(`/api/test/healthcheck${profileState?.mode === 'multi' ? profileQuery(selectedProfile) : ''}`)
      setHealth(data)
    } catch (error) {
      if (handleAuthError(error)) return
      setHealthError(apiErrorMessage(error, 'Impossible de charger le healthcheck.'))
    } finally {
      setHealthLoading(false)
    }
  }

  async function sendApplicationTestEmail(to) {
    setTestEmailLoading(true)
    setTestEmailError('')
    setTestEmailResult(null)
    try {
      const data = await api('/api/test/application-email', {
        method: 'POST',
        body: JSON.stringify({ to, profilePseudo: profileState?.mode === 'multi' ? selectedProfile : '' }),
      })
      setTestEmailResult(data)
      setMessage(`Mail test envoyé à ${data.to}.`)
      loadHealthcheck()
    } catch (error) {
      if (handleAuthError(error)) return
      setTestEmailError(apiErrorMessage(error, 'Impossible d’envoyer le mail test.'))
    } finally {
      setTestEmailLoading(false)
    }
  }

  async function loadCv() {
    setCvLoading(true)
    setCvError('')
    try {
      const data = await api(`/api/cv${profileState?.mode === 'multi' ? profileQuery(selectedProfile) : ''}`)
      setCvState(data)
    } catch (error) {
      if (handleAuthError(error)) return
      setCvError(apiErrorMessage(error, 'Impossible de charger les CV.'))
    } finally {
      setCvLoading(false)
    }
  }

  async function uploadCv(file) {
    if (!file) return
    setCvUploading(true)
    setCvError('')
    try {
      const data = await uploadFile(`${API_BASE}/api/cv/upload${profileState?.mode === 'multi' ? profileQuery(selectedProfile) : ''}`, file)
      setCvState(data)
      setMessage('CV importé et défini comme actif.')
    } catch (error) {
      if (handleAuthError(error)) return
      setCvError(apiErrorMessage(error, 'Impossible d’importer le CV.'))
    } finally {
      setCvUploading(false)
    }
  }

  async function setActiveCv(fileName) {
    setCvLoading(true)
    setCvError('')
    try {
      const data = await api('/api/cv/active', {
        method: 'POST',
        body: JSON.stringify({ fileName, profilePseudo: profileState?.mode === 'multi' ? selectedProfile : '' }),
      })
      setCvState(data)
      setMessage('CV actif mis à jour.')
    } catch (error) {
      if (handleAuthError(error)) return
      setCvError(apiErrorMessage(error, 'Impossible de sélectionner le CV actif.'))
    } finally {
      setCvLoading(false)
    }
  }

  async function saveCvApplicationMail(applicationMail) {
    setCvLoading(true)
    setCvError('')
    try {
      const data = await api('/api/cv/application-mail', {
        method: 'POST',
        body: JSON.stringify({ ...applicationMail, profilePseudo: profileState?.mode === 'multi' ? selectedProfile : '' }),
      })
      setCvState(data)
      setMessage('Texte de candidature mis à jour.')
    } catch (error) {
      if (handleAuthError(error)) return
      setCvError(apiErrorMessage(error, 'Impossible d’enregistrer le texte de candidature.'))
    } finally {
      setCvLoading(false)
    }
  }

  async function setAutomaticApplicationsEnabled(profilePseudo, type, enabled) {
    const pseudo = String(profilePseudo || '').trim()
    if (!pseudo) return
    setProfileToggleLoading(true)
    setProfileToggleError('')
    try {
      const profile = await api(`/api/profiles/${encodeURIComponent(pseudo)}/automatic-applications`, {
        method: 'POST',
        body: JSON.stringify({ type, enabled }),
      })
      setProfileState((current) => updateProfileSummary(current, profile))
      const label = type === 'spontaneous' ? 'candidatures spontanées' : 'candidatures sur offres'
      setMessage(enabled ? `Envoi automatique activé pour les ${label}.` : `Envoi automatique désactivé pour les ${label}.`)
      if (view === 'test') loadHealthcheck()
    } catch (error) {
      if (handleAuthError(error)) return
      setProfileToggleError(apiErrorMessage(error, 'Impossible de modifier l’envoi automatique.'))
    } finally {
      setProfileToggleLoading(false)
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
    const nextPath = nextView === 'test' ? `${basePath}/test` : nextView === 'cv' ? `${basePath}/cv` : `${basePath}/`
    window.history.pushState({}, '', nextPath)
    setView(nextView)
  }

  function updateSelectedProfile(pseudo) {
    const value = String(pseudo || '').trim()
    setSelectedProfile(value)
    setRoleFilter('all')
    setOffers([])
    setCvState(null)
    setHealth(null)
    setOffersError('')
    setCvError('')
    setHealthError('')
    setProfileToggleError('')
    saveSelectedProfile(value)
  }

  if (loading) return <main className="page"><section className="panel">Chargement...</section></main>

  return (
    <main className={authenticated ? 'app-shell' : 'page'}>
      <section className={authenticated ? 'app-panel' : 'panel'}>
        <div className="app-header">
          <h1>Opportunity Radar</h1>
          {authenticated && (
            <ProfileSelector
              error={profileToggleError}
              loading={profileToggleLoading}
              profileState={profileState}
              selectedProfile={selectedProfile}
              onSelectProfile={updateSelectedProfile}
              onToggleAutomaticApplications={setAutomaticApplicationsEnabled}
            />
          )}
        </div>

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
              <button className={view === 'cv' ? 'active' : ''} type="button" onClick={() => navigate('cv')}>
                CV
              </button>
              <button className={view === 'test' ? 'active' : ''} type="button" onClick={() => navigate('test')}>
                Test
              </button>
            </nav>

            {view === 'cv' ? (
              <CvScreen
                apiBase={API_BASE}
                cvError={cvError}
                cvLoading={cvLoading}
                cvState={visibleCvState}
                cvUploading={cvUploading}
                selectedProfile={selectedProfile}
                onRefresh={loadCv}
                onSaveApplicationMail={saveCvApplicationMail}
                onSetActive={setActiveCv}
                onUpload={uploadCv}
              />
            ) : view === 'test' ? (
              <TestScreen
                checks={checks}
                checksError={checksError}
                checksLoading={checksLoading}
                checksRunAt={checksRunAt}
                health={health}
                healthError={healthError}
                healthLoading={healthLoading}
                onRefreshHealth={loadHealthcheck}
                onRunSourceCheck={runSourceCheck}
                onSendApplicationTestEmail={sendApplicationTestEmail}
                testEmailError={testEmailError}
                testEmailLoading={testEmailLoading}
                testEmailResult={testEmailResult}
              />
            ) : (
              <OffersScreen
                filteredOffers={filteredOffers}
                offers={offers}
                offersError={offersError}
                offersLoading={offersLoading}
                offersRunAt={offersRunAt}
                onRefresh={loadOffers}
                applicationStatusFilter={applicationStatusFilter}
                roleFilter={roleFilter}
                roleFilteredOffers={roleFilteredOffers}
                setApplicationStatusFilter={setApplicationStatusFilter}
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

function ProfileSelector({ error, loading, profileState, selectedProfile, onSelectProfile, onToggleAutomaticApplications }) {
  const profiles = profileState?.mode === 'multi' ? profileState.profiles || [] : []
  const selected = profileState?.mode === 'multi'
    ? profiles.find((profile) => profile.pseudo === selectedProfile)
    : null
  const active = selected || profileState?.active
  const label = active?.label || active?.pseudo || 'profil historique'
  const automaticOfferApplicationsEnabled = active?.automaticOfferApplicationsEnabled === true
  const automaticSpontaneousApplicationsEnabled = active?.automaticSpontaneousApplicationsEnabled === true

  if (profiles.length > 0) {
    return (
      <div className="profile-controls">
        <label className="profile-selector" title="Profil candidat appliqué à tous les écrans">
          <span>Profil actif</span>
          <select value={selectedProfile} onChange={(event) => onSelectProfile(event.target.value)}>
            {profiles.map((profile) => (
              <option key={profile.pseudo} value={profile.pseudo}>
                {profile.label || profile.pseudo}
              </option>
            ))}
          </select>
        </label>
        <ApplicationToggle
          checked={automaticOfferApplicationsEnabled}
          disabled={loading}
          label="Offres"
          offText="Offres désactivées"
          onText="Offres actives"
          onChange={(enabled) => onToggleAutomaticApplications(selectedProfile, 'offer', enabled)}
        />
        <ApplicationToggle
          checked={automaticSpontaneousApplicationsEnabled}
          disabled={loading}
          label="Spontanées"
          offText="Spontanées désactivées"
          onText="Spontanées actives"
          onChange={(enabled) => onToggleAutomaticApplications(selectedProfile, 'spontaneous', enabled)}
        />
        {error && <div className="profile-toggle-error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="profile-badge" title="Profil candidat utilisé pour les candidatures">
      <span>Profil actif</span>
      <strong>{label}</strong>
    </div>
  )
}

function ApplicationToggle({ checked, disabled, label, offText, onChange, onText }) {
  return (
    <label className="toggle-row" title={`${checked ? 'Désactive' : 'Active'} l’envoi automatique : ${label}`}>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span>
        <strong>{checked ? onText : offText}</strong>
        <small>{checked ? 'Le bot peut envoyer.' : 'Le bot n’envoie pas.'}</small>
      </span>
    </label>
  )
}

function updateProfileSummary(profileState, nextProfile) {
  if (profileState?.mode !== 'multi') return profileState
  return {
    ...profileState,
    profiles: (profileState.profiles || []).map((profile) => (
      profile.pseudo === nextProfile.pseudo ? { ...profile, ...nextProfile } : profile
    )),
  }
}

function OffersScreen({
  applicationStatusFilter,
  filteredOffers,
  offers,
  offersError,
  offersLoading,
  offersRunAt,
  onRefresh,
  roleFilter,
  roleFilteredOffers,
  setApplicationStatusFilter,
  setRoleFilter,
}) {
  const visibleOffersWithEmail = filteredOffers.filter((offer) => offer.hasEmail || offer.emails?.length).length
  const toApplyCount = roleFilteredOffers.filter((offer) => offer.applicationStatus !== 'candidatée').length
  const appliedCount = roleFilteredOffers.filter((offer) => offer.applicationStatus === 'candidatée').length

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
        <label>
          Catégorie
          <select value={applicationStatusFilter} onChange={(event) => setApplicationStatusFilter(event.target.value)}>
            {APPLICATION_STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onRefresh}>Actualiser</button>
      </div>

      <div className="summary">
        <strong>{filteredOffers.length}</strong>
        <span>offre{filteredOffers.length > 1 ? 's' : ''} affichée{filteredOffers.length > 1 ? 's' : ''}</span>
        <span>{toApplyCount} à candidater</span>
        <span>{appliedCount} candidatée{appliedCount > 1 ? 's' : ''}</span>
        <span>{visibleOffersWithEmail} avec email</span>
        {offersRunAt && <span>Dernier run : {formatDateTime(offersRunAt)}</span>}
      </div>

      {offersError && <div className="error">{offersError}</div>}

      {offersLoading ? (
        <p>Chargement des offres...</p>
      ) : offers.length === 0 ? (
        <div className="empty">Aucune offre enregistrée en base.</div>
      ) : filteredOffers.length === 0 ? (
        <div className="empty">Aucune offre ne correspond à ce filtre.</div>
      ) : (
        <div className="offer-list">
          {filteredOffers.map((offer) => (
            <article className="offer" key={offer.offerKey || offer.id}>
              <div className="offer-header">
                <div>
                  <h2>{offer.title || 'Poste sans titre'}</h2>
                  <p>{offer.company || 'Entreprise non renseignée'} · {offer.location || 'Lieu non renseigné'}</p>
                </div>
                <span className={`application-pill ${offer.applicationStatus === 'candidatée' ? 'applied' : 'to-apply'}`}>
                  {offer.applicationStatus === 'candidatée' ? 'Candidatée' : 'À candidater'}
                </span>
              </div>
              <div className="meta">
                <span>{formatSources(offer)}</span>
                {formatOfferDate(offer) && <span>{formatOfferDate(offer)}</span>}
                {offer.applicationLastSentAt && <span>Candidature : {formatDateTime(offer.applicationLastSentAt)}</span>}
                {offer.verdict && <span>{offer.verdict}</span>}
                {Number.isFinite(offer.score) && <span>{offer.score}/100</span>}
                {offer.remote && <span>{offer.remote}</span>}
                {formatSalary(offer) && <span>{formatSalary(offer)}</span>}
                <span>{formatEmailPresence(offer)}</span>
              </div>
              {offer.emails?.length > 0 && (
                <div className="emails" aria-label="Emails détectés">
                  {offer.emails.map((email) => (
                    <a key={email} href={`mailto:${email}`}>{email}</a>
                  ))}
                </div>
              )}
              <div className="offer-actions">
                {offer.link ? (
                  <a className="apply-link" href={offer.link} target="_blank" rel="noreferrer">
                    Postuler
                  </a>
                ) : (
                  <span className="missing-link">Lien direct indisponible</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function TestScreen({
  checks,
  checksError,
  checksLoading,
  checksRunAt,
  health,
  healthError,
  healthLoading,
  onRefreshHealth,
  onRunSourceCheck,
  onSendApplicationTestEmail,
  testEmailError,
  testEmailLoading,
  testEmailResult,
}) {
  const [testEmailTo, setTestEmailTo] = useState('')
  const testEmailDisabled = testEmailLoading || !testEmailTo.trim() || health?.applications?.profileOfferAutomaticEnabled === false

  function submitTestEmail(event) {
    event.preventDefault()
    onSendApplicationTestEmail(testEmailTo)
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <h2 className="section-title">Healthcheck</h2>
        <button type="button" disabled={healthLoading} onClick={onRefreshHealth}>
          {healthLoading ? 'Contrôle...' : 'Actualiser'}
        </button>
      </div>
      {healthError && <div className="error">{healthError}</div>}
      {health && (
        <div className="health-grid">
          <HealthCard title="Bot" ok={health.bot?.ok}>
            <span>PID : {health.bot?.pid || '-'}</span>
            <span>Uptime : {formatDuration(health.bot?.uptimeSeconds)}</span>
            <span>DB : {health.bot?.database || '-'}</span>
            <span>Port : {health.bot?.port || '-'}</span>
          </HealthCard>
          <HealthCard title="SMTP" ok={health.smtp?.ok}>
            <span>{health.smtp?.host || 'Hôte non renseigné'}</span>
            <span>From : {health.smtp?.from || '-'}</span>
            <span>User : {health.smtp?.user || '-'}</span>
            {health.smtp?.error && <small>{health.smtp.error}</small>}
          </HealthCard>
          <HealthCard title="CV" ok={health.cv?.ok && health.identity?.ok}>
            <span>{health.cv?.activeFile || 'CV actif manquant'}</span>
            <span>Prénom : {health.identity?.firstName ? 'OK' : 'manquant'}</span>
            <span>Nom : {health.identity?.lastName ? 'OK' : 'manquant'}</span>
            <span>Téléphone : {health.identity?.phone ? 'OK' : 'manquant'}</span>
          </HealthCard>
          <HealthCard title="Candidatures" ok={health.applications?.dailyEnabled}>
            <span>Offres : {health.applications?.profileOfferAutomaticEnabled ? 'actif' : 'désactivé'}</span>
            <span>Spontanées : {health.applications?.profileSpontaneousAutomaticEnabled ? 'actif' : 'désactivé'}</span>
            <span>Global : {health.applications?.globalDailyEnabled === false ? 'désactivé' : 'actif'}</span>
            <span>Mode : {health.applications?.deliveryMode || '-'}</span>
            <span>Redirection : {health.applications?.redirectTo || '-'}</span>
            <span>{health.applications?.offersWithEmail || 0} offre(s) avec email</span>
            <span>{health.applications?.eligibleToEmail || 0} éligible(s) à l’envoi</span>
          </HealthCard>
        </div>
      )}

      <form className="test-email-form" onSubmit={submitTestEmail}>
        <label>
          Envoyer un mail test
          <input
            autoComplete="email"
            inputMode="email"
            placeholder="adresse@email.fr"
            type="email"
            value={testEmailTo}
            onChange={(event) => setTestEmailTo(event.target.value)}
          />
        </label>
        <button type="submit" disabled={testEmailDisabled}>
          {testEmailLoading ? 'Envoi...' : 'Envoyer'}
        </button>
      </form>
      {health?.applications?.profileOfferAutomaticEnabled === false && (
        <div className="notice">Mail test désactivé pour ce profil tant que l’envoi automatique sur offres est coupé.</div>
      )}
      {testEmailError && <div className="error">{testEmailError}</div>}
      {testEmailResult && (
        <div className="notice">
          Mail test envoyé à {testEmailResult.to}. Objet : {testEmailResult.subject}
        </div>
      )}

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

function HealthCard({ title, ok, children }) {
  return (
    <div className={`health-card ${ok ? 'ok' : 'fail'}`}>
      <strong>{title}</strong>
      <span>{ok ? 'OK' : 'À vérifier'}</span>
      {children}
    </div>
  )
}

function CvScreen({
  apiBase,
  cvError,
  cvLoading,
  cvState,
  cvUploading,
  selectedProfile,
  onRefresh,
  onSaveApplicationMail,
  onSetActive,
  onUpload,
}) {
  const files = cvState?.files || []
  const activeFile = cvState?.activeFile || ''
  const [applicationMail, setApplicationMail] = useState(defaultApplicationMail())
  const previewTitle = 'PO / Product Owner'
  const previewSubject = renderApplicationMailTemplate(applicationMail.subjectTemplate, previewTitle)
  const previewBody = renderApplicationMailTemplate(applicationMail.bodyTemplate, previewTitle)

  useEffect(() => {
    if (!cvState?.applicationMail) return
    setApplicationMail({
      ...defaultApplicationMail(),
      ...cvState.applicationMail,
    })
  }, [cvState?.applicationMail])

  function updateApplicationMail(field, value) {
    setApplicationMail((current) => ({ ...current, [field]: value }))
  }

  function applyDefaultApplicationMail() {
    setApplicationMail((current) => ({
      ...current,
      subjectTemplate: defaultApplicationMailSubject(),
      bodyTemplate: defaultApplicationMailBody(current),
    }))
  }

  function submitApplicationMail(event) {
    event.preventDefault()
    const payload = hydrateApplicationMailIdentity(applicationMail)
    setApplicationMail(payload)
    onSaveApplicationMail(payload)
  }

  return (
    <div className="stack">
      <div className="toolbar cv-toolbar">
        <label>
          Importer un CV
          <input
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={cvUploading}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              onUpload(file)
            }}
          />
        </label>
        <button type="button" disabled={cvLoading || cvUploading} onClick={onRefresh}>
          Actualiser
        </button>
      </div>

      {cvState && (
        <div className="summary">
          <strong>{files.length}</strong>
          <span>CV stocké{files.length > 1 ? 's' : ''}</span>
          <span>Pseudo : {cvState.pseudo}</span>
          <span>Dossier : {cvState.storageDir}</span>
        </div>
      )}

      {activeFile && <div className="notice">CV actif : {activeFile}</div>}
      {cvError && <div className="error">{cvError}</div>}
      {cvLoading && !cvState ? <p>Chargement des CV...</p> : null}

      <form className="mail-editor" onSubmit={submitApplicationMail}>
        <div className="mail-editor-header">
          <div>
            <h2>Mail de candidature</h2>
            <p>Le placeholder [Intitulé du poste] sera remplacé par le titre de chaque annonce au moment de l’envoi.</p>
          </div>
          <button type="button" disabled={cvLoading} onClick={applyDefaultApplicationMail}>
            Remplir avec le modèle
          </button>
        </div>

        <div className="identity-grid">
          <label>
            Prénom
            <input
              autoComplete="given-name"
              value={applicationMail.firstName}
              onChange={(event) => updateApplicationMail('firstName', event.target.value)}
            />
          </label>
          <label>
            Nom
            <input
              autoComplete="family-name"
              value={applicationMail.lastName}
              onChange={(event) => updateApplicationMail('lastName', event.target.value)}
            />
          </label>
          <label>
            Téléphone
            <input
              autoComplete="tel"
              value={applicationMail.phone}
              onChange={(event) => updateApplicationMail('phone', event.target.value)}
            />
          </label>
        </div>

        <label>
          Objet du mail
          <input
            value={applicationMail.subjectTemplate}
            onChange={(event) => updateApplicationMail('subjectTemplate', event.target.value)}
          />
        </label>

        <label>
          Corps du mail
          <textarea
            rows={10}
            value={applicationMail.bodyTemplate}
            onChange={(event) => updateApplicationMail('bodyTemplate', event.target.value)}
          />
        </label>

        <div className="mail-save-row">
          <p>Aperçu avec un exemple. En envoi automatique, l’intitulé vient du titre de chaque annonce.</p>
          <button type="submit" disabled={cvLoading}>
            Enregistrer le mail
          </button>
        </div>

        <div className="mail-preview">
          <strong>{previewSubject}</strong>
          <pre>{previewBody}</pre>
        </div>
      </form>

      {!cvLoading && files.length === 0 ? (
        <div className="empty">Aucun CV trouvé dans le dossier du pseudo.</div>
      ) : (
        <div className="cv-list">
          {files.map((file) => (
            <article className={`cv-item ${file.name === activeFile ? 'active' : ''}`} key={file.name}>
              <div>
                <h2>{file.name}</h2>
                <p>{formatFileSize(file.size)} · Modifié le {formatDateTime(file.updatedAt)}</p>
              </div>
              <div className="cv-actions">
                {file.name === activeFile ? (
                  <span className="status-pill">Actif</span>
                ) : (
                  <button type="button" disabled={cvLoading || cvUploading} onClick={() => onSetActive(file.name)}>
                    Rendre actif
                  </button>
                )}
                <a href={`${apiBase}/api/cv/download/${encodeURIComponent(file.name)}${profileQuery(selectedProfile)}`} target="_blank" rel="noreferrer">
                  Télécharger
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
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

async function uploadFile(url, file) {
  const token = readSessionToken()
  const headers = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: await file.arrayBuffer(),
    })
  } catch (error) {
    throw new ApiError('network', { cause: error })
  }
  const data = await readResponseBody(res)
  if (!res.ok) throw new ApiError('http', { status: res.status, statusText: res.statusText, data })
  return data
}

function profileQuery(profilePseudo) {
  const value = String(profilePseudo || '').trim()
  return value ? `?profilePseudo=${encodeURIComponent(value)}` : ''
}

function isProfileReady(profileState, selectedProfile) {
  if (!profileState) return false
  return profileState.mode !== 'multi' || Boolean(String(selectedProfile || '').trim())
}

function saveSelectedProfile(pseudo) {
  try {
    if (pseudo) window.localStorage.setItem(SELECTED_PROFILE_KEY, pseudo)
    else window.localStorage.removeItem(SELECTED_PROFILE_KEY)
  } catch {
    // The selector still works for the current session when localStorage is unavailable.
  }
}

function readSelectedProfile() {
  try {
    return window.localStorage.getItem(SELECTED_PROFILE_KEY) || ''
  } catch {
    return ''
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
  if (window.location.pathname.endsWith('/test')) return 'test'
  if (window.location.pathname.endsWith('/cv')) return 'cv'
  return 'offers'
}

function filterOffersByRole(offers, filter) {
  if (!filter || filter.value === 'all') return offers
  return offers.filter((offer) => {
    const text = normalizeSearchText([offer.title, offer.query, offer.description].join(' '))
    return filter.terms.some((term) => matchesRoleTerm(text, term))
  })
}

function filterOffersByApplicationStatus(offers, filter) {
  if (filter === 'all') return offers
  if (filter === 'applied') return offers.filter((offer) => offer.applicationStatus === 'candidatée')
  return offers.filter((offer) => offer.applicationStatus !== 'candidatée')
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

function formatEmailPresence(offer) {
  const count = Array.isArray(offer.emails) ? offer.emails.length : 0
  if (!count) return 'Aucun email'
  return `${count} email${count > 1 ? 's' : ''}`
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatFileSize(value) {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 1,
  }).format(Number(value || 0) / 1024 / 1024) + ' Mo'
}

function formatDuration(seconds) {
  const value = Number(seconds || 0)
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}min`
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}min`
}

function defaultApplicationMail() {
  return {
    firstName: '',
    lastName: '',
    phone: '',
    titlePlaceholder: '[Intitulé du poste]',
    subjectTemplate: defaultApplicationMailSubject(),
    bodyTemplate: defaultApplicationMailBody({}),
  }
}

function defaultApplicationMailSubject() {
  return 'Candidature : [Intitulé du poste]'
}

function defaultApplicationMailBody({ firstName = '', lastName = '', phone = '' }) {
  const signature = [firstName, lastName].filter(Boolean).join(' ').trim() || '[Prénom Nom]'
  const contactPhone = String(phone || '').trim() || '[Téléphone]'
  return `Bonjour,

Je vous adresse ma candidature pour le poste de [Intitulé du poste].

Offre concernée : [URL de l’offre]

Vous trouverez mon CV en pièce jointe. Je suis disponible pour échanger par téléphone afin de vous présenter mon profil.

Vous pouvez me joindre au ${contactPhone}.

Bien cordialement,
${signature}`
}

function renderApplicationMailTemplate(template, title) {
  return String(template || '').replaceAll('[Intitulé du poste]', title)
}

function hydrateApplicationMailIdentity(applicationMail) {
  const signature = [applicationMail.firstName, applicationMail.lastName].filter(Boolean).join(' ').trim()
  return {
    ...applicationMail,
    bodyTemplate: String(applicationMail.bodyTemplate || '')
      .replaceAll('[Téléphone]', String(applicationMail.phone || '').trim() || '[Téléphone]')
      .replaceAll('[Prénom Nom]', signature || '[Prénom Nom]'),
  }
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
