import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { parse } from '../lib/validate.js';

export function registerActivities(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  /** Record timeline (?entity_type&entity_id) or org-wide feed. */
  app.get('/activities', { preHandler: app.authenticate }, async (request) => {
    const query = parse(
      z.object({
        entity_type: z.string().max(50).optional(),
        entity_id: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      request.query
    );
    const values: unknown[] = [request.actor.orgId];
    let where = `a.org_id = $1`;
    if (query.entity_type && query.entity_id) {
      values.push(query.entity_type, query.entity_id);
      where += ` AND a.entity_type = $2 AND a.entity_id = $3`;
    }
    const offset = (query.page - 1) * query.limit;
    const r = await db.query(
      `SELECT a.id, a.type, a.actor_id AS "actorId", u.name AS "actorName",
              a.entity_type AS "entityType", a.entity_id AS "entityId", a.payload,
              a.created_at AS "createdAt"
       FROM activities a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${where} ORDER BY a.created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
      values
    );
    return { data: r.rows, page: query.page, limit: query.limit };
  });

  /** Admin-only compliance stream. */
  app.get('/audit-logs', { preHandler: app.requireRole('admin') }, async (request) => {
    const query = parse(
      z.object({
        entity_type: z.string().max(50).optional(),
        entity_id: z.string().uuid().optional(),
        actor_id: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      request.query
    );
    const values: unknown[] = [request.actor.orgId];
    const conditions = [`l.org_id = $1`];
    if (query.entity_type) {
      values.push(query.entity_type);
      conditions.push(`l.entity_type = $${values.length}`);
    }
    if (query.entity_id) {
      values.push(query.entity_id);
      conditions.push(`l.entity_id = $${values.length}`);
    }
    if (query.actor_id) {
      values.push(query.actor_id);
      conditions.push(`l.actor_id = $${values.length}`);
    }
    const where = conditions.join(' AND ');
    const offset = (query.page - 1) * query.limit;
    const [count, rows] = [
      await db.query(`SELECT count(*)::int AS n FROM audit_logs l WHERE ${where}`, values),
      await db.query(
        `SELECT l.id, l.actor_id AS "actorId", u.name AS "actorName", l.action,
                l.entity_type AS "entityType", l.entity_id AS "entityId", l.changes,
                l.created_at AS "createdAt"
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
         WHERE ${where} ORDER BY l.created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
        values
      ),
    ];
    return { data: rows.rows, page: query.page, limit: query.limit, total: count.rows[0].n };
  });
}
