# Roadmap

v1.0 (shipped, this repo) covers the MVP defined in the PRD: multi-tenant auth & RBAC, contacts/companies/leads + conversion, pipelines & kanban deals, tasks/notes/timeline, audit log, custom fields, workflow automation, notifications, files, global search, dashboards & reports, CSV import/export, REST API, dark-mode responsive web app, Docker deployment, CI, full docs.

## v1.x — near-term (weeks each)

| Item | Notes |
|---|---|
| Email sending polish | Invite emails, daily digest; SMTP adapter already shipped |
| Saved views & bulk actions | Persisted filters per user; multi-select edit/delete/assign in tables |
| Calendar view | Tasks + expected close dates; ICS feed export |
| Webhooks out | `workflows` action `call_webhook` + signing secret — the recipe engine already isolates actions |
| S3 storage adapter | Interface exists (`lib/storage.ts`); unblocks multi-replica API |
| Trigram search | `pg_trgm` GIN indexes behind the existing `/search` endpoint |

## v2 — mobile & integrations (months)

| Item | Notes |
|---|---|
| **Mobile apps (iOS/Android)** | React Native (Expo) consuming the same REST API + refresh-token auth; offline-first task list first, then kanban |
| Email sync | IMAP + Gmail/Microsoft Graph OAuth; thread-to-contact matching; per-user mailbox worker (extracted service) |
| SMS (Twilio adapter) | Same adapter pattern as Mailer |
| Quotes & invoices | Products/price-book tables, PDF generation, deal → quote → invoice flow |
| Customer portal | Separate lightweight app; portal users are a new principal type (schema reserves the seam) |
| GraphQL (optional) | Additive gateway over the service layer if integrators demand it |
| SSO/SAML + SCIM | Enterprise auth tier |
| Job queue | BullMQ on existing Redis for workflow engine + email workers |

## v3 — scale & intelligence

Row-Level Security as a second tenancy wall; report rollup tables → read replica → warehouse; lead scoring & forecasting (the activity/audit data model already captures the signals); knowledge base & internal chat; plugin/app marketplace surface.

Each roadmap item was considered in the v1 architecture — adapters, event bus, and schema seams exist so none of them require rewrites.
