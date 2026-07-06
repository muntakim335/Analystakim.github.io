# Deployment Guide

## Option A — single host with Docker Compose (recommended start)

Works on any Linux VPS (2 vCPU / 2 GB RAM comfortably serves a 50-seat team).

```bash
# 1. Install Docker Engine + compose plugin (docs.docker.com), then:
git clone <your-repo> && cd crm-platform/deploy
cp .env.example .env
openssl rand -hex 24        # → POSTGRES_PASSWORD
openssl rand -base64 48     # → JWT_SECRET
$EDITOR .env                # set both + PUBLIC_ORIGIN

# 2. Launch
docker compose up -d --build
docker compose ps           # postgres/redis healthy, api/web up
curl -s localhost:8080/readyz   # {"ok":true}

# 3. Open http://<host>:8080 and register your organization.
```

Migrations run automatically at API boot (advisory-locked, safe with restarts).

### TLS / domain (required for production)

Point DNS at the host, then put a TLS proxy in front of port 8080. Simplest is Caddy:

```bash
apt install caddy   # or docker
# /etc/caddy/Caddyfile
crm.example.com {
    reverse_proxy 127.0.0.1:8080
}
systemctl reload caddy
```

Caddy provisions and renews Let's Encrypt certificates automatically and sets HSTS. Afterwards set `PUBLIC_ORIGIN=https://crm.example.com` in `.env` and `docker compose up -d` again. (Traefik or nginx+certbot work identically; keep 8080 firewalled to localhost.)

### Upgrades

```bash
git pull
cd crm-platform/deploy
docker compose build && docker compose up -d   # migrations apply on boot
docker compose logs -f api                     # watch the boot line
```

Rollback = `git checkout <previous tag>` + same commands. Migrations are append-only and backward-compatible by policy (expand → migrate → contract), so the previous app version keeps working against a newer schema.

## Option B — Kubernetes

See `deploy/k8s/README.md`. Prereqs: registry for the two images, managed Postgres + Redis, S3-compatible storage for uploads (or an RWX volume). The API is stateless and horizontally scalable as-is.

## Option C — bare metal / systemd (no Docker)

Node 22 + PostgreSQL 16 on the host; `npm ci && npm run build` in `apps/api`; run `node dist/index.js` under systemd with the env vars from `.env.example`; build `apps/web` (`npx vite build`) and serve `dist/` from any static server with `/api` proxied to :3001 (use `apps/web/nginx.conf` as the template).

## Monitoring, logging, error tracking

- **Health**: `/healthz` (process up) and `/readyz` (DB reachable) — point your uptime monitor (UptimeRobot, Better Stack, Prometheus blackbox) at `/readyz`.
- **Logs**: the API writes structured JSON (pino) with request IDs to stdout → `docker compose logs`, or ship with Vector/Promtail to Loki/ELK. Set `LOG_LEVEL=info` (default) or `debug` when diagnosing.
- **Error tracking**: run Sentry's Node SDK by adding its init to `apps/api/src/index.ts` (documented hook point) or use log-based alerting on `"level":50` (error) lines.
- **Metrics (optional)**: add `fastify-metrics` for a `/metrics` Prometheus endpoint; dashboards for P95 latency, 5xx rate, DB pool saturation.

## Scaling path

1. **Vertical** first: Postgres loves RAM; the shipped indexes keep list queries index-backed into millions of rows.
2. **Horizontal API**: `docker compose up -d --scale api=3` behind the proxy (move uploads to S3 adapter first), or Kubernetes replicas — the API is stateless.
3. **Database**: managed Postgres (RDS/Cloud SQL/Neon) with PgBouncer at ~20+ API instances; read replica for reports if they grow heavy.
4. **Workflow engine**: swap the in-process event bus for BullMQ on the existing Redis (interface already isolated) when automation volume warrants it.

## Local development

```bash
# API (needs any Postgres; or `npm run demo` for zero-setup in-memory Postgres)
cd apps/api && cp .env.example .env && npm install && npm run dev

# Web (proxies /api → :3001)
cd apps/web && npm install && npm run dev
```
