# Déploiement Raspberry Pi

## Préparer le Pi

```bash
sudo apt update
sudo apt install -y nodejs npm rsync
sudo npm install -g pm2
```

Utiliser une version Node compatible avec Vite et `better-sqlite3` si la version Debian est trop ancienne.

## Installer l'application

Depuis le dossier du projet sur le Pi :

```bash
npm ci
cp .env.example .env
mkdir -p data
```

Éditer `.env` :

```bash
nano .env
```

Renseigner au minimum :

- `AUTH_PASSWORD`
- `AUTH_SESSION_SECRET`
- `DATABASE_PATH`
- les clés des sources API utilisées

## Initialiser SQLite

```bash
npm run db:init
```

## Build front

```bash
npm run build
```

## Démarrer avec PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
pm2 logs opportunity-radar --lines 50
```

## Scan manuel

```bash
npm run scan:once
```

## Déploiement futur Mac vers Pi

Exemple :

```bash
rsync -av --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .env \
  ./ pi@raspberrypi.local:/home/pi/opportunity-radar/

ssh pi@raspberrypi.local 'cd /home/pi/opportunity-radar && npm ci && npm run build && npm run db:init && pm2 restart opportunity-radar --update-env'
```
