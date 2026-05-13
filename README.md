# Opportunity Radar

Opportunity Radar est un radar privé d'opportunités professionnelles.

Ce dépôt est en reconstruction. Il sert de base propre pour repartir sur la
nouvelle application Opportunity Radar, sans autre ligne produit à maintenir.

## État du dépôt

- Base React + Vite minimale.
- Aucune collecte, API, persistance ou automatisation active dans cette base.
- Les secrets, données runtime, builds locaux et dépendances installées restent
  hors Git.

## Commandes

```bash
npm install
npm run dev
npm run build
```

## Déploiement

La page GitHub Pages est publique. Elle doit être construite avec
`VITE_PUBLIC_API_BASE` si le backend est servi depuis une URL HTTPS séparée.

Le fichier `.env` complet reste sur le Pi et n'est pas publié sur GitHub.

## Règles

- Ne pas committer `.env`, secrets, tokens, bases locales, logs ou dossiers de
  build.
- Ne pas réintroduire de workflows de collecte GitHub Actions comme runtime.
- Garder le dépôt lisible et orienté uniquement Opportunity Radar.
