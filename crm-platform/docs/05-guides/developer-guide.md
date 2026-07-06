# Developer Guide

## Setup

```bash
node --version   # >= 22
cd apps/api && npm install && npm run demo    # zero-setup API on :3001 (in-memory Postgres)
cd apps/web && npm install && npm run dev     # web on :5173, /api proxied to :3001
```

With a real database instead of the demo server: `cp .env.example .env`, set `DATABASE_URL`, then `npm run migrate && npm run dev`.

**Tests** (no services needed): `npm test` in `apps/api` (54 integration tests over real Postgres semantics via PGlite) and in `apps/web` (component tests, jsdom). CI additionally re-runs the API suite against a real PostgreSQL 16 service.

## Repository layout & layering

```
apps/api/src/
├── index.ts            boot: config → migrate → ctx → listen; graceful shutdown
├── server.ts           Fastify assembly: plugins, auth decorators, error mapping, module registry
├── config.ts           zod-validated env (fails fast on bad config)
├── context.ts          AppCtx: { db, config, bus, mailer, storage }
├── db/
│   ├── db.ts           Db interface + pg (prod) and PGlite (test) drivers
│   ├── migrate.ts      SQL migration runner (advisory-locked)
│   └── migrations/     append-only versioned SQL
├── lib/                cross-cutting: errors, validate, crypto, listing, events,
│                       common (audit/activity/notify), custom-fields, mailer, storage
└── modules/            one file per domain: auth, users, contacts, companies, leads,
                        pipelines, deals, tasks, notes, activities, custom-fields,
                        workflows, notifications, files, search, reports
```

Each module keeps a strict internal layering even within one file: **route handlers** (parse/validate → call logic → status code) → **domain logic** (transactions, events, audit) → **SQL** (parameterized, always org-scoped). Cross-module reuse goes through `lib/`, never by importing another module's internals.

### Conventions that keep the codebase safe

1. **Every SQL statement filters by `org_id`** taken from `request.actor`, never from the body. New endpoints must return 404 (not 403) for cross-tenant IDs.
2. **All input through `parse(zodSchema, data)`** — throws a structured 422.
3. **Mutations are transactions** (`db.tx`) that include their `logAudit` call; user-visible events also `logActivity`.
4. **Domain events emit after commit** (`bus.emit`), and subscribers may not throw into requests.
5. Money is `numeric(14,2)`; IDs are app-generated UUIDs; timestamps are `timestamptz`.

## Adding a feature end-to-end (recipe)

Example: a "Products" module.

1. Migration `0002_products.sql`: table with `org_id` FK + indexes.
2. `modules/products.ts`: zod schemas, SELECT with camelCase aliases, routes using `runList` for the list endpoint, audit/activity in transactions. Register it in `server.ts`.
3. Tests in `test/products.test.ts` using `createTestApp`/`registerOrg` — cover CRUD, validation, and a cross-tenant 404.
4. Web: add types to `api/types.ts`, a page with `useList` + `DataTable`, route in `App.tsx`, nav entry in `Layout.tsx`.
5. Docs: endpoint rows in `docs/02-architecture/api-spec.md` + entry in `openapi.ts`.

## Frontend notes

- Server state lives in TanStack Query (keys: `['resource', filters]`); mutations invalidate affected keys. The kanban uses optimistic updates with rollback — copy that pattern for drag-like UX.
- UI primitives are in `components/ui.tsx`; prefer composing them over new one-off styles. Theme tokens are CSS variables in `index.css` (light + `.dark`), charts read the same tokens.
- Auth: `api/client.ts` auto-refreshes on 401 (single-flight) and signs out on refresh failure.

## API usage from outside (integrations)

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@co.com","password":"…"}' | jq -r .accessToken)

# e.g. push a website form into the CRM
curl -s localhost:3001/api/v1/leads -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"New Prospect","email":"p@x.com","source":"website"}'
```

Full endpoint list: `docs/02-architecture/api-spec.md` or `GET /api/openapi.json` from a running instance. Errors are always `{error:{code,message,details?}}`; lists are `{data,page,limit,total}`.

## Quality gates

`npm run typecheck && npm test` in both apps must pass before pushing; CI (`.github/workflows/crm-ci.yml`) enforces typecheck + both test modes + production builds on every push touching `crm-platform/`.
