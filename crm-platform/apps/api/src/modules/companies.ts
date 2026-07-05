import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { diff, logActivity, logAudit } from '../lib/common.js';
import { forbidden, notFound } from '../lib/errors.js';
import { ListQuery, runList } from '../lib/listing.js';
import { mergeCustom, validateCustom } from '../lib/custom-fields.js';
import { parse } from '../lib/validate.js';

const CompanyBody = z.object({
  name: z.string().trim().min(1).max(300),
  domain: z.string().trim().max(255).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.record(z.unknown()).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  custom: z.record(z.unknown()).optional(),
});

const SELECT = `SELECT t.id, t.name, t.domain, t.industry, t.size, t.website, t.phone, t.address,
  t.owner_id AS "ownerId", t.custom, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  u.name AS "ownerName",
  (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = t.id) AS "contactCount",
  (SELECT count(*)::int FROM deals d WHERE d.company_id = t.id AND d.status = 'open') AS "openDealCount"
  FROM companies t LEFT JOIN users u ON u.id = t.owner_id`;

export function registerCompanies(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  async function getOwned(orgId: string, id: string) {
    const r = await db.query(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    if (!r.rows[0]) throw notFound('Company');
    return r.rows[0];
  }

  app.get('/companies', { preHandler: app.authenticate }, async (request) => {
    const params = parse(ListQuery, request.query);
    const extra = parse(
      z.object({ owner_id: z.string().uuid().optional(), industry: z.string().optional() }),
      request.query
    );
    return runList(db, request.actor.orgId, {
      table: 'companies',
      select: SELECT,
      searchColumns: ['t.name', 't.domain', 't.industry'],
      sortable: { name: 't.name', created_at: 't.created_at', updated_at: 't.updated_at' },
      defaultSort: 't.created_at',
      filters: { owner_id: extra.owner_id, industry: extra.industry },
    }, params);
  });

  app.get('/companies/export', { preHandler: app.authenticate }, async (request, reply) => {
    const r = await db.query(
      `SELECT name, domain, industry, size, website, phone, custom
       FROM companies WHERE org_id = $1 ORDER BY name LIMIT 10000`,
      [request.actor.orgId]
    );
    const csv = stringifyCsv(
      r.rows.map((row) => ({ ...row, custom: JSON.stringify(row.custom) })),
      { header: true }
    );
    return reply.type('text/csv').header('content-disposition', 'attachment; filename="companies.csv"').send(csv);
  });

  app.get('/companies/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return getOwned(request.actor.orgId, id);
  });

  app.post('/companies', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(CompanyBody, request.body);
    const { actor } = request;
    const custom = await validateCustom(db, actor.orgId, 'company', body.custom, { partial: false });
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO companies (id, org_id, name, domain, industry, size, website, phone, address, owner_id, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, actor.orgId, body.name, body.domain ?? null, body.industry ?? null, body.size ?? null,
          body.website ?? null, body.phone ?? null, JSON.stringify(body.address ?? {}),
          body.ownerId ?? actor.id, JSON.stringify(custom),
        ]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'created',
        entityType: 'company', entityId: id, payload: { name: body.name },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'company.created',
        entityType: 'company', entityId: id,
      });
    });
    return reply.status(201).send(await getOwned(actor.orgId, id));
  });

  app.patch('/companies/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(CompanyBody.partial(), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    const validated = await validateCustom(db, actor.orgId, 'company', body.custom, { partial: true });
    const custom = body.custom ? mergeCustom(existing.custom, validated) : existing.custom;

    await db.tx(async (q) => {
      await q.query(
        `UPDATE companies SET
           name     = COALESCE($1, name),
           domain   = CASE WHEN $2 THEN $3 ELSE domain END,
           industry = CASE WHEN $4 THEN $5 ELSE industry END,
           size     = CASE WHEN $6 THEN $7 ELSE size END,
           website  = CASE WHEN $8 THEN $9 ELSE website END,
           phone    = CASE WHEN $10 THEN $11 ELSE phone END,
           address  = COALESCE($12, address),
           owner_id = CASE WHEN $13 THEN $14::uuid ELSE owner_id END,
           custom   = $15,
           updated_at = now()
         WHERE id = $16 AND org_id = $17`,
        [
          body.name ?? null,
          body.domain !== undefined, body.domain ?? null,
          body.industry !== undefined, body.industry ?? null,
          body.size !== undefined, body.size ?? null,
          body.website !== undefined, body.website ?? null,
          body.phone !== undefined, body.phone ?? null,
          body.address ? JSON.stringify(body.address) : null,
          body.ownerId !== undefined, body.ownerId ?? null,
          JSON.stringify(custom), id, actor.orgId,
        ]
      );
      const changes = diff(existing, { ...body, custom } as Record<string, unknown>);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'company.updated',
        entityType: 'company', entityId: id, changes,
      });
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'updated',
        entityType: 'company', entityId: id, payload: { fields: Object.keys(changes) },
      });
    });
    return getOwned(actor.orgId, id);
  });

  app.delete('/companies/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (actor.role === 'member' && existing.ownerId !== actor.id) {
      throw forbidden('Members can only delete companies they own');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM companies WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'company.deleted',
        entityType: 'company', entityId: id,
        changes: { name: { from: existing.name, to: null } },
      });
    });
    return { ok: true };
  });
}
