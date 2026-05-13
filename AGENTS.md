# AGENTS.md - Opportunity Radar

## Produit

Ce dépôt est dédié à Opportunity Radar.

Il est en reconstruction et doit rester minimal, lisible et orienté vers la
nouvelle application.

## Contraintes

- Ne jamais committer `.env`, secrets, tokens, bases locales, logs ou données
  runtime.
- Ne pas utiliser Docker par défaut.
- Ne pas ajouter de dépendances lourdes sans besoin explicite.
- Ne pas réintroduire GitHub Actions comme runtime de collecte.
- Garder les fichiers et la documentation strictement utiles à Opportunity
  Radar.

## Commandes actuelles

- Installer : `npm install`
- Dev : `npm run dev`
- Build : `npm run build`
