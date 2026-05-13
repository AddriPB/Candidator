import { normalizeOffer } from '../normalizer/index.js'

export function listOffers(db, { verdict, status, limit = 100 } = {}) {
  const clauses = []
  const params = {}
  if (verdict && verdict !== 'all') {
    clauses.push('verdict = @verdict')
    params.verdict = verdict
  }
  if (status && status !== 'all') {
    clauses.push('status = @status')
    params.status = status
  }
  params.limit = Math.min(Number(limit) || 100, 300)
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`
    SELECT * FROM offers
    ${where}
    ORDER BY score DESC, published_at DESC, fetched_at DESC
    LIMIT @limit
  `).all(params).map(rowToOffer)
}

export function upsertOffer(db, rawOffer, scoring) {
  const offer = normalizeOffer(rawOffer)
  db.prepare(`
    INSERT INTO offers (
      source, source_offer_id, title, company, url, location, contract_type,
      salary_min, salary_max, salary_raw, remote_raw, description, published_at,
      fetched_at, score, verdict, why, positive_signals, negative_signals,
      missing_data, proposed_action, updated_at
    )
    VALUES (
      @source, @sourceOfferId, @title, @company, @url, @location, @contractType,
      @salaryMin, @salaryMax, @salaryRaw, @remoteRaw, @description, @publishedAt,
      @fetchedAt, @score, @verdict, @why, @positiveSignals, @negativeSignals,
      @missingData, @proposedAction, CURRENT_TIMESTAMP
    )
    ON CONFLICT(source, source_offer_id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      url = excluded.url,
      location = excluded.location,
      contract_type = excluded.contract_type,
      salary_min = excluded.salary_min,
      salary_max = excluded.salary_max,
      salary_raw = excluded.salary_raw,
      remote_raw = excluded.remote_raw,
      description = excluded.description,
      published_at = excluded.published_at,
      fetched_at = excluded.fetched_at,
      score = excluded.score,
      verdict = excluded.verdict,
      why = excluded.why,
      positive_signals = excluded.positive_signals,
      negative_signals = excluded.negative_signals,
      missing_data = excluded.missing_data,
      proposed_action = excluded.proposed_action,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    ...offer,
    score: scoring.score,
    verdict: scoring.verdict,
    why: scoring.why,
    positiveSignals: JSON.stringify(scoring.positiveSignals),
    negativeSignals: JSON.stringify(scoring.negativeSignals),
    missingData: JSON.stringify(scoring.missingData),
    proposedAction: scoring.proposedAction,
  })
}

export function markOfferStatus(db, id, status) {
  db.prepare('UPDATE offers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id)
  if (status === 'applied') {
    db.prepare('INSERT INTO applications (offer_id, status) VALUES (?, ?)').run(id, 'sent')
  }
  return db.prepare('SELECT * FROM offers WHERE id = ?').get(id)
}

export function saveRawOffer(db, scanRunId, keyword, offer) {
  const normalized = normalizeOffer(offer)
  db.prepare(`
    INSERT INTO raw_offers (scan_run_id, source, source_offer_id, keyword, payload_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, source_offer_id) DO UPDATE SET
      scan_run_id = excluded.scan_run_id,
      keyword = excluded.keyword,
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run(scanRunId, normalized.source, normalized.sourceOfferId, keyword, JSON.stringify(offer), normalized.fetchedAt)
  return normalized
}

export function rowToOffer(row) {
  return {
    id: row.id,
    source: row.source,
    sourceOfferId: row.source_offer_id,
    title: row.title,
    company: row.company,
    url: row.url,
    location: row.location,
    contractType: row.contract_type,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryRaw: row.salary_raw,
    remoteRaw: row.remote_raw,
    description: row.description,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    score: row.score,
    verdict: row.verdict,
    why: row.why,
    positiveSignals: parseJson(row.positive_signals),
    negativeSignals: parseJson(row.negative_signals),
    missingData: parseJson(row.missing_data),
    proposedAction: row.proposed_action,
    status: row.status,
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value || '[]')
  } catch {
    return []
  }
}
