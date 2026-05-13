const SOURCE_LABELS = {
  france_travail: 'France Travail',
  adzuna: 'Adzuna',
  jsearch: 'JSearch',
  careerjet: 'Careerjet',
}

export default function JobCard({ offer, onStatus }) {
  return (
    <article className={`offer-card verdict-${slug(offer.verdict)}`}>
      <div className="offer-topline">
        <span className="source-pill">{SOURCE_LABELS[offer.source] || offer.source}</span>
        <span className="score-pill">{offer.score}/100</span>
      </div>
      <h2>{offer.title}</h2>
      <div className="company-line">{offer.company} · {offer.location || 'Localisation inconnue'}</div>
      <div className="offer-facts">
        <span>{offer.contractType || 'Contrat ?'}</span>
        <span>{offer.remoteRaw || 'Télétravail ?'}</span>
        <span>{offer.salaryRaw || salaryRange(offer) || 'Salaire ?'}</span>
      </div>
      <div className="verdict-row">
        <strong>{offer.verdict}</strong>
        <span>{offer.why}</span>
      </div>
      <SignalList title="Signaux positifs" items={offer.positiveSignals} />
      <SignalList title="Signaux négatifs" items={offer.negativeSignals} />
      <SignalList title="Données manquantes" items={offer.missingData} />
      <p className="action-copy">{offer.proposedAction}</p>
      <div className="offer-actions">
        <a href={offer.url} target="_blank" rel="noreferrer">Voir l'offre</a>
        <button onClick={() => onStatus(offer.id, 'applied')} disabled={offer.status === 'applied'}>
          {offer.status === 'applied' ? 'Candidature notée' : 'Marquer candidaté'}
        </button>
        <button className="ghost" onClick={() => onStatus(offer.id, 'rejected')}>
          Rejeter
        </button>
      </div>
    </article>
  )
}

function SignalList({ title, items = [] }) {
  if (!items.length) return null
  return (
    <div className="signals">
      <span>{title}</span>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  )
}

function salaryRange(offer) {
  if (offer.salaryMin && offer.salaryMax) return `${offer.salaryMin} - ${offer.salaryMax} EUR`
  if (offer.salaryMin) return `Dès ${offer.salaryMin} EUR`
  if (offer.salaryMax) return `Jusqu'à ${offer.salaryMax} EUR`
  return ''
}

function slug(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\W+/g, '-')
}
