#!/usr/bin/env bash
# Backs up the durable state of the compose stack into BUZZ_BACKUP_DIR:
#   pg/     — gzipped pg_dump snapshots (keeps last BUZZ_BACKUP_KEEP)
#   minio/  — mirror of the media bucket (mc mirror, no versioning)
#   git/    — tarballs of the buzz-git-data volume (keeps last BUZZ_BACKUP_KEEP)
# Redis is not backed up: it holds ephemeral state (pub/sub, presence,
# rate-limit windows) that is safe to lose on restore.
# Run from cron, e.g.: 17 3 * * * /srv/buzz/deploy/compose/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ ! -f .env ]]; then
  echo "Missing deploy/compose/.env — nothing to back up." >&2
  exit 1
fi

env_val() {
  local line
  line="$(grep -E "^${1}=" .env | tail -n1 || true)"
  printf '%s' "${line#*=}"
}

BACKUP_DIR="${BUZZ_BACKUP_DIR:-${SCRIPT_DIR}/backups}"
KEEP="${BUZZ_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
POSTGRES_USER_VAL="$(env_val POSTGRES_USER)"
POSTGRES_DB_VAL="$(env_val POSTGRES_DB)"
mkdir -p "${BACKUP_DIR}/pg" "${BACKUP_DIR}/minio" "${BACKUP_DIR}/git"

prune() {
  # Keep the newest $KEEP files matching $2 in directory $1.
  ls -1t "$1"/$2 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
  done
}

echo "[backup] postgres → ${BACKUP_DIR}/pg/buzz-${STAMP}.sql.gz"
docker compose --env-file .env exec -T postgres \
  pg_dump -U "${POSTGRES_USER_VAL:-buzz}" "${POSTGRES_DB_VAL:-buzz}" \
  | gzip > "${BACKUP_DIR}/pg/buzz-${STAMP}.sql.gz"
prune "${BACKUP_DIR}/pg" 'buzz-*.sql.gz'

echo "[backup] minio bucket → ${BACKUP_DIR}/minio/"
docker compose --env-file .env run --rm -T --no-deps \
  -v "${BACKUP_DIR}/minio:/backup" --entrypoint /bin/sh minio-init -euc '
    mc alias set local http://minio:9000 "$BUZZ_S3_ACCESS_KEY" "$BUZZ_S3_SECRET_KEY"
    mc mirror --overwrite --remove "local/$BUZZ_S3_BUCKET" /backup
  '

echo "[backup] git volume → ${BACKUP_DIR}/git/git-${STAMP}.tar.gz"
docker run --rm \
  -v buzz-prod_buzz-git-data:/data/git:ro \
  -v "${BACKUP_DIR}/git:/backup" \
  alpine:3 tar czf "/backup/git-${STAMP}.tar.gz" -C /data git
prune "${BACKUP_DIR}/git" 'git-*.tar.gz'

echo "[backup] done. Remember: .env (relay key, HMAC, DB/S3 secrets) must be backed up separately and securely."
