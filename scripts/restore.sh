#!/usr/bin/env bash
# Restore a database dump (and optionally uploads). DESTRUCTIVE for the target database.
#   sudo -u oxina ./scripts/restore.sh /opt/oxina/backups/oxina-db-<stamp>.dump [/opt/oxina/backups/oxina-uploads-<stamp>.tgz]
set -euo pipefail
DUMP=${1:?usage: restore.sh <db.dump> [uploads.tgz]}
ENV_FILE=${ENV_FILE:-/opt/oxina/shared/.env}
set -a; source "$ENV_FILE"; set +a
UPLOADS=${LOCAL_UPLOAD_DIR:-/opt/oxina/shared/uploads}
read -r -p "This replaces ALL data in the database from $DUMP. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Aborted."; exit 1; }
sudo systemctl stop oxina-app oxina-worker
pg_restore --dbname "${DATABASE_URL%%\?*}" --clean --if-exists --no-owner "$DUMP"
if [ -n "${2:-}" ]; then
  find "$UPLOADS" -mindepth 1 -delete
  tar xzf "$2" -C "$UPLOADS"
fi
sudo systemctl start oxina-app oxina-worker
echo "Restore complete."
