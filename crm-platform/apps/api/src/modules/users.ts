import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { diff, logAudit } from '../lib/common.js';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const Role = z.enum(['admin', 'manager', 'member']);

const CreateUser = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(320).transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  role: Role.default('member'),
});

const UpdateUser = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: Role.optional(),
  isActive: z.boolean().optional(),
});

export function registerUsers(app: FastifyInstance, ctx: AppCtx): void {
  const { db } = ctx;
  const COLS = `id, email, name, role, is_active AS "isActive", created_at AS "createdAt"`;

  app.get('/users', { preHandler: app.authenticate }, async (request) => {
    const r = await db.query(
      `SELECT ${COLS} FROM users WHERE org_id = $1 ORDER BY created_at`,
      [request.actor.orgId]
    );
    return { data: r.rows };
  });

  app.post('/users', { preHandler: app.requireRole('admin') }, async (request, reply) => {
    const body = parse(CreateUser, request.body);
    const { actor } = request;
    const existing = await db.query(`SELECT 1 FROM users WHERE email = $1`, [body.email]);
    if (existing.rows.length > 0) throw conflict('An account with this email already exists');

    const id = newId();
    const passwordHash = await hashPassword(body.password, ctx.config.BCRYPT_ROUNDS);
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, actor.orgId, body.email, passwordHash, body.name, body.role]
      );
      await logAudit(q, {
        orgId: actor.orgId,
        actorId: actor.id,
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        changes: { email: { from: null, to: body.email }, role: { from: null, to: body.role } },
      });
    });
    const user = (await db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id])).rows[0];
    return reply.status(201).send(user);
  });

  app.patch('/users/:id', { preHandler: app.requireRole('admin') }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(UpdateUser, request.body);
    const { actor } = request;

    const existing = (
      await db.query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('User');

    const demoting =
      (body.role !== undefined && body.role !== 'admin' && existing.role === 'admin') ||
      (body.isActive === false && existing.role === 'admin');
    if (demoting) {
      const admins = await db.query(
        `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND is_active`,
        [actor.orgId]
      );
      if (admins.rows[0].n <= 1) throw conflict('Cannot demote or deactivate the last active admin');
    }

    await db.tx(async (q) => {
      await q.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           role = COALESCE($2, role),
           is_active = COALESCE($3, is_active),
           updated_at = now()
         WHERE id = $4`,
        [body.name ?? null, body.role ?? null, body.isActive ?? null, id]
      );
      if (body.isActive === false) {
        await q.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [id]
        );
      }
      await logAudit(q, {
        orgId: actor.orgId,
        actorId: actor.id,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        changes: diff(
          { name: existing.name, role: existing.role, isActive: existing.is_active },
          { name: body.name ?? existing.name, role: body.role ?? existing.role, isActive: body.isActive ?? existing.is_active }
        ),
      });
    });
    return (await db.query(`SELECT ${COLS} FROM users WHERE id = $1`, [id])).rows[0];
  });

  // Deactivation, not deletion: history must keep pointing at real users.
  app.delete('/users/:id', { preHandler: app.requireRole('admin') }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const existing = (
      await db.query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [id, actor.orgId])
    ).rows[0];
    if (!existing) throw notFound('User');
    if (existing.role === 'admin') {
      const admins = await db.query(
        `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin' AND is_active`,
        [actor.orgId]
      );
      if (admins.rows[0].n <= 1) throw conflict('Cannot deactivate the last active admin');
    }
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
      await q.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [id]
      );
      await logAudit(q, {
        orgId: actor.orgId,
        actorId: actor.id,
        action: 'user.deactivated',
        entityType: 'user',
        entityId: id,
      });
    });
    return { ok: true };
  });
}
