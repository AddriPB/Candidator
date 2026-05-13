# AGENTS.md - Opportunity Radar

## Produit

Ce repo est maintenant **Opportunity Radar V1** : radar privé d'opportunités professionnelles PO / PM / BA / AMOA / chef de projet digital.

Le produit historique Candidator n'est plus à préserver comme produit séparé.

## Commandes

- Installer : `npm ci` si le lockfile est cohérent, sinon `npm install`.
- Dev Mac : `npm run dev`.
- Initialiser SQLite : `npm run db:init`.
- Scanner une fois : `npm run scan:once`.
- Build front : `npm run build`.
- Tests : `npm test`.
- Prod Pi : `npm start` via PM2, process `opportunity-radar`.

## Architecture cible

- `/server` : backend Node.js léger.
- `/server/connectors/*` : connecteurs API isolés.
- `/server/collector` : orchestration des scans.
- `/server/normalizer` : format commun des offres.
- `/server/filter` : exclusions métier.
- `/server/scorer` : scoring 100 points + verdict.
- `/server/tracker` : persistance offres/applications.
- `/server/settings` : paramètres utilisateur unique.
- `/server/auth` : auth mot de passe unique + cookie session.
- `/server/scheduler` : scheduler local Pi.
- `/server/storage` : SQLite et migrations.
- `/src` : interface React/Vite mobile-first.
- `/data` : base SQLite runtime, ignorée par Git.
- `/docs` : migration et déploiement.

## Contraintes Raspberry Pi 3B

- Cible prod : Raspberry Pi 3B, 1 Go RAM.
- Pas de Docker en V1.
- Pas de Playwright, Puppeteer, Chromium ou navigateur headless.
- Pas d'IA locale.
- Pas de dépendances lourdes inutiles.
- Backend Node.js + SQLite local.
- PM2 pour maintenir le process.
- Scheduler local sur le Pi, pas GitHub Actions comme runtime de collecte.

## Secrets et données privées

- Ne jamais committer `.env`.
- Ne jamais committer tokens, secrets, clés API, IDs privés ou mots de passe.
- Ne jamais committer la base SQLite runtime ni `/data`.
- `.env.example` doit contenir uniquement des placeholders.
- Firestore/Firebase ne font plus partie du flux principal.

## Sources API

Priorité :
1. France Travail (`france_travail`)
2. Adzuna (`adzuna`)
3. JSearch (`jsearch`)
4. Careerjet (`careerjet`, désactivable si l'API diverge)

Chaque connecteur renvoie le format commun :
`source`, `sourceOfferId`, `title`, `company`, `url`, `location`, `contractType`, `salaryMin`, `salaryMax`, `salaryRaw`, `remoteRaw`, `description`, `publishedAt`, `fetchedAt`.

## DONE

- Le branding visible est Opportunity Radar.
- `npm run build` passe.
- Firebase n'est plus nécessaire pour le flux principal.
- Le backend peut tourner localement sur Pi via PM2.
- Les quatre sources sont isolées en connecteurs.
- Le scoring et les verdicts existent.
- L'interface affiche les offres scorées.
- Les paramètres de base sont modifiables.
- Secrets et fichiers runtime restent hors Git.
- La migration et le déploiement Pi sont documentés.
