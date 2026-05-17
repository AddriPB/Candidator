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
npm run radar:nightly
npm run applications:discover-contacts
npm run applications:daily
npm run applications:spontaneous
npm run applications:bounces
npm test
```

`npm run radar:test` lance le même pipeline que `radar:daily` et sert à valider
la collecte juste après une livraison sur le Pi.

`npm run radar:nightly` est le point d'entrée pour le cron nocturne. Il ne lance
la collecte que pendant les heures configurées, garde un état local sous
`data/`, retente au plus toutes les 2 heures et arrête les retries après 3
échecs sur la même journée locale.

`npm run applications:discover-contacts` enrichit les offres récentes avec des
emails de candidature. `npm run applications:daily` envoie les candidatures
rattachées aux offres. `npm run applications:spontaneous` envoie les
candidatures spontanées récurrentes vers des contacts découverts, sans URL
d'offre dans le mail. `npm run applications:bounces` traite les retours de
non-livraison et met à jour les statuts avant les prochains envois.

## Variables d'environnement

Copier `.env.example` vers `.env` sur le Pi et renseigner les valeurs privées :

- `FRANCE_TRAVAIL_CLIENT_ID`
- `FRANCE_TRAVAIL_CLIENT_SECRET`
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `RAPIDAPI_KEY`
- `CAREERJET_API_KEY`
- `CAREERJET_REFERER`
- `DATABASE_PATH` : chemin du store local. Utiliser
  `./data/opportunity-radar.sqlite` sur le Pi et sur le Mac pour travailler sur
  le même moteur que la prod. Le store JSON reste un fallback/matériau de
  migration si `better-sqlite3` n'est pas disponible.
- `RADAR_OUTPUT_DIR`
- `OPPORTUNITY_RADAR_CONFIG`
- `CANDIDATE_PROFILES_CONFIG` : chemin optionnel vers la configuration locale
  multi-profils, par défaut `./config/candidate-profiles.local.json`
- `CORS_ORIGINS` : origine(s) front autorisée(s), par exemple
  `https://addripb.github.io`
- `AUTH_COOKIE_SAMESITE` : utiliser `None` si le front GitHub Pages appelle
  une API sur un autre domaine
- `AUTH_COOKIE_SECURE` : utiliser `true` avec `AUTH_COOKIE_SAMESITE=None`
  derrière HTTPS
- `APPLICATION_EMAIL_MAX_CONTACTS_PER_OFFER` : 3 par défaut
- `APPLICATION_EMAIL_PER_OFFER_DAILY_LIMIT` : 1 par défaut
- `APPLICATION_EMAIL_DAILY_LIMIT` : 20 par défaut
- `APPLICATION_EMAIL_DELIVERY_MODE` : `live` par défaut. En mode `live`,
  les mails partent vers les adresses recruteurs découvertes.
- `APPLICATION_EMAIL_REDIRECT_TO` : destinataire de redirection uniquement pour
  les tests d'envoi avec `APPLICATION_EMAIL_DELIVERY_MODE=test`.
- `APPLICATION_EMAIL_SEND_TIMEZONE` : `Europe/Paris` par défaut
- `APPLICATION_EMAIL_SEND_START_HOUR` : 8 par défaut
- `APPLICATION_EMAIL_SEND_END_HOUR` : 21 par défaut
- `APPLICATION_EMAIL_INFERRED_ENABLED` : `true` par défaut
- `APPLICATION_EMAIL_BOUNCE_ADDRESS` : adresse de retour DSN, par exemple
  `bounce@example.fr`
- `APPLICATION_EMAIL_BOUNCE_IMAP_HOST`
- `APPLICATION_EMAIL_BOUNCE_IMAP_USER`
- `APPLICATION_EMAIL_BOUNCE_IMAP_PASS`
- `APPLICATION_EMAIL_BOUNCE_DIR` : dossier local optionnel de messages DSN à
  parser si IMAP n'est pas utilisé
- `SPONTANEOUS_APPLICATION_SEND_TIMEZONE` : `Europe/Paris` par défaut
- `SPONTANEOUS_APPLICATION_SEND_START_HOUR` : 8 par défaut
- `SPONTANEOUS_APPLICATION_SEND_END_HOUR` : 22 par défaut, soit une fenêtre
  08:00-21:59 inclus

Ne pas publier `.env`, la base SQLite, les rapports générés ni les logs.

## Collecte Opportunity Radar

La configuration métier est dans `config/opportunity-radar.json`.

Le pipeline quotidien :

1. appelle les sources actives configurées ;
2. lance les recherches PO / PM / BA / Proxy PO / chef de projet digital /
   AMOA / MOA et métiers funéraires ;
3. normalise les offres ;
4. déduplique par lien, id source, puis hash stable ;
5. filtre les offres hors cible ;
6. score les offres sur 100 ;
7. génère une synthèse Markdown et un JSON dans `RADAR_OUTPUT_DIR`.

Les erreurs d'une source ne bloquent pas les autres. Chaque run journalise la
date, la source, le nombre d'offres récupérées, le nombre d'erreurs et le
message d'erreur éventuel.

Les appels API sont étalés source par source par le collecteur, pas lancés tous
en même temps. C'est volontaire pour limiter les pics de requêtes, réduire le
risque de `429 Too Many Requests` et garder des logs lisibles par source.

## Candidatures, spontanées et rebonds

### Profils candidats

Sans fichier multi-profils local, le bot conserve le fonctionnement historique :
un pseudo `CV_USER_PSEUDO`/`AUTH_USERNAME`, un CV actif et un template stockés
via l'écran CV.

Le mode multi-profils s'active avec un fichier local non versionné, par exemple
`config/candidate-profiles.local.json`, sur le modèle de
`config/candidate-profiles.example.json`. Un seul bot tourne, mais chaque offre
est rattachée automatiquement au profil dont les mots-clés métier correspondent
le mieux à l'intitulé et à la description.

Chaque profil peut définir `pseudo`, `label`, `firstName`, `lastName`, `phone`,
`emailFrom`, `smtpPrefix`, `cvPath`, `automaticOfferApplicationsEnabled`,
`automaticSpontaneousApplicationsEnabled`, `targetRoles`, `excludedRoles`,
`dailyQuota`, `template.subject`/`template.body` pour les offres et
`spontaneousTemplate.subject`/`spontaneousTemplate.body` pour les candidatures
spontanées.
Les deux réglages d'envoi valent `false` par défaut et peuvent être activés
séparément depuis les toggles du profil actif dans l'interface. Ils ne pilotent
que les mails de candidature sur offre, les mails de candidature spontanée et le
mail test; la collecte nocturne, les appels API emploi et la découverte de
contacts restent actifs.

Si `smtpPrefix` est renseigné, le profil utilise les variables SMTP préfixées
correspondantes. Par exemple `"smtpPrefix": "SECOND"` active
`SECOND_SMTP_HOST`, `SECOND_SMTP_PORT`, `SECOND_SMTP_SECURE`,
`SECOND_SMTP_USER`, `SECOND_SMTP_PASSWORD` et `SECOND_MAIL_FROM`. Sans
`smtpPrefix`, le profil utilise le SMTP global `SMTP_*`/`APPLICATION_FROM`.

Deux familles sont prévues par l'exemple :

- profil Adri : Product Owner, Business Analyst, chef de projet MOA/AMOA ;
- profil Léna : conseiller funéraire, assistant funéraire et métiers
  funéraires similaires, avec exclusion explicite de maître de cérémonie,
  porteur et chauffeur.

Une candidature est bloquée et loggée si le profil choisi n'a pas de prénom, pas
de nom, pas de CV configuré ou si le fichier CV est introuvable. Les historiques
d'envoi incluent `profilePseudo` afin de séparer les logs par profil. Les quotas
journaliers s'appliquent globalement et par profil.

L'écran CV permet de sélectionner un profil, d'importer un CV dans son dossier
local dédié (`cv/<pseudo>`), de choisir le CV actif et de sauvegarder prénom,
nom et téléphone séparément par profil. Ces valeurs locales sont prioritaires
sur `cvPath`/identité du fichier JSON; le JSON reste un fallback utile au
démarrage.

Organisation locale recommandée :

```text
config/candidate-profiles.local.json
cv/adri/CV-adri.pdf
cv/léna/CV-lena.pdf
data/
logs/
```

Les emails recruteurs sont cherchés dans les champs des offres, les liens de
candidature, les pages publiques de recrutement, puis par adresses génériques
du domaine entreprise. Si un recruteur public est identifié, des variantes
professionnelles peuvent être inférées lorsque `APPLICATION_EMAIL_INFERRED_ENABLED`
est actif.

La découverte peut aussi être élargie aux ESN listées dans
`esn_contact_discovery.companies`. Dans ce cas, le collecteur visite quelques
pages publiques des sites configurés et crée des contacts RH ainsi que
commerciaux probables (`recrutement@`, `rh@`, `business@`, `commercial@`,
`sales@`, etc.) sur le domaine de l'entreprise. Cette source est utilisée par
`npm run applications:discover-contacts` et par les candidatures spontanées.

Une découverte web complémentaire est configurable via
`web_contact_discovery.queries`. Elle lance des recherches publiques, par
exemple `recruteur IDF ESN email recrutement`, récupère des liens de résultats,
puis extrait uniquement les emails visibles sur la page de résultats ou sur les
pages publiques visitées. Les domaines de job boards et moteurs de recherche
sont ignorés pour éviter de stocker des emails de plateformes.

Deux types d'action sont journalisés :

- `job_offer_application` : candidature rattachée à une offre, avec URL, score
  et fiche offre ;
- `spontaneous_application` : candidature non rattachée à une offre, ciblant
  une entreprise et un recruteur/contact découvert avec email valide.

L'envoi sur offre choisit une adresse par offre et par tentative, avec 3
adresses maximum par offre, 1 nouvel envoi par offre par jour et un quota
quotidien live configurable. Les envois sur offre sont bloqués hors fenêtre
08:00-20:59 Europe/Paris par défaut, même si un cron appelle le script plus tôt
ou plus tard.

Le mail sur offre est généré par règles et blocs préécrits, sans API IA payante
ni LLM local. L'angle court varie selon le métier détecté : PO, BA, chef de
projet MOA/AMOA, delivery, discovery, funéraire ou transverse. Le mail inclut
l'intitulé, l'URL de l'offre quand elle existe, le CV du profil choisi et le
template du profil si un template local est configuré.

L'envoi spontané réutilise la découverte de contacts existante, profil par
profil. Les offres utilisées pour trouver les destinataires sont filtrées selon
les postes cibles de chaque profil, le mail ne contient aucune URL d'offre, et
le corps reprend le téléphone, le prénom, le nom et le CV actif du profil. Si
`spontaneousTemplate` est absent, un mail par défaut utilise `[Postes cibles]`,
`[Téléphone]` et `[Prénom Nom]`. Les règles spécifiques sont :

- ne jamais renvoyer une candidature spontanée à un email déjà envoyé pour le
  même profil ;
- maximum 1 candidature spontanée acceptée par SMTP par jour et par profil ;
- retry immédiat en cas d'échec d'envoi ;
- arrêt jusqu'au lendemain pour le profil après 1 succès ou après 3 échecs
  d'envoi ;
- fenêtre dédiée 08:00-21:59 inclus.

Chaque tentative est loggée avec la date/heure, le type d'action, l'entreprise,
le contact, l'email, le statut, la raison d'échec ou de skip, le numéro de
tentative du jour et la raison d'arrêt journalier si applicable. Les emails
acceptés par SMTP sont marqués `sent_pending_delivery`, puis
`applications:bounces` classe les retours en `hard_bounced`, `soft_bounced`,
`retry_scheduled` ou `delivered_or_no_bounce_after_grace_period`.

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
15 2,4,6 * * * cd /chemin/vers/Opportunity-Radar && npm run radar:nightly >> logs/radar-cron.log 2>&1
15 8-20 * * * cd /chemin/vers/Opportunity-Radar && npm run applications:daily >> logs/applications-cron.log 2>&1
15 8-21 * * * cd /chemin/vers/Opportunity-Radar && npm run applications:spontaneous >> logs/spontaneous-applications-cron.log 2>&1
45 8-20 * * * cd /chemin/vers/Opportunity-Radar && npm run applications:bounces >> logs/applications-bounces.log 2>&1
```

Cette planification tente une première collecte à 02:15, puis laisse deux
créneaux de retry à 04:15 et 06:15 si la collecte précédente a échoué. Une fois
le run réussi, les créneaux suivants sont ignorés. Après 3 échecs le même jour,
le script n'essaie plus avant la journée suivante. Les candidatures sur offres,
les candidatures spontanées et le traitement des rebonds tournent ensuite en
journée, avec leurs propres garde-fous horaires côté script.

Après chaque déploiement, lancer un test immédiat :

```bash
npm run radar:test
```

## Déploiement

La page GitHub Pages est publique. Elle doit être construite avec
`VITE_PUBLIC_API_BASE` si le backend est servi depuis une URL HTTPS séparée.

Le fichier `.env` complet reste sur le Pi et n'est pas publié sur GitHub. Le
fichier `config/candidate-profiles.local.json`, les CV et les données runtime
restent également locaux.

Le runtime Pi existant utilise PM2 pour l'API/front et cron pour les jobs. Après
déploiement, conserver :

```bash
pm2 restart opportunity-radar --update-env
pm2 save
pm2 startup
```

`pm2 save` et `pm2 startup` assurent la reprise après reboot ou coupure
électrique. PM2 redémarre aussi le process API en cas de crash ; les scripts cron
reprennent naturellement après coupure réseau temporaire.

## Règles

- Ne pas committer `.env`, secrets, tokens, bases locales, logs ou dossiers de
  build.
- Ne pas réintroduire de workflows de collecte GitHub Actions comme runtime.
- Garder le dépôt lisible et orienté uniquement Opportunity Radar.
