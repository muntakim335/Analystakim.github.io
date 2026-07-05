# Phase 1 — Market Research: Leading CRM Platforms

*Prepared: July 2026. Pricing figures are approximate list prices in USD as of early 2026 and change frequently — treat them as directional.*

## 1. The competitive landscape

| Platform | Category | Sweet spot | Approx. pricing (per user/mo) |
|---|---|---|---|
| **Salesforce Sales Cloud** | Enterprise suite | Large sales orgs, deep customization | $25 (Starter) → $165 (Pro) → $330+ (Enterprise/Unlimited) |
| **HubSpot** | Inbound marketing + CRM | SMB → mid-market, marketing-led growth | Free tier; Starter ~$15–20; Pro ~$90–100; Enterprise ~$150+ |
| **Microsoft Dynamics 365 Sales** | Enterprise suite | Microsoft-ecosystem enterprises | ~$65 (Pro) → ~$105 (Enterprise) → ~$135+ (Premium) |
| **Zoho CRM** | Value suite | Cost-sensitive SMBs, broad feature set | ~$14 → ~$23 → ~$40 → ~$52 |
| **Pipedrive** | Sales-focused CRM | Small sales teams who live in the pipeline | ~$14 → ~$29 → ~$49 → ~$64 |
| **Monday.com (Sales CRM)** | Work-OS turned CRM | Teams wanting flexible boards/automation | ~$12 → ~$17 → ~$28 (per seat, 3-seat min) |
| **Freshsales / Attio / Close** | Challengers | Modern UX niches | ~$9–$49 |

## 2. Per-platform analysis

### Salesforce Sales Cloud
- **Core features**: leads, accounts, contacts, opportunities, forecasting, Flow automation, Einstein AI scoring, AppExchange marketplace, extreme customizability (custom objects, Apex, permission sets).
- **Strengths**: the most complete data model in the industry (Lead → Account/Contact/Opportunity is the canonical CRM model); enterprise-grade RBAC and audit; ecosystem.
- **Weaknesses**: steep learning curve, admin-heavy, expensive TCO (consultants often required), dated UX in places, aggressive upselling of add-ons.
- **Lesson for us**: adopt its *data model* (it is the industry lingua franca) but not its complexity. Custom fields/objects and a real permission model are table stakes for growing orgs.

### HubSpot
- **Core features**: free CRM core, marketing automation, email tracking/sequences, meeting scheduling, reporting dashboards, lifecycle stages.
- **Strengths**: best-in-class onboarding and UX; free tier drives adoption; everything feels integrated; excellent docs/academy.
- **Weaknesses**: gets expensive very fast at Pro/Enterprise; limited deep customization; reporting caps; data lives in HubSpot's cloud only.
- **Lesson for us**: onboarding friction kills CRMs. Sign-up → first pipeline in under 2 minutes. Sensible defaults (a ready-made pipeline, example stages) beat configuration wizards.

### Microsoft Dynamics 365
- **Strengths**: deep Office/Teams/Outlook integration, Power Platform automation, enterprise compliance.
- **Weaknesses**: fragmented licensing, heavyweight UX, hard to self-implement.
- **Lesson for us**: email/calendar integration is a top-3 feature request in every CRM; design for it early (adapter interfaces), even if v1 ships with SMTP/IMAP basics.

### Zoho CRM
- **Strengths**: enormous feature breadth for the price (workflows, scoring, Blueprint process management); good API.
- **Weaknesses**: UX inconsistency across its 40+ app suite; feature depth is shallow in places.
- **Lesson for us**: breadth without polish creates churn. Ship fewer features, each complete: e.g., if we ship custom fields, they must work in forms, tables, filters, import/export and the API.

### Pipedrive
- **Strengths**: the best pipeline/kanban UX in the industry; activity-based selling methodology ("always have a next activity scheduled"); fast.
- **Weaknesses**: weak for non-sales use cases; limited reporting; simple permission model.
- **Lesson for us**: the deal kanban is the emotional core of a sales CRM. Drag-and-drop stage changes with instant feedback, visible deal value per stage, and rotting/idle indicators.

### Monday.com
- **Strengths**: flexible board metaphor, visual automation recipes ("when X happens, do Y"), delightful UI, fast time-to-value.
- **Weaknesses**: not a true CRM data model (relations are bolted on); scales poorly for complex sales orgs; per-seat pricing with minimums.
- **Lesson for us**: automation should be expressible as plain-language recipes (trigger → condition → action), not flowchart programming. Our workflow engine follows this model.

## 3. Cross-cutting findings

1. **The canonical data model** is stable across the industry: *Leads* (unqualified) are **converted** into *Contacts* (people) + *Companies/Accounts* (organizations) + *Deals/Opportunities* (revenue events moving through a *Pipeline* of *Stages*), surrounded by *Activities* (tasks, notes, emails, calls, meetings). We adopt this model — users coming from any incumbent will feel at home, and imports map cleanly.
2. **Pricing models** are per-user/month with feature-gated tiers; the pain points customers cite are seat minimums, feature paywalls (e.g., automation counts), and API rate-limit tiers. As a self-hosted product we sidestep all of this — a genuine differentiator.
3. **Top switching triggers** (from public review mining on G2/Capterra themes): price increases, data lock-in, unused complexity, poor support, slow UI. Our positioning: *own your CRM* — self-hosted, portable data (CSV/API), no per-seat tax.
4. **Universal MVP feature set** (present in every leading product's lowest paid tier): contact/company management, deal pipeline (kanban), tasks & activity timeline, notes, basic reporting dashboard, search, import/export, user roles, email notifications, mobile access, REST API.
5. **Differentiating-but-expected at mid-tier**: workflow automation, custom fields, multiple pipelines, audit trail, file attachments, team permissions.
6. **Enterprise tier**: SSO/SAML, advanced RBAC, sandboxes, audit/compliance exports, dedicated infra. These inform architecture (multi-tenancy, audit log from day 1) but not MVP UI.

## 4. MVP vs later — decision

**MVP (build now):** auth + org multi-tenancy, users & roles, contacts, companies, leads + conversion, pipelines/stages, deals + kanban, tasks, notes, activity timeline, audit log, custom fields, workflow automation (recipe-style), in-app notifications, file uploads, global search, dashboards & core reports, CSV import/export, REST API + OpenAPI, dark mode, responsive web.

**Version 2 (designed for, not built):** email sync (IMAP/Gmail/Microsoft Graph), SMS (Twilio adapter), customer portal, quotes & invoices, products/price books, knowledge base, project management & time tracking, internal chat, GraphQL, native mobile apps (React Native), SSO/SAML, per-record sharing rules, webhooks marketplace.

Rationale: every V2 item either (a) requires third-party accounts we cannot assume (email OAuth, Twilio), (b) is a separate product surface (portal, KB, projects), or (c) is an enterprise sale enabler rather than a daily-use feature. The MVP list is exactly what a 2–50 person sales team needs to run their entire process on day one.
