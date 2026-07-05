# REST API Specification

Base URL: `/api/v1`. JSON in/out. Auth: `Authorization: Bearer <access JWT>` on everything except `/auth/register|login|refresh` and health endpoints. A machine-readable OpenAPI description is served by the running API at **`GET /api/openapi.json`**.

## Conventions

- **IDs**: UUID strings.
- **Pagination**: `?page=1&limit=25` (limit ≤ 100). List responses: `{ "data": [...], "page": 1, "limit": 25, "total": 342 }`.
- **Sorting**: `?sort=created_at&order=desc` (whitelisted columns per resource).
- **Filtering**: documented per resource below; `?q=` for text search within a list.
- **Errors**: `{ "error": { "code": "NOT_FOUND", "message": "Contact not found" } }` with matching HTTP status. Validation errors: `422` with `details` array. Codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION` 422, `RATE_LIMITED` 429, `INTERNAL` 500.
- **Tenancy**: org is derived from the token; cross-org access returns `404`.
- **Custom fields**: records accept/return a `custom` object validated against the org's field definitions.
- **Timestamps**: ISO-8601 UTC.
- **Rate limits**: 20/min on auth endpoints per IP; 300/min per user elsewhere (configurable).

## Endpoints

### Auth & session
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{orgName, name, email, password}` → creates org + admin + seeded pipeline; returns tokens + user |
| POST | `/auth/login` | public | `{email, password}` → `{accessToken, refreshToken, user}` |
| POST | `/auth/refresh` | public | `{refreshToken}` → rotated pair |
| POST | `/auth/logout` | any | revokes presented refresh token |
| GET | `/auth/me` | any | current user + org |
| PATCH | `/auth/me` | any | update own name/password (`currentPassword` required for password) |

### Users (team)
| Method | Path | Role |
|---|---|---|
| GET | `/users` | any (for owner pickers) |
| POST | `/users` | admin — `{name, email, password, role}` |
| PATCH | `/users/:id` | admin — role, name, is_active; cannot demote/deactivate the last admin |
| DELETE | `/users/:id` | admin — deactivates (never hard-deletes; records keep history) |

### Contacts / Companies / Leads (uniform CRUD shape)
| Method | Path | Notes |
|---|---|---|
| GET | `/contacts` | `?q=&owner_id=&company_id=&sort=&order=&page=&limit=` |
| POST | `/contacts` | |
| GET | `/contacts/:id` | includes company & owner summaries |
| PATCH | `/contacts/:id` | partial update; custom fields merged |
| DELETE | `/contacts/:id` | member may delete own; manager/admin any |
| GET | `/contacts/export` | CSV stream of current filter |
| POST | `/contacts/import` | multipart CSV; `{created, skipped, errors[]}`; dedupe by email |

`/companies` — same shape; filters `?q=&owner_id=&industry=`; export.
`/leads` — same shape; filters `?q=&status=&source=&owner_id=`; plus:

| POST | `/leads/:id/convert` | `{createCompany?, companyId?, contactId?, deal?: {title, value, pipelineId?, stageId?}}` → atomic conversion; returns created/linked ids |

### Pipelines & deals
| Method | Path | Role / notes |
|---|---|---|
| GET | `/pipelines` | with ordered stages |
| POST | `/pipelines` | admin/manager |
| PATCH | `/pipelines/:id` | admin/manager; rename, set default |
| DELETE | `/pipelines/:id` | admin; refused if deals exist (409) |
| POST | `/pipelines/:id/stages` | admin/manager |
| PATCH | `/stages/:id` | rename/reorder/probability |
| DELETE | `/stages/:id` | refused if deals in stage (409) |
| GET | `/deals` | `?q=&pipeline_id=&stage_id=&status=&owner_id=` |
| GET | `/deals/board?pipeline_id=` | kanban: stages with ordered deal cards + per-stage totals |
| POST | `/deals` | |
| GET/PATCH/DELETE | `/deals/:id` | |
| POST | `/deals/:id/move` | `{stageId}` — kanban drag; emits `deal.stage_changed` |
| POST | `/deals/:id/close` | `{status: won\|lost, reason?}` |
| GET | `/deals/export` | CSV |

### Tasks, notes, files
| Method | Path | Notes |
|---|---|---|
| GET | `/tasks` | `?assignee_id=&status=&due=overdue\|today\|week&related_type=&related_id=` |
| POST/PATCH/DELETE | `/tasks[/:id]` | `POST /tasks/:id/complete` emits `task.completed` |
| GET/POST/PATCH/DELETE | `/notes[/:id]` | `?related_type=&related_id=` required on list |
| POST | `/files` | multipart; `related_type`,`related_id` fields |
| GET | `/files` / `/files/:id/download` / DELETE `/files/:id` | |

### Timeline, search, notifications, audit
| Method | Path | Notes |
|---|---|---|
| GET | `/activities` | `?entity_type=&entity_id=` (record timeline) or unfiltered (org feed) |
| GET | `/search?q=` | grouped results: contacts, companies, leads, deals (top 5 each) |
| GET | `/notifications` | `?unread=1`; `POST /notifications/read` `{ids?}` (omit = all) |
| GET | `/audit-logs` | admin; `?entity_type=&entity_id=&actor_id=&page=` |

### Customization & automation
| Method | Path | Role |
|---|---|---|
| GET | `/custom-fields?entity_type=` | any |
| POST/PATCH/DELETE | `/custom-fields[/:id]` | admin |
| GET/POST/PATCH/DELETE | `/workflows[/:id]` | admin/manager |
| GET | `/workflows/:id/runs` | admin/manager — execution log |

Workflow shape:
```json
{
  "name": "First-call SLA",
  "triggerType": "lead.created",
  "conditions": [{ "field": "source", "op": "eq", "value": "website" }],
  "actions": [
    { "type": "create_task", "title": "Call within 24h", "dueInDays": 1, "assign": "owner" },
    { "type": "notify", "target": "owner", "message": "New website lead assigned to you" }
  ],
  "isActive": true
}
```
Triggers: `lead.created`, `deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost`, `task.completed`, `contact.created`.
Condition ops: `eq, neq, gt, lt, gte, lte, contains, is_set, not_set` (dot-paths reach `custom.*`).
Actions: `create_task`, `notify`, `update_field`, `send_email` (requires SMTP; logged as skipped otherwise).

### Reports & dashboard
| Method | Path | Returns |
|---|---|---|
| GET | `/reports/overview` | KPI tiles: open deals count/value, won this month (count/value/Δ vs prev), new leads (30d), overdue tasks, contacts total |
| GET | `/reports/pipeline?pipeline_id=` | per-stage: count, value, weighted value |
| GET | `/reports/revenue?months=12` | won value+count per month |
| GET | `/reports/lead-sources` | count + conversion rate per source |
| GET | `/reports/leaderboard?period=month` | per owner: won count/value, open value |

### Health
`GET /healthz` (liveness, no auth) · `GET /readyz` (DB ping, no auth).
