# Buzz Docker Compose deployment

This is the single-node/VPS deployment bundle. It is intentionally separate from
the root `docker-compose.yml`, which remains local development infrastructure.

## Quick start

```bash
cd deploy/compose
cp .env.example .env
$EDITOR .env       # replace every CHANGE_ME value
./run.sh start
```

For a public VPS with automatic Let's Encrypt certificates:

```bash
cd deploy/compose
BUZZ_COMPOSE_TLS=true ./run.sh start
```

The bootstrap script should eventually replace manual `.env` editing for normal
users. It is responsible for generating stable secrets and, optionally, an owner
keypair.

## Production notes

- Requires Docker Compose v2.24.4 or newer; the TLS override uses Compose's
  `!reset` tag to remove the direct relay port when Caddy terminates HTTPS.
- Default `BUZZ_IMAGE` tracks `ghcr.io/block/buzz:main` for early testing. Pin it to `ghcr.io/block/buzz:sha-<7>` or a semver release tag for production once available.
- Keep `BUZZ_RELAY_PRIVATE_KEY`, `BUZZ_GIT_HOOK_HMAC_SECRET`, database/Redis,
  and S3 secrets stable across restarts.
- `RELAY_OWNER_PUBKEY` is intentionally not prefixed with `BUZZ_`; it must be a
  64-character hex Nostr pubkey when closed relay mode is enabled.
- `BUZZ_AUTO_MIGRATE` is opt-in. Set `BUZZ_AUTO_MIGRATE=true` or run
  `buzz-admin migrate` before starting the relay when bootstrapping a fresh
  database. Auto-migration requires an image that includes embedded SQLx
  migrations.
- The stack uses Postgres, Redis, MinIO, and a git data volume because
  those are real Buzz dependencies today. Minimal mode can simplify this later.

Run `./run.sh backup-hint` for the backup checklist.

## Backups & restore

`./run.sh backup` (or `backup.sh` directly from cron) snapshots the durable
state into `backups/` (override with `BUZZ_BACKUP_DIR`): gzipped `pg_dump`
dumps, a mirror of the MinIO media bucket, and tarballs of the git volume.
Retention is `BUZZ_BACKUP_KEEP` (default 14) snapshots for pg/git; the MinIO
mirror is a single rsync-style copy. Redis is deliberately not backed up —
its state (pub/sub, presence, rate-limit windows) is ephemeral.

`deploy/compose/.env` is NOT captured by the script: it holds
`BUZZ_RELAY_PRIVATE_KEY` and all infrastructure secrets. Back it up
separately through a secret store, not alongside the data snapshots.

Restore (stack stopped except the service being restored):

```bash
# Postgres: recreate schema+data from a dump
gunzip -c backups/pg/buzz-<stamp>.sql.gz \
  | docker compose --env-file .env exec -T postgres \
      psql -U buzz -d buzz

# MinIO: mirror the backup back into the bucket
docker compose --env-file .env run --rm -T --no-deps \
  -v "$PWD/backups/minio:/backup:ro" --entrypoint /bin/sh minio-init -euc '
    mc alias set local http://minio:9000 "$BUZZ_S3_ACCESS_KEY" "$BUZZ_S3_SECRET_KEY"
    mc mirror --overwrite /backup "local/$BUZZ_S3_BUCKET"
  '

# Git volume: unpack the tarball into the named volume
docker run --rm -v buzz-prod_buzz-git-data:/data/git \
  -v "$PWD/backups/git:/backup:ro" \
  alpine:3 sh -euc 'rm -rf /data/git/* && tar xzf /backup/git-<stamp>.tar.gz -C /data'
```

Rehearse a full restore on a scratch host before relying on the schedule —
an untested backup is not a backup. Take pg + minio + git snapshots from the
same maintenance window so they stay consistent with each other.

## Validation

Before sharing an install link publicly, verify a fresh install with:

```bash
cd deploy/compose
cp .env.example .env
$EDITOR .env
./run.sh config
./run.sh start
curl -fsS "http://127.0.0.1:$(grep -E '^BUZZ_HTTP_PORT=' .env | cut -d= -f2-)/_liveness"
./run.sh status
```
