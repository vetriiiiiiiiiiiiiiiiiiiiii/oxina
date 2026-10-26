# VPS deployment guide (Ubuntu 24.04 LTS, no containers)

Node.js, PostgreSQL 17 and Nginx run directly on the server; the app and worker are systemd services.

> Not executed end to end in the development environment. Rehearse on a staging VPS first.

Layout on the server:

```
/opt/oxina/
  shared/.env          secrets (chmod 600) — never replaced by a deploy
  shared/uploads/      uploaded photos & documents
  releases/<stamp>-<ref>/   one directory per deployed version
  current -> releases/…     symlink used by systemd
  backups/             nightly dumps
```

## 1. Server packages

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw nginx certbot python3-certbot-nginx postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y    # official PostgreSQL apt repo
sudo apt -y install postgresql-17 postgresql-client-17
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

PostgreSQL listens on localhost only by default — leave it that way.

## 2. Database and service user

```bash
sudo useradd --system --create-home --home-dir /opt/oxina --shell /bin/bash oxina
sudo -u oxina mkdir -p /opt/oxina/{shared/uploads,releases,backups}
DBPASS=$(openssl rand -base64 32 | tr -d '/+=')
sudo -u postgres psql -c "CREATE ROLE oxina LOGIN PASSWORD '$DBPASS';"
sudo -u postgres psql -c "CREATE DATABASE oxina OWNER oxina;"
echo "$DBPASS"   # put it into DATABASE_URL below, then clear your terminal
```

## 3. Secrets

```bash
sudo -u oxina cp /path/to/checkout/.env.example /opt/oxina/shared/.env
sudo chmod 600 /opt/oxina/shared/.env
sudo -u oxina nano /opt/oxina/shared/.env
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://oxina:<DBPASS>@127.0.0.1:5432/oxina?schema=public` |
| `APP_URL` | `https://ops.example.com` |
| `REPO_URL` | git clone URL used by `scripts/deploy.sh` (deploy key with read-only access) |
| `FILE_SIGNING_SECRET` | `openssl rand -base64 48` |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` — **back this up separately**; encrypted identifiers are unreadable without it |
| `LOCAL_UPLOAD_DIR` | `/opt/oxina/shared/uploads` |
| `SMTP_*` | optional; without it emails are recorded as `SKIPPED_NO_PROVIDER` |
| `ALLOW_DEMO_SEED` | `false` |

## 4. First release

```bash
sudo -u oxina -i
cd /opt/oxina && git clone "$REPO_URL" releases/first && cd releases/first   # or copy the code here
ln -sfn /opt/oxina/shared/.env .env
npm ci && npx prisma generate
set -a; source /opt/oxina/shared/.env; set +a
npx prisma migrate deploy
npm run build
ln -sfn /opt/oxina/releases/first /opt/oxina/current
exit
```

Install the services (allow the oxina user to restart them without a password, for `deploy.sh`):

```bash
sudo cp /opt/oxina/current/deploy/systemd/oxina-*.service /etc/systemd/system/
echo 'oxina ALL=(root) NOPASSWD: /usr/bin/systemctl restart oxina-app oxina-worker, /usr/bin/systemctl stop oxina-app oxina-worker, /usr/bin/systemctl start oxina-app oxina-worker' | sudo tee /etc/sudoers.d/oxina
sudo systemctl daemon-reload
sudo systemctl enable --now oxina-app oxina-worker
curl -fsS http://127.0.0.1:3000/api/health
```

## 5. Create the first Super Admin (once)

```bash
sudo -u oxina -i
cd /opt/oxina/current && set -a && source /opt/oxina/shared/.env && set +a
read -r -p "Admin email: " INITIAL_ADMIN_EMAIL; read -r -s -p "Temporary password: " INITIAL_ADMIN_PASSWORD; echo
export INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD && npm run bootstrap:admin
unset INITIAL_ADMIN_PASSWORD
```

Reading the password interactively keeps it out of shell history and `.env`. The script refuses weak passwords, is a no-op once any Super Admin exists, and forces a password change at first sign-in.

## 6. Nginx + HTTPS

```bash
sudo cp /opt/oxina/current/deploy/nginx/oxina.conf /etc/nginx/sites-available/oxina
sudo sed -i 's/ops.example.com/YOUR.DOMAIN/g' /etc/nginx/sites-available/oxina
sudo ln -s /etc/nginx/sites-available/oxina /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
# Issue the certificate first (comment out the 443 block temporarily if `nginx -t` complains about missing certs):
sudo certbot certonly --webroot -w /var/www/certbot -d YOUR.DOMAIN
sudo nginx -t && sudo systemctl reload nginx
systemctl list-timers | grep certbot      # auto-renewal
```

The config disables buffering for the live-tracking stream, overwrites `X-Forwarded-For` (clients cannot spoof IPs used for rate limiting and audit), rate-limits `/api/auth/login`, and sets HSTS.

## 7. Logs

* App and worker: `journalctl -u oxina-app -f`, `journalctl -u oxina-worker -f` (journald rotation; set `SystemMaxUse=` in `/etc/systemd/journald.conf`).
* Nginx: `/var/log/nginx/oxina.*.log` (logrotate).
* PostgreSQL: `/var/log/postgresql/`.
* Application logs never include passwords, tokens or identifiers; the audit log redacts sensitive keys.

## 8. Backups & restore

```bash
sudo -u oxina /opt/oxina/current/scripts/backup.sh         # pg_dump (custom format) + uploads tarball, 14-day retention
sudo -u oxina crontab -e
  15 2 * * * /opt/oxina/current/scripts/backup.sh >> /opt/oxina/shared/backup.log 2>&1
sudo -u oxina /opt/oxina/current/scripts/restore.sh /opt/oxina/backups/oxina-db-<stamp>.dump [/opt/oxina/backups/oxina-uploads-<stamp>.tgz]
```

Copy backups off the server (S3/rclone) and test a restore on staging regularly. Keep `DATA_ENCRYPTION_KEY` in separate key escrow, not alongside the dumps.

## 9. Deploying an update

```bash
sudo -u oxina /opt/oxina/current/scripts/deploy.sh v1.2.0
```

It backs up, clones the tag into a new release directory, links the shared `.env`, installs, migrates, builds, switches `current`, restarts both services, checks `/api/health`, and keeps the last five releases. `.env`, uploads and the database are never replaced.

## 10. Rollback

```bash
sudo -u oxina ln -sfn /opt/oxina/releases/<previous> /opt/oxina/current
sudo systemctl restart oxina-app oxina-worker
```

If the failed release ran a migration that the previous code cannot work with, restore the pre-deploy backup (`restore.sh`). Prisma has no automatic down-migrations, so keep migrations additive and the code switch above is normally enough.

## 11. Production checklist

- [ ] `npm test` passes on the release commit
- [ ] GST/tax rules and invoice layout validated by the accountant
- [ ] SMTP configured and a test email confirmed received
- [ ] Off-server backups running; a restore tested on staging
- [ ] `ALLOW_DEMO_SEED=false`; no demo users in the database
- [ ] Super Admin password changed; bootstrap variables unset
- [ ] Privacy notice text reviewed for the consent version recorded (`2026-10`)
