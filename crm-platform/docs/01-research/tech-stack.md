# Technology Stack — Decisions & Rationale

Guiding constraints: **100% owner-controlled** (OSS licenses only), enterprise-credible, deployable from a laptop to Kubernetes, one language across the stack to keep a small team productive.

## Summary

| Layer | Choice | Alternatives considered |
|---|---|---|
| Language | **TypeScript** (Node.js 22 LTS) | Go, Python/Django, Java/Spring, C#/.NET |
| API framework | **Fastify 5** | Express, NestJS, Hono |
| Database | **PostgreSQL 16** | MySQL, MongoDB |
| DB access | **`pg` + hand-written SQL + repository layer** | Prisma, Drizzle, TypeORM |
| Migrations | Versioned SQL files + tiny built-in migrator | drizzle-kit, Flyway |
| Cache / rate-limit / queues | **Redis 7** (optional at small scale; in-memory fallback built in) | Memcached |
| Auth | **JWT (access+refresh rotation)**, bcrypt | Sessions+Redis, OAuth-only |
| Validation | **zod** | Joi, JSON Schema by hand |
| Web frontend | **React 18 + Vite + TypeScript** | Vue/Nuxt, SvelteKit, Next.js |
| Data fetching | **TanStack Query** | RTK Query, SWR |
| Styling | **Tailwind CSS v4** | CSS Modules, MUI/Chakra |
| Charts | Hand-rolled SVG (tiny, dependency-free) | Recharts, Chart.js |
| Tests | **Vitest** (+ fastify.inject for API integration; PGlite in-process Postgres) | Jest, Mocha |
| API tests DB | **PGlite** (real Postgres in WASM) locally; real PostgreSQL service in CI | testcontainers |
| Packaging | **Docker** multi-stage; **Docker Compose** for single-host prod; K8s-ready (stateless API, health probes) | — |
| CI | **GitHub Actions** | GitLab CI |
| Logging | **pino** structured JSON | winston |
| Mobile (v2) | **React Native (Expo)** consuming the same REST API | Flutter, native |

## Rationale for the load-bearing choices

### TypeScript everywhere
One language for API, web, future mobile (React Native), and scripts. Shared mental model, shared types, largest hiring pool. Go would give better raw performance per core, but the API is I/O-bound (Postgres does the heavy lifting) and Fastify on Node comfortably clears the NFR latency budget; the full-stack velocity win dominates for a product like this.

### Fastify over Express / NestJS
- **Express** is in maintenance mode, slower, and needs a pile of middleware for what Fastify has built in (schema validation, logging via pino, plugin encapsulation).
- **NestJS** adds an Angular-style DI framework — valuable for 50-dev teams, ceremony for this codebase. Clean layering (routes → services → repositories) gives us the same testability without the magic.
- Fastify is among the fastest Node frameworks, has first-class TypeScript, and a mature plugin ecosystem (`@fastify/jwt`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/multipart`, `@fastify/cors`) — all used here.

### PostgreSQL over MySQL / MongoDB
CRM data is deeply relational (contact ↔ company ↔ deal ↔ pipeline ↔ user) and needs transactions (lead conversion is atomic multi-table). PostgreSQL adds exactly the extras a CRM wants: **JSONB** for custom-field values (indexed, queryable — schema flexibility without EAV tables), rich indexing (partial, composite, trigram for search later), window functions for reports, row-level security as a future hardening layer, and the best OSS operational story (WAL archiving, PITR). MongoDB would force joins into app code; MySQL's JSON and RLS stories are weaker.

### Hand-written SQL + repositories over an ORM
Considered Prisma (great DX, but a codegen engine, its own migration DSL, and query patterns that get awkward for reporting SQL) and Drizzle (good, thin). We chose **`pg` + versioned SQL migrations + a thin repository layer** because:
1. **Ownership & transparency** — the user explicitly owns this system; plain SQL has zero magic, no generator lock-in, and every query is visible and explainable.
2. CRM workloads are query-shaped: filtered/paginated lists, aggregate reports, multi-table transactions. SQL is the right altitude; ORMs fight you exactly there.
3. Tenant isolation is enforced by convention + review: every repository method takes `orgId` and every query filters on it (verified by integration tests). This discipline is easier to audit in plain SQL.
The repository layer keeps SQL out of route handlers and makes the storage swappable/testable.

### JWT + refresh rotation over server sessions
The API serves web now and mobile in v2; stateless access tokens scale horizontally with no sticky sessions. Refresh tokens are stored **hashed** in Postgres, rotated on every use, and revocable (logout, deactivation) — addressing the classic "JWTs can't be revoked" objection at the only place it matters.

### React + Vite over Next.js
This is an authenticated app behind a login — SEO/SSR adds nothing, and SSR complicates self-hosting (a Node web server to run and scale). A static Vite bundle served by nginx (or any static host) + the REST API is simpler to deploy, cache, and reason about. React over Vue/Svelte: ecosystem depth and the React Native path for mobile v2.

### Tailwind v4 over a component library
A CRM lives or dies on information density and visual consistency; utility CSS with a small set of hand-rolled primitives (Button, Input, Modal, Table) gives us a distinctive, compact UI without fighting a kit's opinions, at ~10 KB of generated CSS. MUI/Chakra would be faster for week 1 and a tax forever after.

### Redis: required at scale, optional at start
Used for API rate limiting and (later) job queues + cache. To keep the "one $10 VPS" story honest, the code falls back to in-memory implementations when `REDIS_URL` is unset — correct on a single node, and the Compose file ships Redis on by default anyway.

### PGlite for tests
Tests run against **real Postgres semantics** (PGlite is Postgres compiled to WASM, in-process) with zero external services — the same migrations and SQL run in tests, CI (against a real PostgreSQL service container), and prod. No mocking of the database layer, so tenant-isolation and transaction bugs actually get caught.

## Explicitly rejected
- **GraphQL (v1)** — the UI's needs are met by purpose-built REST endpoints; GraphQL adds an authorization/complexity surface we'd rather not carry until third-party integrators demand it. The service layer is transport-agnostic, so adding it later is additive.
- **Microservices** — a modular monolith with strict module boundaries deploys as one container and can be split along module seams if/when scale demands. Starting with microservices would multiply ops burden for zero user value at this stage.
- **Serverless** — conflicts with self-hosting/local deployment requirements and complicates long-lived DB pools.
