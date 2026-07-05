import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { diff, logActivity, logAudit, notifyUser } from '../lib/common.js';
import { conflict, forbidden, notFound, validation } from '../lib/errors.js';
import { ListQuery, runList } from '../lib/listing.js';
import { mergeCustom, validateCustom } from '../lib/custom-fields.js';
import { parse } from '../lib/validate.js';

const DealBody = z.object({
  title: z.string().trim().min(1).max(300),
  value: z.number().min(0).max(999_999_999_999).default(0),
  currency: z.string().length(3).default('USD'),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  expectedCloseDate: z.string().date().nullable().optional(),
  custom: z.record(z.unknown()).optional(),
});

const SELECT = `SELECT t.id, t.title, t.value::float8 AS value, t.currency,
  t.pipeline_id AS "pipelineId", t.stage_id AS "stageId", t.contact_id AS "contactId",
  t.company_id AS "companyId", t.owner_id AS "ownerId", t.status, t.lost_reason AS "lostReason",
  t.expected_close_date AS "expectedCloseDate", t.closed_at AS "closedAt", t.custom,
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  s.name AS "stageName", u.name AS "ownerName",
  ct.first_name || ' ' || ct.last_name AS "contactName", co.name AS "companyName"
  FROM deals t
  JOIN pipeline_stages s ON s.id = t.stage_id
  LEFT JOIN users u ON u.id = t.owner_id
  LEFT JOIN contacts ct ON ct.id = t.contact_id
  LEFT JOIN companies co ON co.id = t.company_id`;

export function registerDeals(app: FastifyInstance, ctx: AppCtx): void {
  const { db, bus } = ctx;

  async function getOwned(orgId: string, id: string) {
    const r = await db.query(`${SELECT} WHERE t.org_id = $1 AND t.id = $2`, [orgId, id]);
    if (!r.rows[0]) throw notFound('Deal');
    return r.rows[0];
  }

  async function stageInPipeline(stageId: string, pipelineId: string, orgId: string) {
    const r = await db.query(
      `SELECT s.* FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND s.pipeline_id = $2 AND p.org_id = $3`,
      [stageId, pipelineId, orgId]
    );
    if (!r.rows[0]) throw validation('stageId does not belong to the pipeline');
    return r.rows[0];
  }

  app.get('/deals', { preHandler: app.authenticate }, async (request) => {
    const params = parse(ListQuery, request.query);
    const extra = parse(
      z.object({
        pipeline_id: z.string().uuid().optional(),
        stage_id: z.string().uuid().optional(),
        status: z.enum(['open', 'won', 'lost']).optional(),
        owner_id: z.string().uuid().optional(),
      }),
      request.query
    );
    return runList(db, request.actor.orgId, {
      table: 'deals',
      select: SELECT,
      searchColumns: ['t.title'],
      sortable: {
        title: 't.title', value: 't.value', created_at: 't.created_at',
        updated_at: 't.updated_at', expected_close_date: 't.expected_close_date',
      },
      defaultSort: 't.created_at',
      filters: {
        pipeline_id: extra.pipeline_id, stage_id: extra.stage_id,
        status: extra.status, owner_id: extra.owner_id,
      },
    }, params);
  });

  /** Kanban board: open deals grouped into ordered stages with per-stage totals. */
  app.get('/deals/board', { preHandler: app.authenticate }, async (request) => {
    const { pipeline_id } = parse(z.object({ pipeline_id: z.string().uuid() }), request.query);
    const { orgId } = request.actor;
    const p = await db.query(`SELECT id, name FROM pipelines WHERE id = $1 AND org_id = $2`, [
      pipeline_id, orgId,
    ]);
    if (!p.rows[0]) throw notFound('Pipeline');
    const stages = (
      await db.query(
        `SELECT id, name, position, probability, is_won AS "isWon", is_lost AS "isLost"
         FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position`,
        [pipeline_id]
      )
    ).rows;
    const deals = (
      await db.query(
        `${SELECT} WHERE t.org_id = $1 AND t.pipeline_id = $2 AND t.status = 'open'
         ORDER BY t.updated_at DESC`,
        [orgId, pipeline_id]
      )
    ).rows;
    return {
      pipeline: p.rows[0],
      stages: stages.map((s) => {
        const cards = deals.filter((d) => d.stageId === s.id);
        return {
          ...s,
          deals: cards,
          totalValue: cards.reduce((sum, d) => sum + Number(d.value), 0),
        };
      }),
    };
  });

  app.get('/deals/export', { preHandler: app.authenticate }, async (request, reply) => {
    const r = await db.query(
      `SELECT t.title, t.value, t.currency, t.status, s.name AS stage, t.expected_close_date,
              t.closed_at, u.name AS owner, co.name AS company
       FROM deals t
       JOIN pipeline_stages s ON s.id = t.stage_id
       LEFT JOIN users u ON u.id = t.owner_id
       LEFT JOIN companies co ON co.id = t.company_id
       WHERE t.org_id = $1 ORDER BY t.created_at LIMIT 10000`,
      [request.actor.orgId]
    );
    const csv = stringifyCsv(r.rows, { header: true });
    return reply.type('text/csv').header('content-disposition', 'attachment; filename="deals.csv"').send(csv);
  });

  app.get('/deals/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return getOwned(request.actor.orgId, id);
  });

  app.post('/deals', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parse(DealBody, request.body);
    const { actor } = request;
    const p = await db.query(`SELECT id FROM pipelines WHERE id = $1 AND org_id = $2`, [
      body.pipelineId, actor.orgId,
    ]);
    if (!p.rows[0]) throw validation('pipelineId does not reference a pipeline in your organization');

    let stageId = body.stageId ?? null;
    if (stageId) {
      await stageInPipeline(stageId, body.pipelineId, actor.orgId);
    } else {
      const s = await db.query(
        `SELECT id FROM pipeline_stages WHERE pipeline_id = $1 AND NOT is_won AND NOT is_lost
         ORDER BY position LIMIT 1`,
        [body.pipelineId]
      );
      if (!s.rows[0]) throw validation('Pipeline has no open stage');
      stageId = s.rows[0].id as string;
    }
    const custom = await validateCustom(db, actor.orgId, 'deal', body.custom, { partial: false });
    const id = newId();
    const ownerId = body.ownerId ?? actor.id;
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO deals (id, org_id, title, value, currency, pipeline_id, stage_id, contact_id, company_id, owner_id, expected_close_date, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id, actor.orgId, body.title, body.value, body.currency, body.pipelineId, stageId,
          body.contactId ?? null, body.companyId ?? null, ownerId,
          body.expectedCloseDate ?? null, JSON.stringify(custom),
        ]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'created',
        entityType: 'deal', entityId: id, payload: { title: body.title, value: body.value },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'deal.created',
        entityType: 'deal', entityId: id,
      });
    });
    if (ownerId !== actor.id) {
      await notifyUser(ctx, {
        orgId: actor.orgId, userId: ownerId, type: 'deal_assigned',
        title: `Deal assigned to you: ${body.title}`,
        entityType: 'deal', entityId: id,
      });
    }
    bus.emit({
      type: 'deal.created', orgId: actor.orgId, actorId: actor.id,
      entityType: 'deal', entityId: id,
      data: { title: body.title, value: body.value, ownerId, pipelineId: body.pipelineId, stageId },
    });
    return reply.status(201).send(await getOwned(actor.orgId, id));
  });

  app.patch('/deals/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(DealBody.partial(), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (body.pipelineId && body.pipelineId !== existing.pipelineId && !body.stageId) {
      throw validation('Provide stageId when moving a deal between pipelines');
    }
    if (body.stageId) {
      await stageInPipeline(body.stageId, body.pipelineId ?? existing.pipelineId, actor.orgId);
    }
    const validated = await validateCustom(db, actor.orgId, 'deal', body.custom, { partial: true });
    const custom = body.custom ? mergeCustom(existing.custom, validated) : existing.custom;

    await db.tx(async (q) => {
      await q.query(
        `UPDATE deals SET
           title = COALESCE($1, title),
           value = COALESCE($2, value),
           currency = COALESCE($3, currency),
           pipeline_id = COALESCE($4, pipeline_id),
           stage_id = COALESCE($5, stage_id),
           contact_id = CASE WHEN $6 THEN $7::uuid ELSE contact_id END,
           company_id = CASE WHEN $8 THEN $9::uuid ELSE company_id END,
           owner_id = CASE WHEN $10 THEN $11::uuid ELSE owner_id END,
           expected_close_date = CASE WHEN $12 THEN $13::date ELSE expected_close_date END,
           custom = $14,
           updated_at = now()
         WHERE id = $15 AND org_id = $16`,
        [
          body.title ?? null, body.value ?? null, body.currency ?? null,
          body.pipelineId ?? null, body.stageId ?? null,
          body.contactId !== undefined, body.contactId ?? null,
          body.companyId !== undefined, body.companyId ?? null,
          body.ownerId !== undefined, body.ownerId ?? null,
          body.expectedCloseDate !== undefined, body.expectedCloseDate ?? null,
          JSON.stringify(custom), id, actor.orgId,
        ]
      );
      const changes = diff(existing, { ...body, custom } as Record<string, unknown>);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'deal.updated',
        entityType: 'deal', entityId: id, changes,
      });
    });
    if (body.ownerId && body.ownerId !== existing.ownerId && body.ownerId !== actor.id) {
      await notifyUser(ctx, {
        orgId: actor.orgId, userId: body.ownerId, type: 'deal_assigned',
        title: `Deal assigned to you: ${existing.title}`,
        entityType: 'deal', entityId: id,
      });
    }
    return getOwned(actor.orgId, id);
  });

  /** Kanban drag: move to another stage in the same pipeline. */
  app.post('/deals/:id/move', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { stageId } = parse(z.object({ stageId: z.string().uuid() }), request.body);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (existing.status !== 'open') throw conflict('Closed deals cannot be moved');
    const stage = await stageInPipeline(stageId, existing.pipelineId, actor.orgId);
    if (stageId === existing.stageId) return getOwned(actor.orgId, id);

    await db.tx(async (q) => {
      await q.query(`UPDATE deals SET stage_id = $1, updated_at = now() WHERE id = $2 AND org_id = $3`, [
        stageId, id, actor.orgId,
      ]);
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'stage_changed',
        entityType: 'deal', entityId: id,
        payload: { from: existing.stageName, to: stage.name },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'deal.stage_changed',
        entityType: 'deal', entityId: id,
        changes: { stage: { from: existing.stageName, to: stage.name } },
      });
    });
    bus.emit({
      type: 'deal.stage_changed', orgId: actor.orgId, actorId: actor.id,
      entityType: 'deal', entityId: id,
      data: {
        title: existing.title, value: Number(existing.value), ownerId: existing.ownerId,
        fromStageId: existing.stageId, toStageId: stageId,
        fromStage: existing.stageName, toStage: stage.name,
      },
    });
    // Dragging into a Won/Lost stage closes the deal.
    if (stage.is_won || stage.is_lost) {
      await closeDeal(request.actor, id, stage.is_won ? 'won' : 'lost', null);
    }
    return getOwned(actor.orgId, id);
  });

  async function closeDeal(
    actor: { id: string; orgId: string },
    id: string,
    status: 'won' | 'lost',
    reason: string | null
  ) {
    const existing = await getOwned(actor.orgId, id);
    await db.tx(async (q) => {
      await q.query(
        `UPDATE deals SET status = $1, lost_reason = $2, closed_at = now(), updated_at = now()
         WHERE id = $3 AND org_id = $4`,
        [status, reason, id, actor.orgId]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: status === 'won' ? 'won' : 'lost',
        entityType: 'deal', entityId: id, payload: { title: existing.title, value: Number(existing.value), reason },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: `deal.${status}`,
        entityType: 'deal', entityId: id,
        changes: { status: { from: existing.status, to: status } },
      });
    });
    bus.emit({
      type: status === 'won' ? 'deal.won' : 'deal.lost',
      orgId: actor.orgId, actorId: actor.id, entityType: 'deal', entityId: id,
      data: { title: existing.title, value: Number(existing.value), ownerId: existing.ownerId, reason },
    });
  }

  app.post('/deals/:id/close', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(
      z.object({ status: z.enum(['won', 'lost']), reason: z.string().max(500).optional() }),
      request.body
    );
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (existing.status !== 'open') throw conflict('Deal is already closed');
    // Snap the deal into the pipeline's Won/Lost stage when one exists.
    const target = await db.query(
      `SELECT id FROM pipeline_stages WHERE pipeline_id = $1 AND ${body.status === 'won' ? 'is_won' : 'is_lost'} LIMIT 1`,
      [existing.pipelineId]
    );
    if (target.rows[0] && target.rows[0].id !== existing.stageId) {
      await db.query(`UPDATE deals SET stage_id = $1 WHERE id = $2 AND org_id = $3`, [
        target.rows[0].id, id, actor.orgId,
      ]);
    }
    await closeDeal(actor, id, body.status, body.reason ?? null);
    return getOwned(actor.orgId, id);
  });

  app.delete('/deals/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = await getOwned(actor.orgId, id);
    if (actor.role === 'member' && existing.ownerId !== actor.id) {
      throw forbidden('Members can only delete deals they own');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM deals WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'deal.deleted',
        entityType: 'deal', entityId: id,
        changes: { title: { from: existing.title, to: null } },
      });
    });
    return { ok: true };
  });
}
