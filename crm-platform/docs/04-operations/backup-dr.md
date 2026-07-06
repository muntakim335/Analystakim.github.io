# Backup & Disaster Recovery

**Targets:** RPO ≤ 24 h with nightly dumps (≤ 5 min with WAL archiving), RTO ≤ 1 h on a fresh host.

## What must be backed up

1. **PostgreSQL** — the system of record (all CRM data, users, audit log).
2. **Uploads volume** — file attachments (`uploads` Docker volume / `/data/uploads`).
3. **`.env`** — secrets; without `JWT_SECRET` all sessions invalidate on restore (acceptable), without `POSTGRES_PASSWORD` the dump still restores (password is set fresh).

## Nightly dumps (baseline)

`/usr/local/bin/crm-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DIR=/var/backups/nimbuscrm
mkdir -p "$DIR"

# 1. Database — custom format (compressed, selective restore)
docker compose -f /opt/crm-platform/deploy/docker-compose.yml \
  exec -T postgres pg_dump -U crm -d crm -Fc > "$DIR/crm-$STAMP.dump"

# 2. Uploads
docker run --rm -v nimbuscrm_uploads:/data -v "$DIR":/backup alpine \
  tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

# 3. Ship off-host (any S3-compatible bucket; keep 30 daily + 12 monthly)
rclone copy "$DIR" remote:crm-backups/ --include "*-$STAMP.*"

# 4. Prune local copies older than 14 days
find "$DIR" -mtime +14 -delete
```

Cron: `10 2 * * * /usr/local/bin/crm-backup.sh >> /var/log/crm-backup.log 2>&1`

**Off-host is non-negotiable** — a backup on the same disk as the database is not a backup. Alert if the backup log goes quiet (e.g., healthchecks.io ping at the end of the script).

## Point-in-time recovery (optional, RPO ≈ minutes)

For stricter RPO, enable WAL archiving with [WAL-G](https://github.com/wal-g/wal-g) or pgBackRest to the same bucket (`archive_mode=on`, `archive_command='wal-g wal-push %p'`), or simply use a managed Postgres (RDS/Cloud SQL/Neon) where PITR is a checkbox — the app needs only `DATABASE_URL`.

## Restore runbook (practice this quarterly)

```bash
# Fresh host: install Docker, clone repo, restore .env (or mint new secrets)
cd crm-platform/deploy && docker compose up -d postgres
sleep 10

# 1. Database
cat crm-2026-07-06.dump | docker compose exec -T postgres \
  pg_restore -U crm -d crm --clean --if-exists

# 2. Uploads
docker compose up -d   # creates the volume
docker run --rm -v nimbuscrm_uploads:/data -v "$PWD":/backup alpine \
  tar xzf /backup/uploads-2026-07-06.tar.gz -C /data

# 3. Full stack + verification
docker compose up -d
curl -s localhost:8080/readyz                    # {"ok":true}
# log in, spot-check a contact, a deal board, and the audit log
```

Restore drill checklist: dump restores without errors → login works → record counts plausible (`SELECT count(*) FROM contacts;`) → attachments download. Record the drill date and duration in your ops log; that duration is your real RTO.

## Failure scenarios

| Scenario | Response |
|---|---|
| API container crash-loop | `docker compose logs api`; roll back to previous image; DB untouched |
| Host loss | Provision new host → restore runbook (RTO target 1 h) |
| Bad deploy w/ bad migration | Restore last dump to a scratch DB, verify, then swap `DATABASE_URL`; migrations are append-only so this is rare by construction |
| Accidental data deletion by a user | Audit log identifies what/when/who; restore the nightly dump into a scratch container and copy the rows back |
| Region/provider outage | Backups are in object storage — restore on any provider; DNS TTL kept ≤ 300 s |
