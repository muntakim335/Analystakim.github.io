# NimbusCRM — User Manual

## Getting started

1. **Create your organization** — open the app, click *Create your organization*, fill in the four fields. You become its first **Admin**, and a ready-made **Sales** pipeline (Qualified → Demo Scheduled → Proposal Sent → Negotiation → Won/Lost) is waiting for you.
2. **Invite your team** — *Settings → Team → Invite user*. Give each person a role:
   - **Admin** – everything, including settings and the audit log
   - **Manager** – all records, pipelines and workflows; no user management
   - **Member** – daily selling; can't change settings or delete others' records
3. **Bring your data** — *Contacts → Import CSV*. Map-free import: headers like `First Name, Last Name, Email, Phone, Title` are detected automatically; rows matching an existing email are skipped and reported.

## The daily loop

**Leads** are unqualified prospects (from the *+ New lead* button, a CSV, or your website via the API). Work them through *new → contacted → qualified*, then press **Convert**: one click creates the **contact**, links or creates the **company**, and (optionally) opens a **deal** — everything cross-linked, the lead archived as *converted*.

**Deals** live on the kanban board (*Deals*). Drag cards between stages; each column shows its deal count and total value. Dragging into **Won**/**Lost** closes the deal (or open a card and use *Mark won / Mark lost*). Use the pipeline selector to switch pipelines, *Export* for CSV.

**Contacts** — click any row for the full picture: details and custom fields on the left; **Timeline** (every touch, automatic), **Notes**, and **Tasks** tabs on the right.

**Tasks** — *Tasks* shows *My tasks* by default; filter by status or due (*Overdue*, *Due today*, *Next 7 days*). Assigning a task to someone notifies them (bell icon; email too if your admin configured SMTP).

**Find anything** with the search bar at the top — it looks across contacts, companies, leads and deals as you type.

## The dashboard

Live KPIs (open pipeline value, won this month vs last, new leads, overdue tasks), pipeline value by stage, revenue won by month, lead sources with conversion rates, your upcoming tasks, and the team's recent activity.

## Automating busywork (Admin/Manager)

*Settings → Workflows → New workflow* builds plain-language recipes:

> **When** a lead is created **if** source equals `website` **then** create a task "Call within 24h" for the owner.

Triggers cover lead/contact/deal creation, stage changes, wins/losses, task completion. Actions: create a task, notify the owner. Toggle any workflow on/off; every run is logged.

## Customizing (Admin)

- **Custom fields** (*Settings → Custom fields*): add text/number/date/dropdown/checkbox fields to contacts, companies, leads or deals — they appear in every form, detail page, export and the API.
- **Pipelines** (*Settings → Pipelines*): rename, add stages, set win-probabilities (used for weighted pipeline value), add more pipelines (e.g., "Renewals"), pick the default.

## Your data is yours

- **Export** buttons on Contacts, Companies and Deals produce CSVs anytime.
- Everything is also available over the REST API (ask your developer; see the developer guide).
- Admins can review the **audit log** — every change, who made it, and what exactly changed.

## Tips

- Dark mode: the ☾/☀ toggle, top right. Your choice is remembered.
- The fastest CRM habit: after every call, add a note and a next task from the contact page. The timeline builds itself.
- Deleted something by accident? Tell your admin — the audit log shows what was lost, and nightly backups can bring it back.
