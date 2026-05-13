# Opportunity Radar

Opportunity Radar est un radar privé d'opportunités professionnelles.

Ce dépôt est en reconstruction. Il sert de base propre pour repartir sur la
nouvelle application Opportunity Radar, sans autre ligne produit à maintenir.

## État du dépôt

- Base React + Vite minimale.
- Collecte locale quotidienne possible via script Node, sans GitHub Actions de collecte.
- Les 4 sources emploi configurées sont France Travail, Adzuna, JSearch/RapidAPI et Careerjet.
- Les secrets, données runtime, builds locaux et dépendances installées restent
  hors Git.

## Commandes

```bash
npm install
npm run dev
npm run build
npm run radar:daily
npm test
```

`npm run radar:test` lance le même pipeline que `radar:daily` et sert à valider
la collecte juste après une livraison sur le Pi.

## Variables d'environnement

Copier `.env.example` vers `.env` sur le Pi et renseigner les valeurs privées :

- `FRANCE_TRAVAIL_CLIENT_ID`
- `FRANCE_TRAVAIL_CLIENT_SECRET`
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `RAPIDAPI_KEY`
- `CAREERJET_API_KEY`
- `CAREERJET_REFERER`
- `DATABASE_PATH`
- `RADAR_OUTPUT_DIR`
- `OPPORTUNITY_RADAR_CONFIG`

Ne pas publier `.env`, la base SQLite, les rapports générés ni les logs.

## Collecte Opportunity Radar

La configuration métier est dans `config/opportunity-radar.json`.

Le pipeline quotidien :

1. appelle les sources actives configurées ;
2. lance les recherches PO / PM / BA / Proxy PO / chef de projet digital /
   AMOA / MOA ;
3. normalise les offres ;
4. déduplique par lien, id source, puis hash stable ;
5. filtre les offres hors cible ;
6. score les offres sur 100 ;
7. génère une synthèse Markdown et un JSON dans `RADAR_OUTPUT_DIR`.

Les erreurs d'une source ne bloquent pas les autres. Chaque run journalise la
date, la source, le nombre d'offres récupérées, le nombre d'erreurs et le
message d'erreur éventuel.

## Filtrage et scoring

Rôles priorisés : Product Owner, Product Manager, Business Analyst, Proxy PO,
chef de projet digital, Consultant AMOA/MOA.

Exclusions par défaut : rôles développeur IA ou logiciel pur, data scientist,
data engineer, prompt engineer pur, QA pur, Scrum Master pur, Delivery Manager
pur, Product Ops pur, postes hors CDI, hors Paris/Île-de-France/full remote
France, présentiel obligatoire, rémunération sous seuil si configurée,
entreprises ou secteurs blacklistés.

Les offres ambiguës mais compatibles sont classées en `à candidater` avec des
points de vigilance. Seuls les rejets durs sortent de la cible.

Score sur 100 :

- rémunération : 40 points ;
- télétravail : 30 points ;
- adéquation rôle : 20 points ;
- qualité de l'opportunité : 10 points, dont l'IA seulement comme argument
  différenciant produit / BA.

## Exécution quotidienne à 0 €

Sur le Pi, utiliser un cron local plutôt que GitHub Actions :

```cron
15 7 * * * cd /chemin/vers/Opportunity-Radar && npm run radar:daily >> logs/radar-cron.log 2>&1
```

Après chaque déploiement, lancer un test immédiat :

```bash
npm run radar:test
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
