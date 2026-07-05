# NimbusCRM

> A modern, self-hosted, multi-tenant CRM platform. You own 100% of the code, data, and infrastructure.

NimbusCRM is a production-grade customer relationship management platform inspired by the best ideas from Salesforce, HubSpot, Pipedrive, Zoho and Monday.com — built on a fully open stack (TypeScript, PostgreSQL, Redis, Docker) with no proprietary dependencies.

**"NimbusCRM" is a working title — rename it freely; you own every line.**

## Monorepo layout

```
crm-platform/
├── apps/
│   ├── api/          # Backend REST API (Node.js 22, Fastify, PostgreSQL)
│   └── web/          # Web app (React 18, Vite, TypeScript, Tailwind)
├── deploy/           # Docker Compose, nginx, CI templates, k8s notes
├── docs/
│   ├── 01-research/      # Market research, PRD, personas, tech-stack rationale
│   ├── 02-architecture/  # System architecture, database/ER, API spec
│   ├── 03-security/      # Security model & hardening guide
│   ├── 04-operations/    # Deployment, backup/DR, maintenance
│   └── 05-guides/        # Developer guide, user manual
└── README.md
```

## Quick start (local, Docker)

```bash
cd crm-platform/deploy
cp .env.example .env          # edit secrets!
docker compose up -d          # postgres + redis + api + web
# open http://localhost:8080  → register your organization
```

## Quick start (development)

```bash
# 1. Start PostgreSQL (any way you like), then:
cd crm-platform/apps/api
cp .env.example .env
npm install
npm run migrate && npm run dev        # API on :3001

# 2. In another terminal:
cd crm-platform/apps/web
npm install
npm run dev                            # Web on :5173 (proxies /api → :3001)
```

## Tests

```bash
cd crm-platform/apps/api && npm test   # integration tests run against in-process Postgres (PGlite) — no DB needed
cd crm-platform/apps/web && npm test
```

## Status

The MVP scope (see `docs/01-research/prd.md`) is implemented and tested:
auth & multi-tenant orgs, users/roles (RBAC), contacts, companies, leads (+ conversion),
pipelines & deals (kanban), tasks, notes, activity timeline, audit log, custom fields,
workflow automation engine, notifications, file uploads, global search, reports,
CSV import/export, REST API with OpenAPI description.

The full roadmap (mobile apps, customer portal, invoicing, knowledge base, GraphQL, …)
is in `docs/roadmap.md`.

## License / ownership

All code and documentation in this folder is owned by the repository owner. Third-party
dependencies are OSS (MIT/Apache/BSD/PostgreSQL licenses) — see each `package.json`.
