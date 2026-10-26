#!/usr/bin/env bash
# Release deploy on the VPS (run as the oxina user). Each release lives in its own directory;
# `current` is a symlink, so rollback is just pointing it back and restarting.
#   ./scripts/deploy.sh <git-tag-or-commit>
set -euo pipefail
REF=${1:?usage: deploy.sh <git ref>}
ROOT=/opt/oxina
REL="$ROOT/releases/$(date -u +%Y%m%d%H%M%S)-$REF"
set -a; source "$ROOT/shared/.env"; set +a
: "${REPO_URL:?set REPO_URL (git clone URL) in /opt/oxina/shared/.env}"
[ -e "$ROOT/current" ] && "$ROOT/current/scripts/backup.sh"
git clone --quiet "$REPO_URL" "$REL"
git -C "$REL" checkout --quiet "$REF"
ln -sfn "$ROOT/shared/.env" "$REL/.env"
cd "$REL"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
npm run build
ln -sfn "$REL" "$ROOT/current"
sudo systemctl restart oxina-app oxina-worker
sleep 5 && curl -fsS http://127.0.0.1:3000/api/health && echo " — deployed $REF"
ls -1dt "$ROOT"/releases/* | tail -n +6 | xargs -r rm -rf   # keep the last 5 releases
