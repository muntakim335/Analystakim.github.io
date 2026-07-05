import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { diff, logActivity, logAudit } from '../lib/common.js';
import { forbidden, notFound, validation } from '../lib/errors.js';
import { ListQuery, runList } from '../lib/listing.js';
import { mergeCustom, validateCustom } from '../lib/custom-fields.js';
import { parse } from '../lib/validate.js';

const ContactBody = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().max(200).default(''),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  custom: z.record(z.unknown()).optional(),
});

const SELECT = `SELECT t.id, t.first_name AS "firstName", t.last_name AS "lastName", t.email, t.phone,
  t.title, t.company_id AS "companyId", t.owner_id AS "ownerId", t.custom,
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  c.name AS "companyName", u.name AS "ownerName"
  FROM contacts t
  LEFT JOIN companies c ON c.id = t.company_id
  LEFT JOIN users u ON u.id = t.owner_id`;

export function registerContacts(app: FastifyInstance, ctx: AppCtx): void {
  const { db, bus } = ctx;

  async function getOwned(orgId: string, id: string) {
    const r = await db.query(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    if (!r.rows[0]) throw notFound('Contact');
    return r.rows[0];
  }

  async function assertCompanyInOrg(orgId: string, companyId: string | null | undefined) {
    if (!companyId) return;
    const r = await db.query(`SELECT 1 FROM companies WHERE id = $1 AND org_id = $2`, [companyId, orgId]);
    if (!r.rows[0]) throw validation('companyId does not reference a company in your organization');
  }

  app.get('/contacts', { preHandler: app.authenticate }, async (request) => {
    const params = parse(ListQuery, request.query);
    const extra = parse(
      z.object({ owner_id: z.string().uuid().optional(), company_id: z.string().uuid().optional() }),
      request.query
    );
    return runList(db, request.actor.orgId, {
      table: 'contacts',
      select: SELECT,
      searchColumns: ['t.first_name', 't.last_name', 't.email', 't.phone'],
      sortable: {
        name: 't.last_name',
        created_at: 't.created_at',
        updated_at: 't.updated_at',
        email: 't.email',
      },
      defaultSort: 't.created_at',
      filters: { owner_id: extra.owner_id, company_id: extra.company_id },
    }, params);
  });

  app.get('/contacts/export', { preHandler: app.authenticate }, async (request, reply) => {
    const r = await db.query(
      `SELECT first_name, last_name, email, phone, title, custom,
              (SELECT name FROM companies c WHERE c.id = contacts.company_id) AS company
       FROM contacts WHERE org_id = $1 ORDER BY created_at LIMIT 10000`,
      [request.actor.orgId]
    );
    const csv = stringifyCsv(
      r.rows.map((row) => ({ ...row, custom: JSON.stringify(row.custom) })),
      { header: true }
    );
    return reply.type('text/csv').header('content-disposition', 'attachment; filename="contacts.csv"').send(csv);
  });

  app.post('/contacts/import', { preHandler: app.authenticate }, async (request) => {
    const file = await request.file();
    if (!file) throw validation('Upload a CSV file in a multipart field');
    const text = (await file.toBuffer()).toString('utf8');
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw validation(`Could not parse CSV: ${(err as Error).message}`);
    }
    if (rows.length > 5000) throw validation('Import is limited to 5000 rows per file');

    const pick = (row: Record<string, string>, ...names: string[]) => {
      for (const name of names) {
        const key = Object.keys(row).find((k) => k.toLowerCase().replace(/[\s_]/g, '') === name);
        if (key && row[key]) return row[key];
      }
      return '';
    };

    const { actor } = request;
    let created = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    for (const [i, row] of rows.entries()) {
      const firstName = pick(row, 'firstname', 'first') || pick(row, 'name', 'fullname').split(' ')[0];
      const lastName =
        pick(row, 'lastname', 'last') ||
        pick(row, 'name', 'fullname').split(' ').slice(1).join(' ');
      const email = pick(row, 'email', 'emailaddress').toLowerCase() || null;
      if (!firstName) {
        errors.push({ row: i + 2, message: 'Missing first name / name column' });
        continue;
      }
      if (email) {
        const dupe = await db.query(
          `SELECT 1 FROM contacts WHERE org_id = $1 AND lower(email) = $2`,
          [actor.orgId, email]
        );
        if (dupe.rows[0]) {
          skipped++;
          continue;
        }
      }
      await db.query(
        `INSERT INTO contacts (id, org_id, first_name, last_name, email, phone, title, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId(),
          actor.orgId,
          firstName,
          lastName,
          email,
          pick(row, 'phone', 'phonenumber') || null,
          pick(row, 'title', 'jobtitle') || null,
          actor.id,
        ]
      );
      created++;
    }
    await logAudit(db, {
      orgId: actor.orgId,
      actorId: actor.id,
      action: 'contacts.imported',
      entityType: 'contact',
      changes: { created: { from: null, to: created }, skipped: { from: null, to: skipped } },
    });
    return { created, skipped, errors };
  });

  app.get('/contacts/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return getOwned(request.actor.orgId, id);
  });

  app.post('/contacts', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(ContactBody, request.body);
    const { actor } = request;
    await assertCompanyInOrg(actor.orgId, body.companyId);
    const custom = await validateCustom(db, actor.orgId, 'contact', body.custom, { partial: false });
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO contacts (id, org_id, first_name, last_name, email, phone, title, company_id, owner_id, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, actor.orgId, body.firstName, body.lastName, body.email ?? null, body.phone ?? null,
          body.title ?? null, body.companyId ?? null, body.ownerId ?? actor.id, JSON.stringify(custom),
        ]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'created',
        entityType: 'contact', entityId: id,
        payload: { name: `${body.firstName} ${body.lastName}`.trim() },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'contact.created',
        entityType: 'contact', entityId: id,
      });
    });
    bus.emit({
      type: 'contact.created', orgId: actor.orgId, actorId: actor.id,
      entityType: 'contact', entityId: id,
      data: { firstName: body.firstName, lastName: body.lastName, email: body.email ?? null, ownerId: body.ownerId ?? actor.id },
    });
    return reply.status(201).send(await getOwned(actor.orgId, id));
  });

  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(ContactBody.partial(), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    await assertCompanyInOrg(actor.orgId, body.companyId);
    const validated = await validateCustom(db, actor.orgId, 'contact', body.custom, { partial: true });
    const custom = body.custom ? mergeCustom(existing.custom, validated) : existing.custom;

    await db.tx(async (q) => {
      await q.query(
        `UPDATE contacts SET
           first_name = COALESCE($1, first_name),
           last_name  = COALESCE($2, last_name),
           email      = CASE WHEN $3 THEN $4 ELSE email END,
           phone      = CASE WHEN $5 THEN $6 ELSE phone END,
           title      = CASE WHEN $7 THEN $8 ELSE title END,
           company_id = CASE WHEN $9 THEN $10::uuid ELSE company_id END,
           owner_id   = CASE WHEN $11 THEN $12::uuid ELSE owner_id END,
           custom     = $13,
           updated_at = now()
         WHERE id = $14 AND org_id = $15`,
        [
          body.firstName ?? null, body.lastName ?? null,
          body.email !== undefined, body.email ?? null,
          body.phone !== undefined, body.phone ?? null,
          body.title !== undefined, body.title ?? null,
          body.companyId !== undefined, body.companyId ?? null,
          body.ownerId !== undefined, body.ownerId ?? null,
          JSON.stringify(custom), id, actor.orgId,
        ]
      );
      const changes = diff(existing, { ...body, custom } as Record<string, unknown>);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'contact.updated',
        entityType: 'contact', entityId: id, changes,
      });
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'updated',
        entityType: 'contact', entityId: id, payload: { fields: Object.keys(changes) },
      });
    });
    return getOwned(actor.orgId, id);
  });

  app.delete('/contacts/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (actor.role === 'member' && existing.ownerId !== actor.id) {
      throw forbidden('Members can only delete contacts they own');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM contacts WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'contact.deleted',
        entityType: 'contact', entityId: id,
        changes: { name: { from: `${existing.firstName} ${existing.lastName}`.trim(), to: null } },
      });
    });
    return { ok: true };
  });
}
