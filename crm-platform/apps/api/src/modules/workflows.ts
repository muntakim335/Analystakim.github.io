import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import type { DomainEvent } from '../lib/events.js';
import { newId } from '../lib/crypto.js';
import { logAudit, notifyUser } from '../lib/common.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const TriggerType = z.enum([
  'lead.created', 'contact.created', 'deal.created',
  'deal.stage_changed', 'deal.won', 'deal.lost', 'task.completed',
]);

const Condition = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'is_set', 'not_set']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const Action = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().min(1).max(300),
    dueInDays: z.number().int().min(0).max(365).default(1),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    assign: z.union([z.literal('owner'), z.literal('actor'), z.string().uuid()]).default('owner'),
  }),
  z.object({
    type: z.literal('notify'),
    target: z.union([z.literal('owner'), z.literal('actor'), z.string().uuid()]).default('owner'),
    message: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('update_field'),
    field: z.enum(['status', 'source', 'priority', 'value']),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    type: z.literal('send_email'),
    to: z.union([z.literal('owner'), z.literal('actor'), z.string().email()]),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(5000),
  }),
]);

const WorkflowBody = z.object({
  name: z.string().trim().min(1).max(200),
  triggerType: TriggerType,
  conditions: z.array(Condition).max(20).default([]),
  actions: z.array(Action).min(1).max(10),
  isActive: z.boolean().default(true),
});

type ConditionT = z.infer<typeof Condition>;
type ActionT = z.infer<typeof Action>;

export function evaluateConditions(conditions: ConditionT[], data: Record<string, unknown>): boolean {
  return conditions.every((c) => {
    // dot-paths reach nested values, e.g. custom.region
    const value = c.field.split('.').reduce<unknown>((acc, k) => {
      return acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined;
    }, data);
    switch (c.op) {
      case 'is_set': return value !== undefined && value !== null && value !== '';
      case 'not_set': return value === undefined || value === null || value === '';
      case 'eq': return value == c.value; // loose: '5' matches 5 from JSONB
      case 'neq': return value != c.value;
      case 'gt': return Number(value) > Number(c.value);
      case 'lt': return Number(value) < Number(c.value);
      case 'gte': return Number(value) >= Number(c.value);
      case 'lte': return Number(value) <= Number(c.value);
      case 'contains':
        return typeof value === 'string' && value.toLowerCase().includes(String(c.value).toLowerCase());
    }
  });
}

/** Subscribes the recipe engine to the domain event bus. Call once at boot. */
export function startWorkflowEngine(ctx: AppCtx): void {
  ctx.bus.subscribe(async (event) => runWorkflowsFor(ctx, event));
}

async function runWorkflowsFor(ctx: AppCtx, event: DomainEvent): Promise<void> {
  const { db } = ctx;
  const workflows = (
    await db.query(
      `SELECT * FROM workflows WHERE org_id = $1 AND trigger_type = $2 AND is_active`,
      [event.orgId, event.type]
    )
  ).rows;

  for (const wf of workflows) {
    if (!evaluateConditions(wf.conditions as ConditionT[], event.data)) continue;
    const results: { action: string; ok: boolean; detail?: string }[] = [];
    for (const action of wf.actions as ActionT[]) {
      try {
        await runAction(ctx, event, action);
        results.push({ action: action.type, ok: true });
      } catch (err) {
        results.push({ action: action.type, ok: false, detail: (err as Error).message });
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    await db.query(
      `INSERT INTO workflow_runs (id, workflow_id, org_id, event, status, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        newId(), wf.id, event.orgId,
        JSON.stringify({ type: event.type, entityId: event.entityId }),
        failed === 0 ? 'success' : failed === results.length ? 'failed' : 'partial',
        JSON.stringify({ results }),
      ]
    );
  }
}

function resolveUser(target: string, event: DomainEvent): string | null {
  if (target === 'actor') return event.actorId;
  if (target === 'owner') {
    const owner = (event.data.ownerId ?? event.data.assigneeId) as string | null | undefined;
    return owner ?? event.actorId;
  }
  return target; // explicit user id
}

async function runAction(ctx: AppCtx, event: DomainEvent, action: ActionT): Promise<void> {
  const { db } = ctx;
  switch (action.type) {
    case 'create_task': {
      const assignee = resolveUser(action.assign, event);
      const due = new Date(Date.now() + action.dueInDays * 86400_000);
      await db.query(
        `INSERT INTO tasks (id, org_id, title, priority, due_date, assignee_id, related_type, related_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
        [
          newId(), event.orgId, action.title, action.priority, due.toISOString(),
          assignee, event.entityType, event.entityId,
        ]
      );
      break;
    }
    case 'notify': {
      const target = resolveUser(action.target, event);
      if (!target) throw new Error('notify target could not be resolved');
      await notifyUser(ctx, {
        orgId: event.orgId, userId: target, type: 'workflow',
        title: action.message, entityType: event.entityType, entityId: event.entityId,
      });
      break;
    }
    case 'update_field': {
      // Whitelisted fields per entity; workflow updates do not re-emit events (no cascades).
      const allowed: Record<string, { table: string; fields: string[] }> = {
        lead: { table: 'leads', fields: ['status', 'source'] },
        deal: { table: 'deals', fields: ['value'] },
        task: { table: 'tasks', fields: ['priority'] },
      };
      const target = allowed[event.entityType];
      if (!target || !target.fields.includes(action.field)) {
        throw new Error(`field "${action.field}" is not updatable on ${event.entityType}`);
      }
      await db.query(
        `UPDATE ${target.table} SET ${action.field} = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
        [action.value, event.entityId, event.orgId]
      );
      break;
    }
    case 'send_email': {
      if (!ctx.mailer.enabled) throw new Error('skipped: SMTP is not configured');
      let to: string | null = null;
      if (action.to === 'owner' || action.to === 'actor') {
        const userId = resolveUser(action.to, event);
        const r = await db.query(`SELECT email FROM users WHERE id = $1 AND org_id = $2`, [
          userId, event.orgId,
        ]);
        to = r.rows[0]?.email ?? null;
      } else {
        to = action.to;
      }
      if (!to) throw new Error('email recipient could not be resolved');
      await ctx.mailer.send(to, action.subject, action.body);
      break;
    }
  }
}

export function registerWorkflows(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;
  const manage = { preHandler: app.requireRole('admin', 'manager') };
  const SELECT = `SELECT id, name, trigger_type AS "triggerType", conditions, actions,
    is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt" FROM workflows`;

  app.get('/workflows', manage, async (request) => {
    const r = await db.query(`${SELECT} WHERE org_id = $1 ORDER BY created_at DESC`, [
      request.actor.orgId,
    ]);
    return { data: r.rows };
  });

  app.post('/workflows', manage, async (request, reply) => {
    const body = parse(WorkflowBody, request.body);
    const { actor } = request;
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO workflows (id, org_id, name, trigger_type, conditions, actions, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id, actor.orgId, body.name, body.triggerType,
          JSON.stringify(body.conditions), JSON.stringify(body.actions), body.isActive,
        ]
      );
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'workflow.created',
        entityType: 'workflow', entityId: id,
        changes: { name: { from: null, to: body.name }, trigger: { from: null, to: body.triggerType } },
      });
    });
    const r = await db.query(`${SELECT} WHERE id = $1`, [id]);
    return reply.status(201).send(r.rows[0]);
  });

  app.patch('/workflows/:id', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(WorkflowBody.partial(), request.body);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM workflows WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Workflow');
    await db.query(
      `UPDATE workflows SET
         name = COALESCE($1, name),
         trigger_type = COALESCE($2, trigger_type),
         conditions = COALESCE($3, conditions),
         actions = COALESCE($4, actions),
         is_active = COALESCE($5, is_active),
         updated_at = now()
       WHERE id = $6`,
      [
        body.name ?? null, body.triggerType ?? null,
        body.conditions ? JSON.stringify(body.conditions) : null,
        body.actions ? JSON.stringify(body.actions) : null,
        body.isActive ?? null, id,
      ]
    );
    const r = await db.query(`${SELECT} WHERE id = $1`, [id]);
    return r.rows[0];
  });

  app.delete('/workflows/:id', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT id, name FROM workflows WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('Workflow');
    await db.tx(async (q) => {
      await q.query(`DELETE FROM workflows WHERE id = $1`, [id]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'workflow.deleted',
        entityType: 'workflow', entityId: id,
        changes: { name: { from: existing.name, to: null } },
      });
    });
    return { ok: true };
  });

  app.get('/workflows/:id/runs', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const wf = await db.query(`SELECT 1 FROM workflows WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
    if (!wf.rows[0]) throw notFound('Workflow');
    const r = await db.query(
      `SELECT id, event, status, detail, created_at AS "createdAt"
       FROM workflow_runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id]
    );
    return { data: r.rows };
  });
}
