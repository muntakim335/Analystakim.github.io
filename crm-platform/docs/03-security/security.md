# Security Documentation

## Threat model (summary)

Multi-tenant SaaS-style CRM holding PII (names, emails, phones) and commercial data (deals, values). Primary risks: cross-tenant data leakage, account takeover, privilege escalation, injection, data exfiltration by departing staff, and loss of data. The controls below map to each.

## Authentication

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost 12 (`BCRYPT_ROUNDS`), per-password salt |
| Login timing | unknown emails verify against a dummy hash — no user-enumeration timing oracle; login/register/refresh return identical errors for wrong email vs wrong password |
| Sessions | access JWT 15 min (`HS256`, `JWT_SECRET` ≥ 16 chars enforced, prod refuses the dev default) + opaque 256-bit refresh token, 30 days |
| Refresh tokens | stored **SHA-256-hashed**, single-use (rotated on every refresh), revocable; replay of a rotated token is rejected |
| Logout / password change / deactivation | revoke refresh tokens (password change revokes *all* sessions) |
| Brute force | per-IP rate limit on auth endpoints (20/min default), per-user elsewhere (300/min) |

## Authorization (RBAC)

Enforced **server-side on every route**; the UI only hides what the API already refuses.

| Capability | Admin | Manager | Member |
|---|---|---|---|
| CRUD own records (contacts/companies/leads/deals/tasks/notes/files) | ✓ | ✓ | ✓ |
| Delete/edit records owned by others | ✓ | ✓ | notes/files: no; records: no |
| Pipelines & stages, workflows | ✓ | ✓ | read-only |
| Custom fields | ✓ | — | read-only |
| User management (invite, roles, deactivate) | ✓ | — | — |
| Audit log | ✓ | — | — |

Safety rails: the last active admin can be neither demoted nor deactivated; users are deactivated, never deleted (history integrity).

## Tenant isolation

- `org_id` is taken **only** from the verified JWT, never from client input.
- Every repository query filters by `org_id`; cross-tenant references (companyId, pipelineId, stageId, contactId) are validated against the caller's org before use.
- Cross-tenant reads return `404` (no existence leak), verified by automated tests (`test/rbac-tenancy.test.ts`).
- Hardening path documented: PostgreSQL Row-Level Security with `SET app.current_org` as a second enforcement layer.

## Input & output safety

- All input validated with zod (types, lengths, formats, enums); unknown custom-field keys rejected; custom field values type-checked against admin-defined schemas.
- 100% parameterized SQL (`$n` placeholders). The only interpolated identifiers (sort columns, tables) come from hardcoded whitelists.
- React escapes output by default; no `dangerouslySetInnerHTML` anywhere; notes render as plain text.
- File uploads: MIME allow-list (documents/images only — no executables/HTML/SVG), size cap (`MAX_UPLOAD_MB`), stored under app-generated UUID keys (user filenames never touch the filesystem), path-traversal guard in the storage layer, downloads served as `attachment`.
- CSV import capped at 5,000 rows; CSV exports stringify via `csv-stringify` (proper quoting).

## Transport & headers

- TLS terminates at the edge proxy (deployment guide covers Caddy/Let's Encrypt); HSTS set there.
- `@fastify/helmet` security headers on the API; nginx adds `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` for the SPA.
- CORS: configurable allow-list (`CORS_ORIGIN`); same-origin deployment by default (SPA and API behind one host).
- Tokens are sent via `Authorization` header (no cookies → no CSRF surface for state-changing calls).

## Audit & accountability

Append-only `audit_logs`: every create/update/delete with actor, entity, field-level before/after diff, written **in the same transaction** as the mutation. Admin-only API, filterable by entity/actor. No delete/update endpoints exist for audit rows.

## Secrets & configuration

Secrets come exclusively from environment variables (`.env` files are git-ignored; `.env.example` documents every knob). Production boot **fails** if `JWT_SECRET` is left at the dev default. No secrets ever appear in logs; pino logs structured request metadata, not bodies.

## Dependency & supply-chain

Small, mainstream dependency set (Fastify core plugins, pg, zod, bcryptjs, csv-*, nodemailer). Lockfiles committed; CI installs with `npm ci`. Recommended cadence: `npm audit` monthly and before releases; Dependabot/Renovate on the repo.

## Operational security checklist (pre-launch)

- [ ] `JWT_SECRET` and `POSTGRES_PASSWORD` generated with `openssl rand`
- [ ] TLS live and HSTS enabled at the proxy; port 5432/6379 not exposed publicly
- [ ] `CORS_ORIGIN` set to the real origin (not `*`)
- [ ] Backups running and a restore actually tested (see backup-dr.md)
- [ ] Error tracking hooked (Sentry DSN or equivalent) and log retention defined
- [ ] Admin accounts use strong unique passwords; team roles reviewed
