import { useState } from 'react'

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SOURCE_LABELS = {
  france_travail: 'France Travail',
  adzuna: 'Adzuna',
  jsearch: 'LinkedIn / Indeed',
  careerjet: 'Careerjet',
}

export default function JobCard({ job, isApplied, onMarkApplied }) {
  const [marking, setMarking] = useState(false)

  async function handleMarkApplied() {
    if (marking || isApplied) return
    setMarking(true)
    try {
      await onMarkApplied(job.id)
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className={`job-card${isApplied ? ' applied' : ''}`}>
      <div className="job-card-info">
        <div className="job-title">{job.title}</div>
        <div className="job-company">{job.company}</div>
        <div className="job-meta">
          <span className="job-source-badge">
            {SOURCE_LABELS[job.source] ?? job.source}
          </span>
          {job.addedAt && (
            <span className="job-date">Ajouté le {formatDate(job.addedAt)}</span>
          )}
          {job.salary && (
            <span className="job-salary">{job.salary}</span>
          )}
          {job.contactName && (
            <>
              <span className="job-contact-separator">·</span>
              <span className="job-contact">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                {job.contactName}
                {job.contactPhone && (
                  <> — <a href={`tel:${job.contactPhone}`}>{job.contactPhone}</a></>
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="job-card-actions">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-apply-link"
        >
          Postuler
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        {isApplied ? (
          <span className="applied-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Postulé
          </span>
        ) : (
          <button
            className="btn-mark-applied"
            onClick={handleMarkApplied}
            disabled={marking}
          >
            {marking ? 'Enregistrement…' : "J'ai postulé"}
          </button>
        )}
      </div>
    </div>
  )
}
