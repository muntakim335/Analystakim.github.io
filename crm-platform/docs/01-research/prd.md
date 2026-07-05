# Product Requirements Document — NimbusCRM v1.0

**Status:** Approved for build · **Owner:** Product · **Last updated:** July 2026

## 1. Vision

A self-hosted, multi-tenant CRM that a small-to-mid-size business can deploy in minutes, own outright (code + data + infrastructure), and run its entire sales process on: capture leads, qualify and convert them, move deals through a visual pipeline, coordinate the team's tasks and follow-ups, and understand performance through reports — with the polish of HubSpot and the pipeline ergonomics of Pipedrive, minus the per-seat tax and lock-in.

## 2. Goals & non-goals

**Goals (v1)**
1. A team of 2–50 can run its full sales workflow with no other tool.
2. Zero-to-productive in < 5 minutes: register → seeded pipeline → first contact created.
3. All data exportable at any time (CSV + full REST API).
4. Enterprise-shaped foundations even at MVP: multi-tenancy, RBAC, audit log, custom fields, automation.
5. Deployable by one person with Docker Compose on a $10 VPS; scalable later to Kubernetes.

**Non-goals (v1)** — see roadmap: marketing automation/campaigns, email inbox sync, billing/invoicing, customer support ticketing, AI features, native mobile apps (the web app is fully responsive; a React Native app consumes the same API in v2).

## 3. Functional requirements

### 3.1 Identity, tenancy & access
- **FR-1** Self-service registration creates an *organization* (tenant) and its first *admin* user. All data is strictly scoped to the organization.
- **FR-2** JWT-based auth: short-lived access token (15 min) + rotating refresh token (30 days, revocable). Password login with bcrypt hashing; change-password; logout revokes refresh tokens.
- **FR-3** Roles: **Admin** (everything incl. settings, users, billing-future), **Manager** (all records + reports, no org settings), **Member** (work records; cannot manage users/pipelines/custom fields/workflows or delete other users' records).
- **FR-4** Admins invite/manage users (create, deactivate, change role). Deactivated users cannot log in; their records remain.

### 3.2 Core CRM objects
- **FR-5 Contacts**: people; fields: name, email, phone, title, company link, owner, custom fields; full CRUD, list with search/sort/filter/pagination, detail view with timeline, notes, tasks, deals, files.
- **FR-6 Companies**: organizations; fields: name, domain, industry, size, website, phone, address, owner, custom fields; linked contacts and deals.
- **FR-7 Leads**: unqualified prospects with source and status (new → contacted → qualified → unqualified/converted). **Conversion** creates (or links) a Contact, optionally a Company and a Deal, atomically, and marks the lead converted with links back.
- **FR-8 Pipelines & stages**: multiple pipelines; ordered stages with win-probability; stages flagged Won/Lost. A default pipeline ("Sales") with 5 stages is seeded at registration.
- **FR-9 Deals**: title, value+currency, pipeline/stage, expected close date, contact, company, owner, status open/won/lost, custom fields. Kanban board with drag-and-drop stage moves; won/lost closing with timestamps.
- **FR-10 Tasks**: title, description, due date, priority, assignee, status, optional link to any record (contact/company/deal/lead). "My tasks" and overdue views.
- **FR-11 Notes**: rich-text-lite (plain text v1) notes attached to any record, with author and timestamps.
- **FR-12 Activity timeline**: every meaningful event (created, updated, stage changed, note added, task completed, lead converted, file uploaded) appears chronologically on the related record and in a global feed.
- **FR-13 Files**: upload attachments to any record (size/type limits configurable); download; delete. Storage is pluggable (local disk v1, S3-compatible adapter interface).

### 3.3 Customization & automation
- **FR-14 Custom fields** per entity (contact/company/lead/deal): text, number, date, single-select, checkbox; admin-managed; values available in forms, detail pages, API, import/export.
- **FR-15 Workflow automation** (recipe model): *When* [trigger: lead created / deal created / deal stage changed / deal won / task completed] *if* [field conditions] *then* [actions: create task, notify user, update field, send email*]. Enable/disable per workflow; execution is logged. (*Email action requires SMTP configured; otherwise it records a skipped action.)

### 3.4 Findability & insight
- **FR-16 Global search** across contacts, companies, leads, deals from the top bar (prefix + substring match, org-scoped).
- **FR-17 List filtering**: per-column sort, text search, owner filter, and entity-specific filters (stage, status, source); server-side pagination throughout.
- **FR-18 Dashboard**: KPI tiles (open deals count/value, won this month, new leads, overdue tasks), pipeline funnel by stage, revenue won by month (12 mo), leads by source, my upcoming tasks.
- **FR-19 Reports API**: pipeline summary, sales over time, lead sources, team leaderboard (deals won/value per owner), activity counts.

### 3.5 Collaboration & notifications
- **FR-20 In-app notifications**: on task assignment, deal assignment, workflow "notify" actions; unread badge; mark-as-read. Email notification delivery when SMTP is configured.
- **FR-21 Audit log**: every create/update/delete records actor, timestamp, entity, and field-level changes; admin-viewable, filterable, immutable (append-only).

### 3.6 Data portability & API
- **FR-22 CSV import** for contacts (header mapping, dedupe by email, error report) and CSV export for contacts, companies, and deals (respecting current filters).
- **FR-23 REST API**: everything the UI does is available via documented REST endpoints (OpenAPI description served at `/api/openapi.json`); token auth; per-IP and per-user rate limiting.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | P95 API latency < 200 ms at 100 concurrent users on a 2-vCPU host; list endpoints paginated (max 100/page); all tenant-scoped queries index-backed. |
| Scale | Schema and queries designed for 1,000+ orgs / 5M+ records per table (org_id composite indexes; no cross-tenant scans). Stateless API → horizontal scaling behind a load balancer. |
| Security | OWASP ASVS-informed: parameterized SQL only, bcrypt(12), JWT with rotation + revocation, RBAC enforced server-side, rate limiting, security headers, strict input validation (zod), tenant isolation enforced in every query, secrets via env only. |
| Availability | Single-node Docker target 99.5%; DR: nightly `pg_dump` + WAL archiving guidance; RPO ≤ 24h (nightly) or ≤ 5min (WAL), RTO ≤ 1h documented runbook. |
| Accessibility | WCAG 2.1 AA intent: semantic HTML, keyboard operability, visible focus, ≥ 4.5:1 text contrast in both themes, labels on all inputs. |
| Compatibility | Evergreen browsers; responsive ≥ 360 px wide; dark & light themes. |
| Observability | Structured JSON logs (pino), request IDs, health endpoints (`/healthz`, `/readyz`), error tracking hook (Sentry-compatible, optional). |
| Maintainability | TypeScript end-to-end, layered architecture (routes → services → repositories), migrations as versioned SQL, CI running typecheck+lint+tests on every push. |

## 5. Success metrics (post-launch)
- Time-to-first-contact-created < 5 min for a new org (instrument onboarding funnel).
- Weekly active users / seats > 60%.
- P95 latency and error rate within NFR budgets (dashboards).
- Zero cross-tenant data incidents (audit + tests enforce).

## 6. Release criteria (v1)
All FRs implemented and covered by automated tests; integration suite green in CI; security checklist (docs/03-security) passing; Docker Compose deployment verified from a clean host following the deployment guide alone.
