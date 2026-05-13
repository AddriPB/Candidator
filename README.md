# Opportunity Radar

Radar privé d'opportunités professionnelles PO / PM / BA / AMOA / chef de projet digital.

## V1

- Backend Node.js léger.
- SQLite local dans `/data`.
- Interface React/Vite mobile-first.
- Auth utilisateur unique par mot de passe long + session cookie.
- PM2 sur Raspberry Pi 3B.
- Scheduler local, GitHub Actions non utilisées comme runtime.
- Sources : France Travail, Adzuna, JSearch, Careerjet.

## Commandes

```bash
npm ci
cp .env.example .env
npm run db:init
npm run build
npm start
```

Développement Mac :

```bash
npm run dev
```

Scan manuel :

```bash
npm run scan:once
```

Tests :

```bash
npm test
```

## Variables d'environnement

Voir `.env.example`. Les secrets restent uniquement dans `.env`.

## Scoring

- Rémunération : 40 points.
- Télétravail : 30 points.
- Adéquation rôle : 20 points.
- Qualité opportunité : 10 points.

Verdicts :

- `à candidater`
- `à surveiller`
- `à rejeter`

## Déploiement

Voir [docs/deploiement-pi.md](docs/deploiement-pi.md).
