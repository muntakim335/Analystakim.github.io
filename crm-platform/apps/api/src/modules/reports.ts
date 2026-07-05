import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

export function registerReports(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  /** KPI tiles for the dashboard. */
  app.get('/reports/overview', { preHandler: app.authenticate }, async (request) => {
    const { orgId } = request.actor;
    const r = await db.query(
      `SELECT
         (SELECT count(*)::int FROM contacts WHERE org_id = $1) AS contacts,
         (SELECT count(*)::int FROM companies WHERE org_id = $1) AS companies,
         (SELECT count(*)::int FROM deals WHERE org_id = $1 AND status = 'open') AS "openDeals",
         (SELECT COALESCE(sum(value),0)::float8 FROM deals WHERE org_id = $1 AND status = 'open') AS "openValue",
         (SELECT count(*)::int FROM deals WHERE org_id = $1 AND status = 'won'
            AND closed_at >= date_trunc('month', now())) AS "wonThisMonth",
         (SELECT COALESCE(sum(value),0)::float8 FROM deals WHERE org_id = $1 AND status = 'won'
            AND closed_at >= date_trunc('month', now())) AS "wonValueThisMonth",
         (SELECT COALESCE(sum(value),0)::float8 FROM deals WHERE org_id = $1 AND status = 'won'
            AND closed_at >= date_trunc('month', now() - interval '1 month')
            AND closed_at < date_trunc('month', now())) AS "wonValuePrevMonth",
         (SELECT count(*)::int FROM leads WHERE org_id = $1
            AND created_at >= now() - interval '30 days') AS "newLeads30d",
         (SELECT count(*)::int FROM tasks WHERE org_id = $1 AND status = 'open'
            AND due_date < now()) AS "overdueTasks"`,
      [orgId]
    );
    return r.rows[0];
  });

  /** Per-stage funnel for one pipeline (open deals). */
  app.get('/reports/pipeline', { preHandler: app.authenticate }, async (request) => {
    const { pipeline_id } = parse(
      z.object({ pipeline_id: z.string().uuid().optional() }),
      request.query
    );
    const { orgId } = request.actor;
    let pipelineId = pipeline_id;
    if (!pipelineId) {
      const p = await db.query(
        `SELECT id FROM pipelines WHERE org_id = $1 ORDER BY is_default DESC, created_at LIMIT 1`,
        [orgId]
      );
      if (!p.rows[0]) throw notFound('Pipeline');
      pipelineId = p.rows[0].id;
    }
    const r = await db.query(
      `SELECT s.id, s.name, s.position, s.probability,
              count(d.id)::int AS count,
              COALESCE(sum(d.value),0)::float8 AS value,
              COALESCE(sum(d.value * s.probability / 100.0),0)::float8 AS "weightedValue"
       FROM pipeline_stages s
       LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open' AND d.org_id = $1
       WHERE s.pipeline_id = $2 AND NOT s.is_won AND NOT s.is_lost
       GROUP BY s.id ORDER BY s.position`,
      [orgId, pipelineId]
    );
    return { pipelineId, stages: r.rows };
  });

  /** Won revenue per month for the last N months. */
  app.get('/reports/revenue', { preHandler: app.authenticate }, async (request) => {
    const { months } = parse(
      z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
      request.query
    );
    const r = await db.query(
      `SELECT to_char(date_trunc('month', closed_at), 'YYYY-MM') AS month,
              count(*)::int AS count, COALESCE(sum(value),0)::float8 AS value
       FROM deals
       WHERE org_id = $1 AND status = 'won'
         AND closed_at >= date_trunc('month', now()) - ($2 || ' months')::interval
       GROUP BY 1 ORDER BY 1`,
      [request.actor.orgId, String(months - 1)]
    );
    return { data: r.rows };
  });

  /** Lead counts and conversion rate per source. */
  app.get('/reports/lead-sources', { preHandler: app.authenticate }, async (request) => {
    const r = await db.query(
      `SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'converted')::int AS converted
       FROM leads WHERE org_id = $1
       GROUP BY 1 ORDER BY total DESC LIMIT 20`,
      [request.actor.orgId]
    );
    return {
      data: r.rows.map((row) => ({
        ...row,
        conversionRate: row.total > 0 ? Math.round((row.converted / row.total) * 100) : 0,
      })),
    };
  });

  /** Per-owner performance. */
  app.get('/reports/leaderboard', { preHandler: app.authenticate }, async (request) => {
    const { period } = parse(
      z.object({ period: z.enum(['month', 'quarter', 'year', 'all']).default('month') }),
      request.query
    );
    const since: Record<string, string> = {
      month: `date_trunc('month', now())`,
      quarter: `date_trunc('quarter', now())`,
      year: `date_trunc('year', now())`,
      all: `'epoch'::timestamptz`,
    };
    const r = await db.query(
      `SELECT u.id, u.name,
              count(d.id) FILTER (WHERE d.status = 'won' AND d.closed_at >= ${since[period]})::int AS "wonCount",
              COALESCE(sum(d.value) FILTER (WHERE d.status = 'won' AND d.closed_at >= ${since[period]}),0)::float8 AS "wonValue",
              COALESCE(sum(d.value) FILTER (WHERE d.status = 'open'),0)::float8 AS "openValue"
       FROM users u
       LEFT JOIN deals d ON d.owner_id = u.id AND d.org_id = $1
       WHERE u.org_id = $1 AND u.is_active
       GROUP BY u.id, u.name
       ORDER BY "wonValue" DESC`,
      [request.actor.orgId]
    );
    return { period, data: r.rows };
  });
}
