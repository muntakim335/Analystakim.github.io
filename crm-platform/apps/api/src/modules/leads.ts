import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { diff, logActivity, logAudit } from '../lib/common.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { ListQuery, runList } from '../lib/listing.js';
import { mergeCustom, validateCustom } from '../lib/custom-fields.js';
import { parse } from '../lib/validate.js';

const LeadStatus = z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']);

const LeadBody = z.object({
  name: z.string().trim().min(1).max(300),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  companyName: z.string().trim().max(300).nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  status: LeadStatus.exclude(['converted']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  custom: z.record(z.unknown()).optional(),
});

const ConvertBody = z.object({
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  createCompany: z.boolean().default(true),
  deal: z
    .object({
      title: z.string().trim().min(1).max(300),
      value: z.number().min(0).max(999_999_999_999).default(0),
      currency: z.string().length(3).default('USD'),
      pipelineId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
      expectedCloseDate: z.string().date().optional(),
    })
    .optional(),
});

const SELECT = `SELECT t.id, t.name, t.email, t.phone, t.company_name AS "companyName", t.source,
  t.status, t.owner_id AS "ownerId", t.custom,
  t.converted_contact_id AS "convertedContactId", t.converted_deal_id AS "convertedDealId",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt", u.name AS "ownerName"
  FROM leads t LEFT JOIN users u ON u.id = t.owner_id`;

export function registerLeads(app: FastifyInstance, ctx: AppCtx): void {
  const { db, bus } = ctx;

  async function getOwned(orgId: string, id: string) {
    const r = await db.query(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    if (!r.rows[0]) throw notFound('Lead');
    return r.rows[0];
  }

  app.get('/leads', { preHandler: app.authenticate }, async (request) => {
    const params = parse(ListQuery, request.query);
    const extra = parse(
      z.object({
        status: LeadStatus.optional(),
        source: z.string().optional(),
        owner_id: z.string().uuid().optional(),
      }),
      request.query
    );
    return runList(db, request.actor.orgId, {
      table: 'leads',
      select: SELECT,
      searchColumns: ['t.name', 't.email', 't.company_name'],
      sortable: { name: 't.name', created_at: 't.created_at', updated_at: 't.updated_at', status: 't.status' },
      defaultSort: 't.created_at',
      filters: { status: extra.status, source: extra.source, owner_id: extra.owner_id },
    }, params);
  });

  app.get('/leads/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return getOwned(request.actor.orgId, id);
  });

  app.post('/leads', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(LeadBody, request.body);
    const { actor } = request;
    const custom = await validateCustom(db, actor.orgId, 'lead', body.custom, { partial: false });
    const id = newId();
    const ownerId = body.ownerId ?? actor.id;
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO leads (id, org_id, name, email, phone, company_name, source, status, owner_id, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, actor.orgId, body.name, body.email ?? null, body.phone ?? null,
          body.companyName ?? null, body.source ?? null, body.status ?? 'new', ownerId,
          JSON.stringify(custom),
        ]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'created',
        entityType: 'lead', entityId: id, payload: { name: body.name },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'lead.created',
        entityType: 'lead', entityId: id,
      });
    });
    bus.emit({
      type: 'lead.created', orgId: actor.orgId, actorId: actor.id,
      entityType: 'lead', entityId: id,
      data: { name: body.name, email: body.email ?? null, source: body.source ?? null, status: body.status ?? 'new', ownerId },
    });
    return reply.status(201).send(await getOwned(actor.orgId, id));
  });

  app.patch('/leads/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(LeadBody.partial(), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (existing.status === 'converted') throw conflict('Converted leads are read-only');
    const validated = await validateCustom(db, actor.orgId, 'lead', body.custom, { partial: true });
    const custom = body.custom ? mergeCustom(existing.custom, validated) : existing.custom;

    await db.tx(async (q) => {
      await q.query(
        `UPDATE leads SET
           name = COALESCE($1, name),
           email = CASE WHEN $2 THEN $3 ELSE email END,
           phone = CASE WHEN $4 THEN $5 ELSE phone END,
           company_name = CASE WHEN $6 THEN $7 ELSE company_name END,
           source = CASE WHEN $8 THEN $9 ELSE source END,
           status = COALESCE($10, status),
           owner_id = CASE WHEN $11 THEN $12::uuid ELSE owner_id END,
           custom = $13,
           updated_at = now()
         WHERE id = $14 AND org_id = $15`,
        [
          body.name ?? null,
          body.email !== undefined, body.email ?? null,
          body.phone !== undefined, body.phone ?? null,
          body.companyName !== undefined, body.companyName ?? null,
          body.source !== undefined, body.source ?? null,
          body.status ?? null,
          body.ownerId !== undefined, body.ownerId ?? null,
          JSON.stringify(custom), id, actor.orgId,
        ]
      );
      const changes = diff(existing, { ...body, custom } as Record<string, unknown>);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'lead.updated',
        entityType: 'lead', entityId: id, changes,
      });
      if (changes.status) {
        await logActivity(q, {
          orgId: actor.orgId, actorId: actor.id, type: 'status_changed',
          entityType: 'lead', entityId: id,
          payload: { from: existing.status, to: body.status },
        });
      }
    });
    return getOwned(actor.orgId, id);
  });

  app.delete('/leads/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (actor.role === 'member' && existing.ownerId !== actor.id) {
      throw forbidden('Members can only delete leads they own');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM leads WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'lead.deleted',
        entityType: 'lead', entityId: id, changes: { name: { from: existing.name, to: null } },
      });
    });
    return { ok: true };
  });

  /**
   * Atomic lead conversion: creates/links a Contact, optionally a Company and a Deal,
   * marks the lead converted with back-references. Everything or nothing.
   */
  app.post('/leads/:id/convert', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(ConvertBody, request.body ?? {});
    const { actor } = request;
    const lead = await getOwned(actor.orgId, id);
    if (lead.status === 'converted') throw conflict('Lead is already converted');

    const result = await db.tx(async (q) => {
      // 1. Company: explicit id, or created from the lead's company name
      let companyId: string | null = null;
      if (body.companyId) {
        const r = await q.query(`SELECT id FROM companies WHERE id = $1 AND org_id = $2`, [
          body.companyId, actor.orgId,
        ]);
        if (!r.rows[0]) throw validation('companyId does not reference a company in your organization');
        companyId = body.companyId;
      } else if (body.createCompany && lead.companyName) {
        const existing = await q.query(
          `SELECT id FROM companies WHERE org_id = $1 AND lower(name) = lower($2)`,
          [actor.orgId, lead.companyName]
        );
        companyId = existing.rows[0]?.id ?? null;
        if (!companyId) {
          companyId = newId();
          await q.query(
            `INSERT INTO companies (id, org_id, name, owner_id) VALUES ($1,$2,$3,$4)`,
            [companyId, actor.orgId, lead.companyName, lead.ownerId ?? actor.id]
          );
        }
      }

      // 2. Contact: explicit id, or created from the lead
      let contactId: string;
      if (body.contactId) {
        const r = await q.query(`SELECT id FROM contacts WHERE id = $1 AND org_id = $2`, [
          body.contactId, actor.orgId,
        ]);
        if (!r.rows[0]) throw validation('contactId does not reference a contact in your organization');
        contactId = body.contactId;
      } else {
        contactId = newId();
        const [firstName, ...rest] = String(lead.name).split(' ');
        await q.query(
          `INSERT INTO contacts (id, org_id, first_name, last_name, email, phone, company_id, owner_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            contactId, actor.orgId, firstName, rest.join(' '), lead.email, lead.phone,
            companyId, lead.ownerId ?? actor.id,
          ]
        );
      }

      // 3. Optional deal in the requested (or default) pipeline
      let dealId: string | null = null;
      if (body.deal) {
        let pipelineId = body.deal.pipelineId ?? null;
        if (!pipelineId) {
          const p = await q.query(
            `SELECT id FROM pipelines WHERE org_id = $1 ORDER BY is_default DESC, created_at LIMIT 1`,
            [actor.orgId]
          );
          if (!p.rows[0]) throw validation('No pipeline exists; create one first');
          pipelineId = p.rows[0].id as string;
        } else {
          const p = await q.query(`SELECT id FROM pipelines WHERE id = $1 AND org_id = $2`, [
            pipelineId, actor.orgId,
          ]);
          if (!p.rows[0]) throw validation('pipelineId does not reference a pipeline in your organization');
        }
        let stageId = body.deal.stageId ?? null;
        if (stageId) {
          const s = await q.query(
            `SELECT id FROM pipeline_stages WHERE id = $1 AND pipeline_id = $2`,
            [stageId, pipelineId]
          );
          if (!s.rows[0]) throw validation('stageId does not belong to the pipeline');
        } else {
          const s = await q.query(
            `SELECT id FROM pipeline_stages WHERE pipeline_id = $1 AND NOT is_won AND NOT is_lost
             ORDER BY position LIMIT 1`,
            [pipelineId]
          );
          if (!s.rows[0]) throw validation('Pipeline has no open stage');
          stageId = s.rows[0].id as string;
        }
        dealId = newId();
        await q.query(
          `INSERT INTO deals (id, org_id, title, value, currency, pipeline_id, stage_id, contact_id, company_id, owner_id, expected_close_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            dealId, actor.orgId, body.deal.title, body.deal.value, body.deal.currency,
            pipelineId, stageId, contactId, companyId, lead.ownerId ?? actor.id,
            body.deal.expectedCloseDate ?? null,
          ]
        );
      }

      // 4. Mark the lead converted with back-references
      await q.query(
        `UPDATE leads SET status = 'converted', converted_contact_id = $1, converted_deal_id = $2, updated_at = now()
         WHERE id = $3 AND org_id = $4`,
        [contactId, dealId, id, actor.orgId]
      );

      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'converted',
        entityType: 'lead', entityId: id,
        payload: { contactId, companyId, dealId },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'lead.converted',
        entityType: 'lead', entityId: id,
        changes: { contactId: { from: null, to: contactId }, dealId: { from: null, to: dealId } },
      });
      return { contactId, companyId, dealId };
    });

    if (result.dealId && body.deal) {
      bus.emit({
        type: 'deal.created', orgId: actor.orgId, actorId: actor.id,
        entityType: 'deal', entityId: result.dealId,
        data: { title: body.deal.title, value: body.deal.value, ownerId: lead.ownerId ?? actor.id, fromLead: id },
      });
    }
    return { leadId: id, ...result };
  });
}
