import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { parse } from '../lib/validate.js';

/** Global top-bar search: grouped hits across the four core entities. */
export function registerSearch(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;

  app.get('/search', { preHandler: app.authenticate }, async (request) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(200) }), request.query);
    const { orgId } = request.actor;
    const like = `%${q}%`;

    const [contacts, companies, leads, deals] = [
      await db.query(
        `SELECT id, first_name || ' ' || last_name AS label, email AS sub
         FROM contacts WHERE org_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)
         ORDER BY updated_at DESC LIMIT 5`,
        [orgId, like]
      ),
      await db.query(
        `SELECT id, name AS label, domain AS sub
         FROM companies WHERE org_id = $1 AND (name ILIKE $2 OR domain ILIKE $2)
         ORDER BY updated_at DESC LIMIT 5`,
        [orgId, like]
      ),
      await db.query(
        `SELECT id, name AS label, company_name AS sub
         FROM leads WHERE org_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR company_name ILIKE $2)
         ORDER BY updated_at DESC LIMIT 5`,
        [orgId, like]
      ),
      await db.query(
        `SELECT id, title AS label, value::text AS sub
         FROM deals WHERE org_id = $1 AND title ILIKE $2
         ORDER BY updated_at DESC LIMIT 5`,
        [orgId, like]
      ),
    ];
    return {
      contacts: contacts.rows,
      companies: companies.rows,
      leads: leads.rows,
      deals: deals.rows,
    };
  });
}
