# Migration Candidator vers Opportunity Radar

Le repo a été transformé en application locale privée.

## Changements principaux

- Firebase Auth et Firestore retirés du flux principal.
- GitHub Pages n'est plus la cible de production.
- GitHub Actions ne collecte plus les offres.
- SQLite devient le stockage local.
- Les collectes API sont isolées par connecteur sous `/server/connectors`.
- Le front React consomme `/api/*`.

## Runtime cible

- Mac : développement et build.
- Raspberry Pi 3B : backend Node.js, SQLite, scheduler, PM2.
- iPhone : consultation via navigateur sur le réseau privé ou accès sécurisé configuré hors application.

## Legacy

Les anciens fichiers et workflows liés à Firebase/GitHub Pages doivent être considérés comme historiques. Ils ne doivent pas redevenir le runtime principal en V1.
