# Opportunity Radar

## Stack

- React 18 + Vite.
- Backend Node.js léger.
- SQLite local.
- PM2 sur Raspberry Pi 3B.
- Scheduler local via `/server/scheduler`.

## Runtime

- Mac : développement et build.
- Raspberry Pi : production légère.
- iPhone : consultation web privée.

## Auth

- Utilisateur unique.
- Mot de passe long dans `.env`.
- Session persistante via cookie HttpOnly.

## Sources API

- France Travail : P0.
- Adzuna : P1.
- JSearch : P2.
- Careerjet : P3, désactivable si l'API actuelle diverge.

## Fichiers clés

- `server/index.js` : API locale.
- `server/connectors/*` : connecteurs normalisés.
- `server/scorer` : scoring et verdicts.
- `server/storage/database.js` : schéma SQLite.
- `src/components/HomePage.jsx` : interface principale.
- `docs/deploiement-pi.md` : déploiement Raspberry Pi.
