#!/usr/bin/env bash
# Nightly backup: compressed PostgreSQL dump + uploaded files. Keeps 14 days locally.
# Cron (as the oxina user):  15 2 * * * /opt/oxina/current/scripts/backup.sh >> /opt/oxina/shared/backup.log 2>&1
# Copy the backup directory off the server (S3/rclone) — a backup on the same disk is not a backup.
set -euo pipefail
ENV_FILE=${ENV_FILE:-/opt/oxina/shared/.env}
set -a; source "$ENV_FILE"; set +a
DEST=${BACKUP_DIR:-/opt/oxina/backups}
UPLOADS=${LOCAL_UPLOAD_DIR:-/opt/oxina/shared/uploads}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST"
# pg_dump understands the URL directly; strip Prisma's ?schema=… parameter first.
pg_dump "${DATABASE_URL%%\?*}" --format=custom --no-owner --file "$DEST/oxina-db-$STAMP.dump"
if [ -d "$UPLOADS" ]; then tar czf "$DEST/oxina-uploads-$STAMP.tgz" -C "$UPLOADS" .; fi
find "$DEST" -type f -mtime +14 -delete
echo "Backup complete: $DEST/oxina-db-$STAMP.dump"
