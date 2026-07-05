import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { logAudit } from '../lib/common.js';
import { conflict, notFound, validation } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const StageBody = z.object({
  name: z.string().trim().min(1).max(200),
  probability: z.number().int().min(0).max(100).default(0),
  position: z.number().int().min(0).optional(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
});

export function registerPipelines(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;
  const manage = { preHandler: app.requireRole('admin', 'manager') };

  async function getPipeline(orgId: string, id: string) {
    const r = await db.query(`SELECT * FROM pipelines WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (!r.rows[0]) throw notFound('Pipeline');
    return r.rows[0];
  }

  app.get('/pipelines', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = request.actor;
    const pipelines = (
      await db.query(
        `SELECT id, name, is_default AS "isDefault", created_at AS "createdAt"
         FROM pipelines WHERE org_id = $1 ORDER BY created_at`,
        [orgId]
      )
    ).rows;
    const stages = (
      await db.query(
        `SELECT s.id, s.pipeline_id AS "pipelineId", s.name, s.position, s.probability,
                s.is_won AS "isWon", s.is_lost AS "isLost"
         FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
         WHERE p.org_id = $1 ORDER BY s.position`,
        [orgId]
      )
    ).rows;
    return {
      data: pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id) })),
    };
  });

  app.post('/pipelines', manage, async (request, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(200),
        stages: z.array(StageBody).min(1).optional(),
      }),
      request.body
    );
    const { actor } = request;
    const id = newId();
    await db.tx(async (q) => {
      await q.query(`INSERT INTO pipelines (id, org_id, name) VALUES ($1,$2,$3)`, [
        id, actor.orgId, body.name,
      ]);
      const stages = body.stages ?? [
        { name: 'New', probability: 20, isWon: false, isLost: false },
        { name: 'In Progress', probability: 50, isWon: false, isLost: false },
        { name: 'Won', probability: 100, isWon: true, isLost: false },
        { name: 'Lost', probability: 0, isWon: false, isLost: true },
      ];
      for (const [i, s] of stages.entries()) {
        await q.query(
          `INSERT INTO pipeline_stages (id, pipeline_id, name, position, probability, is_won, is_lost)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [newId(), id, s.name, s.position ?? i, s.probability, s.isWon, s.isLost]
        );
      }
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'pipeline.created',
        entityType: 'pipeline', entityId: id,
      });
    });
    return reply.status(201).send({ id });
  });

  app.patch('/pipelines/:id', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(200).optional(), isDefault: z.boolean().optional() }),
      request.body
    );
    const { actor } = request;
    await getPipeline(actor.orgId, id);
    await db.tx(async (q) => {
      if (body.isDefault) {
        await q.query(`UPDATE pipelines SET is_default = false WHERE org_id = $1`, [actor.orgId]);
      }
      await q.query(
        `UPDATE pipelines SET name = COALESCE($1, name), is_default = COALESCE($2, is_default)
         WHERE id = $3 AND org_id = $4`,
        [body.name ?? null, body.isDefault ?? null, id, actor.orgId]
      );
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'pipeline.updated',
        entityType: 'pipeline', entityId: id,
      });
    });
    return { ok: true };
  });

  app.delete('/pipelines/:id', { preHandler: app.requireRole('admin') }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    await getPipeline(actor.orgId, id);
    const deals = await db.query(`SELECT count(*)::int AS n FROM deals WHERE pipeline_id = $1`, [id]);
    if (deals.rows[0].n > 0) {
      throw conflict('Pipeline still contains deals; move or delete them first');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM pipelines WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'pipeline.deleted',
        entityType: 'pipeline', entityId: id,
      });
    });
    return { ok: true };
  });

  app.post('/pipelines/:id/stages', manage, async (request, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(StageBody, request.body);
    const { actor } = request;
    await getPipeline(actor.orgId, id);
    const stageId = newId();
    const pos =
      body.position ??
      ((await db.query(`SELECT COALESCE(max(position)+1,0) AS p FROM pipeline_stages WHERE pipeline_id = $1`, [id]))
        .rows[0].p as number);
    await db.query(
      `INSERT INTO pipeline_stages (id, pipeline_id, name, position, probability, is_won, is_lost)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [stageId, id, body.name, pos, body.probability, body.isWon, body.isLost]
    );
    return reply.status(201).send({ id: stageId });
  });

  app.patch('/stages/:id', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(StageBody.partial(), request.body);
    const { actor } = request;
    const r = await db.query(
      `SELECT s.* FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND p.org_id = $2`,
      [id, actor.orgId]
    );
    if (!r.rows[0]) throw notFound('Stage');
    await db.query(
      `UPDATE pipeline_stages SET
         name = COALESCE($1, name),
         probability = COALESCE($2, probability),
         position = COALESCE($3, position),
         is_won = COALESCE($4, is_won),
         is_lost = COALESCE($5, is_lost)
       WHERE id = $6`,
      [body.name ?? null, body.probability ?? null, body.position ?? null, body.isWon ?? null, body.isLost ?? null, id]
    );
    return { ok: true };
  });

  app.delete('/stages/:id', manage, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const r = await db.query(
      `SELECT s.id FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = $1 AND p.org_id = $2`,
      [id, actor.orgId]
    );
    if (!r.rows[0]) throw notFound('Stage');
    const deals = await db.query(`SELECT count(*)::int AS n FROM deals WHERE stage_id = $1`, [id]);
    if (deals.rows[0].n > 0) throw conflict('Stage still contains deals; move them first');
    const remaining = await db.query(
      `SELECT count(*)::int AS n FROM pipeline_stages WHERE pipeline_id = (SELECT pipeline_id FROM pipeline_stages WHERE id = $1)`,
      [id]
    );
    if (remaining.rows[0].n <= 1) throw validation('A pipeline needs at least one stage');
    await db.query(`DELETE FROM pipeline_stages WHERE id = $1`, [id]);
    return { ok: true };
  });
}
