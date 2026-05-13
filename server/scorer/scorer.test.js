import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreOffer } from './index.js'
import { DEFAULT_SETTINGS } from '../settings/index.js'

test('scores a strong product owner opportunity as candidate-worthy', () => {
  const result = scoreOffer({
    title: 'Product Owner confirmé',
    company: 'Example',
    url: 'https://example.test/job',
    location: 'Paris',
    contractType: 'CDI',
    salaryMin: 60000,
    salaryMax: 70000,
    remoteRaw: '3 jours télétravail',
    description: 'Product Owner avec cadrage métier, backlog, discovery et delivery produit. '.repeat(8),
    publishedAt: '2026-05-13',
  }, DEFAULT_SETTINGS, { negatives: [] })

  assert.equal(result.verdict, 'à candidater')
  assert.ok(result.score >= 75)
})
