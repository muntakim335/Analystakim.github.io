# Maintenance Guide

## Routine cadence

| Frequency | Task |
|---|---|
| Daily (automated) | Backups (verify the ping/alert fired), uptime monitor on `/readyz` |
| Weekly | Skim error-level logs; check disk usage (`docker system df`, pg volume) |
| Monthly | `npm audit` in both apps; apply patch/minor dependency updates; review audit log for anomalies |
| Quarterly | Restore drill (backup-dr.md); rotate `JWT_SECRET` if policy requires (invalidates sessions); review user list & roles; Postgres minor upgrade if available |
| Yearly | Node LTS / Postgres major upgrade planning |

## Database housekeeping

- Autovacuum handles routine bloat; check `pg_stat_user_tables` if the DB grows unexpectedly.
- Slow queries: set `log_min_duration_statement=500` temporarily; every shipped list/report query is index-backed — new query shapes may need a matching `org_id`-led index (see docs/02-architecture/database.md).
- Growth watch: `activities` and `audit_logs` grow fastest. They are append-only and partitionable by month if they ever dominate (additive migration).

## Adding a schema migration

1. Create `apps/api/src/db/migrations/000N_description.sql` (next number).
2. Rules: append-only (never edit applied files), one transaction per file (the runner wraps it), backward-compatible (expand → migrate → contract) so rolling deploys and rollbacks stay safe.
3. `npm run migrate` locally, run tests (they apply every migration from scratch), commit.

## Dependency updates

`npm outdated` → update patch/minor freely (CI gates: typecheck + 54 API tests + web tests + builds). For majors (Fastify, React, Vite, Tailwind), read the changelog, update one at a time, run the full suite plus a manual smoke of login → convert lead → kanban.

## Common issues

| Symptom | Likely cause / fix |
|---|---|
| API exits at boot: `JWT_SECRET must be set` | Production with default secret — set a real one |
| `/readyz` 500 | DB unreachable: check `docker compose ps postgres`, credentials, volume disk space |
| 429 responses | Rate limits (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`) — raise for API-heavy integrations |
| Uploads fail with 413/422 | Size over `MAX_UPLOAD_MB` or MIME not in allow-list (`apps/api/src/modules/files.ts`) |
| Emails not sending | `SMTP_URL` unset (feature silently off by design) or provider creds — workflow runs log `send_email` as failed with the reason |
| Slow lists at large scale | Confirm query uses an `org_id`-led index (`EXPLAIN ANALYZE`); add trigram index for search (documented in database.md) |

## Where things live

- API env knobs: `apps/api/.env.example` (every variable documented)
- SQL migrations: `apps/api/src/db/migrations/`
- Role permissions: `docs/03-security/security.md` (matrix) → route guards in `apps/api/src/modules/*`
- Workflow engine: `apps/api/src/modules/workflows.ts`
- Storage/mailer adapters (swap points): `apps/api/src/lib/storage.ts`, `lib/mailer.ts`
