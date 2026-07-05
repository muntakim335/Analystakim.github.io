import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { diff, logActivity, logAudit, notifyUser } from '../lib/common.js';
import { conflict, notFound } from '../lib/errors.js';
import { ListQuery, runList } from '../lib/listing.js';
import { parse } from '../lib/validate.js';

const RelatedType = z.enum(['contact', 'company', 'lead', 'deal']);

const TaskBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).default(''),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  assigneeId: z.string().uuid().nullable().optional(),
  relatedType: RelatedType.nullable().optional(),
  relatedId: z.string().uuid().nullable().optional(),
});

const SELECT = `SELECT t.id, t.title, t.description, t.due_date AS "dueDate", t.priority, t.status,
  t.assignee_id AS "assigneeId", t.related_type AS "relatedType", t.related_id AS "relatedId",
  t.created_by AS "createdBy", t.completed_at AS "completedAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt", u.name AS "assigneeName"
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;

export function registerTasks(app: FastifyInstance, ctx: AppCtx): void {
  const { db, bus } = ctx;

  async function getOwned(orgId: string, id: string) {
    const r = await db.query(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    if (!r.rows[0]) throw notFound('Task');
    return r.rows[0];
  }

  app.get('/tasks', { preHandler: app.authenticate }, async (request) => {
    const params = parse(ListQuery, request.query);
    const extra = parse(
      z.object({
        assignee_id: z.string().uuid().optional(),
        status: z.enum(['open', 'done']).optional(),
        due: z.enum(['overdue', 'today', 'week']).optional(),
        related_type: RelatedType.optional(),
        related_id: z.string().uuid().optional(),
      }),
      request.query
    );
    const where: { sql: string; params: unknown[] }[] = [];
    if (extra.due === 'overdue') {
      where.push({ sql: `t.due_date < now() AND t.status = 'open'`, params: [] });
    } else if (extra.due === 'today') {
      where.push({ sql: `t.due_date::date = now()::date`, params: [] });
    } else if (extra.due === 'week') {
      where.push({ sql: `t.due_date >= now() AND t.due_date < now() + interval '7 days'`, params: [] });
    }
    return runList(db, request.actor.orgId, {
      table: 'tasks',
      select: SELECT,
      searchColumns: ['t.title', 't.description'],
      sortable: { title: 't.title', due_date: 't.due_date', created_at: 't.created_at', priority: 't.priority' },
      defaultSort: 't.due_date',
      filters: {
        assignee_id: extra.assignee_id, status: extra.status,
        related_type: extra.related_type, related_id: extra.related_id,
      },
      where,
    }, params);
  });

  app.get('/tasks/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return getOwned(request.actor.orgId, id);
  });

  app.post('/tasks', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(TaskBody, request.body);
    const { actor } = request;
    const id = newId();
    const assigneeId = body.assigneeId ?? actor.id;
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO tasks (id, org_id, title, description, due_date, priority, assignee_id, related_type, related_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, actor.orgId, body.title, body.description, body.dueDate ?? null, body.priority,
          assigneeId, body.relatedType ?? null, body.relatedId ?? null, actor.id,
        ]
      );
      if (body.relatedType && body.relatedId) {
        await logActivity(q, {
          orgId: actor.orgId, actorId: actor.id, type: 'task_created',
          entityType: body.relatedType, entityId: body.relatedId,
          payload: { taskId: id, title: body.title },
        });
      }
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'task.created',
        entityType: 'task', entityId: id,
      });
    });
    if (assigneeId !== actor.id) {
      await notifyUser(ctx, {
        orgId: actor.orgId, userId: assigneeId, type: 'task_assigned',
        title: `Task assigned to you: ${body.title}`,
        entityType: 'task', entityId: id,
      });
    }
    return reply.status(201).send(await getOwned(actor.orgId, id));
  });

  app.patch('/tasks/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(TaskBody.partial(), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    await db.tx(async (q) => {
      await q.query(
        `UPDATE tasks SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           due_date = CASE WHEN $3 THEN $4::timestamptz ELSE due_date END,
           priority = COALESCE($5, priority),
           assignee_id = CASE WHEN $6 THEN $7::uuid ELSE assignee_id END,
           related_type = CASE WHEN $8 THEN $9 ELSE related_type END,
           related_id = CASE WHEN $8 THEN $10::uuid ELSE related_id END,
           updated_at = now()
         WHERE id = $11 AND org_id = $12`,
        [
          body.title ?? null, body.description ?? null,
          body.dueDate !== undefined, body.dueDate ?? null,
          body.priority ?? null,
          body.assigneeId !== undefined, body.assigneeId ?? null,
          body.relatedType !== undefined, body.relatedType ?? null, body.relatedId ?? null,
          id, actor.orgId,
        ]
      );
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'task.updated',
        entityType: 'task', entityId: id,
        changes: diff(existing, body as Record<string, unknown>),
      });
    });
    if (body.assigneeId && body.assigneeId !== existing.assigneeId && body.assigneeId !== actor.id) {
      await notifyUser(ctx, {
        orgId: actor.orgId, userId: body.assigneeId, type: 'task_assigned',
        title: `Task assigned to you: ${existing.title}`,
        entityType: 'task', entityId: id,
      });
    }
    return getOwned(actor.orgId, id);
  });

  app.post('/tasks/:id/complete', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (existing.status === 'done') throw conflict('Task is already completed');
    await db.tx(async (q) => {
      await q.query(
        `UPDATE tasks SET status = 'done', completed_at = now(), updated_at = now()
         WHERE id = $1 AND org_id = $2`,
        [id, actor.orgId]
      );
      if (existing.relatedType && existing.relatedId) {
        await logActivity(q, {
          orgId: actor.orgId, actorId: actor.id, type: 'task_completed',
          entityType: existing.relatedType, entityId: existing.relatedId,
          payload: { taskId: id, title: existing.title },
        });
      }
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'task.completed',
        entityType: 'task', entityId: id,
      });
    });
    bus.emit({
      type: 'task.completed', orgId: actor.orgId, actorId: actor.id,
      entityType: 'task', entityId: id,
      data: { title: existing.title, assigneeId: existing.assigneeId, priority: existing.priority },
    });
    return getOwned(actor.orgId, id);
  });

  app.delete('/tasks/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    await getOwned(actor.orgId, id);
    await db.tx(async (q) => {
      await q.query(`DELETE FROM tasks WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'task.deleted',
        entityType: 'task', entityId: id,
      });
    });
    return { ok: true };
  });
}
