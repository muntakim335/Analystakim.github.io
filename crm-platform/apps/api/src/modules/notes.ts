import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { logActivity, logAudit } from '../lib/common.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const RelatedType = z.enum(['contact', 'company', 'lead', 'deal']);

const SELECT = `SELECT n.id, n.body, n.related_type AS "relatedType", n.related_id AS "relatedId",
  n.author_id AS "authorId", u.name AS "authorName",
  n.created_at AS "createdAt", n.updated_at AS "updatedAt"
  FROM notes n LEFT JOIN users u ON u.id = n.author_id`;

export function registerNotes(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  app.get('/notes', { preHandler: app.authenticate }, async (request) => {
    const query = parse(
      z.object({ related_type: RelatedType, related_id: z.string().uuid() }),
      request.query
    );
    const r = await db.query(
      `${SELECT} WHERE n.org_id = $1 AND n.related_type = $2 AND n.related_id = $3
       ORDER BY n.created_at DESC LIMIT 200`,
      [request.actor.orgId, query.related_type, query.related_id]
    );
    return { data: r.rows };
  });

  app.post('/notes', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(
      z.object({
        body: z.string().trim().min(1).max(20000),
        relatedType: RelatedType,
        relatedId: z.string().uuid(),
      }),
      request.body
    );
    const { actor } = request;
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO notes (id, org_id, body, related_type, related_id, author_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, actor.orgId, body.body, body.relatedType, body.relatedId, actor.id]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'note_added',
        entityType: body.relatedType, entityId: body.relatedId,
        payload: { noteId: id, preview: body.body.slice(0, 120) },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'note.created',
        entityType: 'note', entityId: id,
      });
    });
    const r = await db.query(`${SELECT} WHERE n.id = $1`, [id]);
    return reply.status(201).send(r.rows[0]);
  });

  app.patch('/notes/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(z.object({ body: z.string().trim().min(1).max(20000) }), request.body);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM notes WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Note');
    if (actor.role === 'member' && existing.author_id !== actor.id) {
      throw forbidden('Members can only edit their own notes');
    }
    await db.query(`UPDATE notes SET body = $1, updated_at = now() WHERE id = $2`, [body.body, id]);
    const r = await db.query(`${SELECT} WHERE n.id = $1`, [id]);
    return r.rows[0];
  });

  app.delete('/notes/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM notes WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Note');
    if (actor.role === 'member' && existing.author_id !== actor.id) {
      throw forbidden('Members can only delete their own notes');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM notes WHERE id = $1`, [id]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'note.deleted',
        entityType: 'note', entityId: id,
      });
    });
    return { ok: true };
  });
}
