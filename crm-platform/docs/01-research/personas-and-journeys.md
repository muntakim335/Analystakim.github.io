# User Personas & Journeys

## Personas

### P1 — Sara, Founder / Sales Lead (Admin)
- 34, runs a 12-person B2B services agency. Ran sales from spreadsheets + inbox; deals slip through cracks.
- **Goals:** one place for every prospect; know pipeline value this quarter; stop paying $60/seat elsewhere; own her data.
- **Frustrations:** CRMs that need a consultant to set up; per-seat pricing; export lock-in.
- **Usage:** daily 20-min pipeline review, weekly reports, occasional settings changes.

### P2 — Daniel, Account Executive (Member)
- 27, carries a quota, lives in the pipeline all day.
- **Goals:** fewer clicks per update; always know his next activity; log calls fast; mobile-friendly on the go.
- **Frustrations:** slow UIs, mandatory fields walls, duplicate data entry.
- **Usage:** all day — kanban, tasks, contact timelines, quick notes.

### P3 — Monica, Sales Manager (Manager)
- 41, manages 6 reps across 2 pipelines.
- **Goals:** accurate forecast, spot stuck deals, coach via activity data, reassign accounts when people leave.
- **Frustrations:** reports that don't match reality; reps not updating stages (needs automation nudges).
- **Usage:** dashboards & reports daily, workflow rules, team management.

### P4 — Alex, IT / Ops (deployer)
- 30, part-time ops at the agency. Deploys and maintains the instance.
- **Goals:** `docker compose up` and done; obvious backup story; logs and health checks; no surprise phone-home.
- **Usage:** initial deployment, upgrades, backup verification, user provisioning support.

## Key user journeys

### J1 — First-run (Sara): register → productive in 5 minutes
1. Opens the app → **Create your organization** (org name, her name, email, password).
2. Lands on dashboard; a default "Sales" pipeline (Qualified → Contacted → Demo → Proposal → Won/Lost) is already seeded, with a short empty-state guide.
3. Imports her spreadsheet: Contacts → Import CSV → maps columns → 240 contacts in, 3 duplicate rows reported.
4. Invites Daniel and Monica from Settings → Team (role picker), creates her first deal from a contact page.
5. **Success:** pipeline shows value; nothing configured beyond defaults.

### J2 — Daily selling (Daniel): lead → won deal
1. New lead arrives (created via API from the website form). Workflow rule "when lead created → create task 'First call within 24h' for owner + notify" fires; Daniel sees the notification badge.
2. Calls the lead, logs a note, sets status *contacted* → *qualified*.
3. Clicks **Convert** → wizard pre-fills Contact + Company + a Deal ("ACME – Web redesign", $12,000, stage Qualified). One click, all linked, lead archived as converted.
4. Works the deal on the kanban: drags Demo → Proposal; the stage-change workflow creates a "Send proposal" task due in 2 days.
5. Marks the deal **Won** → close date stamped, dashboard revenue updates, Monica gets a notification.

### J3 — Monday review (Monica): forecast & unblock
1. Opens dashboard: pipeline funnel, won-this-month vs last, leaderboard.
2. Filters deals list to "no activity in 14 days" via last-updated sort; finds 4 stalled deals; reassigns one, adds tasks for the others.
3. Checks the audit log to see who edited a deal's value before the forecast call.

### J4 — Deployment (Alex)
1. Copies `deploy/.env.example` → sets secrets/domain → `docker compose up -d`.
2. Points DNS at the box; the bundled reverse-proxy guidance issues TLS via Let's Encrypt.
3. Enables the nightly `pg_dump` cron from the backup guide; verifies a restore into a scratch container.
4. Health checks wired to uptime monitor; done in an afternoon.

## Journey-driven design decisions
- Seed a usable pipeline at registration (J1) — no empty-state configuration wall.
- Lead conversion is a single atomic action producing linked records (J2) — the moment most cheap CRMs fumble.
- Every list supports owner/status filters and updated-at sorting (J3) — manager workflows are list-driven.
- One-file Docker Compose with health checks and documented backup/restore (J4) — ops is a first-class persona.
