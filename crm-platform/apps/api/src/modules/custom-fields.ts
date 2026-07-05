import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { logAudit } from '../lib/common.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const EntityType = z.enum(['contact', 'company', 'lead', 'deal']);

const FieldBody = z.object({
  entityType: EntityType,
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case starting with a letter'),
  label: z.string().trim().min(1).max(200),
  fieldType: z.enum(['text', 'number', 'date', 'select', 'checkbox']),
  options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  required: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

const SELECT = `SELECT id, entity_type AS "entityType", key, label, field_type AS "fieldType",
  options, required, position, created_at AS "createdAt" FROM custom_field_defs`;

export function registerCustomFields(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  app.get('/custom-fields', { preHandler: app.authenticate }, async (request) => {
    const { entity_type } = parse(z.object({ entity_type: EntityType.optional() }), request.query);
    const values: unknown[] = [request.actor.orgId];
    let where = `org_id = $1`;
    if (entity_type) {
      values.push(entity_type);
      where += ` AND entity_type = $2`;
    }
    const r = await db.query(`${SELECT} WHERE ${where} ORDER BY entity_type, position, created_at`, values);
    return { data: r.rows };
  });

  app.post('/custom-fields', { preHandler: app.requireRole('admin') }, async (request, reply) => {
    const body = parse(FieldBody, request.body);
    const { actor } = request;
    if (body.fieldType === 'select' && body.options.length === 0) {
      throw conflict('Select fields need at least one option');
    }
    const dupe = await db.query(
      `SELECT 1 FROM custom_field_defs WHERE org_id = $1 AND entity_type = $2 AND key = $3`,
      [actor.orgId, body.entityType, body.key]
    );
    if (dupe.rows[0]) throw conflict(`Field key "${body.key}" already exists for ${body.entityType}`);
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO custom_field_defs (id, org_id, entity_type, key, label, field_type, options, required, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id, actor.orgId, body.entityType, body.key, body.label, body.fieldType,
          JSON.stringify(body.options), body.required, body.position,
        ]
      );
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'custom_field.created',
        entityType: 'custom_field', entityId: id,
        changes: { key: { from: null, to: body.key }, entityType: { from: null, to: body.entityType } },
      });
    });
    const r = await db.query(`${SELECT} WHERE id = $1`, [id]);
    return reply.status(201).send(r.rows[0]);
  });

  app.patch('/custom-fields/:id', { preHandler: app.requireRole('admin') }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(FieldBody.omit({ entityType: true, key: true, fieldType: true }).partial(), request.body);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM custom_field_defs WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Custom field');
    await db.query(
      `UPDATE custom_field_defs SET
         label = COALESCE($1, label),
         options = COALESCE($2, options),
         required = COALESCE($3, required),
         position = COALESCE($4, position)
       WHERE id = $5`,
      [body.label ?? null, body.options ? JSON.stringify(body.options) : null, body.required ?? null, body.position ?? null, id]
    );
    const r = await db.query(`${SELECT} WHERE id = $1`, [id]);
    return r.rows[0];
  });

  app.delete('/custom-fields/:id', { preHandler: app.requireRole('admin') }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM custom_field_defs WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Custom field');
    await db.tx(async (q) => {
      await q.query(`DELETE FROM custom_field_defs WHERE id = $1`, [id]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'custom_field.deleted',
        entityType: 'custom_field', entityId: id,
        changes: { key: { from: existing.key, to: null } },
      });
    });
    // Values already stored on records are left in place (harmless, exportable).
    return { ok: true };
  });
}
