import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { parse } from '../lib/validate.js';

export function registerNotifications(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  app.get('/notifications', { preHandler: app.authenticate }, async (request) => {
    const { unread } = parse(z.object({ unread: z.coerce.boolean().optional() }), request.query);
    const { actor } = request;
    const values: unknown[] = [actor.id, actor.orgId];
    const filter = unread ? 'AND read_at IS NULL' : '';
    const r = await db.query(
      `SELECT id, type, title, body, entity_type AS "entityType", entity_id AS "entityId",
              read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
       WHERE user_id = $1 AND org_id = $2 ${filter}
       ORDER BY created_at DESC LIMIT 50`,
      values
    );
    const unreadCount = await db.query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [actor.id]
    );
    return { data: r.rows, unreadCount: unreadCount.rows[0].n };
  });

  app.post('/notifications/read', { preHandler: app.authenticate }, async (request) => {
    const { ids } = parse(
      z.object({ ids: z.array(z.string().uuid()).max(100).optional() }),
      request.body ?? {}
    );
    const { actor } = request;
    if (ids && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
      await db.query(
        `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id IN (${placeholders}) AND read_at IS NULL`,
        [actor.id, ...ids]
      );
    } else {
      await db.query(
        `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
        [actor.id]
      );
    }
    return { ok: true };
  });
}
