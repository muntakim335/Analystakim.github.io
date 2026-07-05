import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import type { Queryable } from '../db/db.js';
import { hashPassword, newId, newRefreshToken, sha256, verifyPassword } from '../lib/crypto.js';
import { logAudit } from '../lib/common.js';
import { AppError, conflict, unauthorized, validation } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const Password = z.string().min(8).max(200);

const RegisterBody = z.object({
  orgName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(320).transform((e) => e.toLowerCase()),
  password: Password,
});

const LoginBody = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'member';
  is_active: boolean;
  password_hash: string;
}

export const DEFAULT_STAGES: { name: string; probability: number; isWon?: boolean; isLost?: boolean }[] = [
  { name: 'Qualified', probability: 20 },
  { name: 'Demo Scheduled', probability: 40 },
  { name: 'Proposal Sent', probability: 60 },
  { name: 'Negotiation', probability: 80 },
  { name: 'Won', probability: 100, isWon: true },
  { name: 'Lost', probability: 0, isLost: true },
];

export async function seedDefaultPipeline(q: Queryable, orgId: string): Promise<string> {
  const pipelineId = newId();
  await q.query(
    `INSERT INTO pipelines (id, org_id, name, is_default) VALUES ($1,$2,'Sales',true)`,
    [pipelineId, orgId]
  );
  for (const [i, s] of DEFAULT_STAGES.entries()) {
    await q.query(
      `INSERT INTO pipeline_stages (id, pipeline_id, name, position, probability, is_won, is_lost)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newId(), pipelineId, s.name, i, s.probability, s.isWon ?? false, s.isLost ?? false]
    );
  }
  return pipelineId;
}

export function registerAuth(app: FastifyInstance, ctx: AppCtx): void {
  const { db, config } = ctx;
  const authRateLimit = {
    rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' },
  };

  const publicUser = (u: UserRow) => ({
    id: u.id,
    orgId: u.org_id,
    email: u.email,
    name: u.name,
    role: u.role,
  });

  async function issueTokens(user: UserRow) {
    const accessToken = app.jwt.sign(
      { sub: user.id, org: user.org_id, role: user.role, name: user.name, email: user.email },
      { expiresIn: config.ACCESS_TOKEN_TTL }
    );
    const refreshToken = newRefreshToken();
    const expires = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await db.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [newId(), user.id, sha256(refreshToken), expires.toISOString()]
    );
    return { accessToken, refreshToken };
  }

  app.post('/auth/register', { config: authRateLimit }, async (request, reply) => {
    const body = parse(RegisterBody, request.body);
    const existing = await db.query(`SELECT 1 FROM users WHERE email = $1`, [body.email]);
    if (existing.rows.length > 0) throw conflict('An account with this email already exists');

    const orgId = newId();
    const userId = newId();
    const passwordHash = await hashPassword(body.password, config.BCRYPT_ROUNDS);
    await db.tx(async (q) => {
      await q.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [orgId, body.orgName]);
      await q.query(
        `INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5,'admin')`,
        [userId, orgId, body.email, passwordHash, body.name]
      );
      await seedDefaultPipeline(q, orgId);
      await logAudit(q, {
        orgId,
        actorId: userId,
        action: 'org.registered',
        entityType: 'organization',
        entityId: orgId,
      });
    });

    const user = (await db.query(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0] as UserRow;
    const tokens = await issueTokens(user);
    return reply.status(201).send({ user: publicUser(user), ...tokens });
  });

  app.post('/auth/login', { config: authRateLimit }, async (request) => {
    const body = parse(LoginBody, request.body);
    const r = await db.query(`SELECT * FROM users WHERE email = $1`, [body.email]);
    const user = r.rows[0] as UserRow | undefined;
    // Verify against a constant dummy hash on unknown emails to keep timing flat.
    const hash = user?.password_hash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpDLhKuVkI0BjXbIxLKlQW/nqLOG6';
    const ok = await verifyPassword(body.password, hash);
    if (!user || !ok || !user.is_active) throw unauthorized('Invalid email or password');
    const tokens = await issueTokens(user);
    return { user: publicUser(user), ...tokens };
  });

  app.post('/auth/refresh', { config: authRateLimit }, async (request) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(10) }), request.body);
    const tokenHash = sha256(refreshToken);
    const r = await db.query(
      `SELECT rt.*, u.is_active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );
    const row = r.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date() || !row.is_active) {
      throw unauthorized('Invalid refresh token');
    }
    // Rotation: single use. Reuse of a rotated token revokes the whole family.
    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
    const user = (await db.query(`SELECT * FROM users WHERE id = $1`, [row.user_id]))
      .rows[0] as UserRow;
    return { user: publicUser(user), ...(await issueTokens(user)) };
  });

  app.post('/auth/logout', async (request) => {
    const { refreshToken } = parse(
      z.object({ refreshToken: z.string().optional() }),
      request.body ?? {}
    );
    if (refreshToken) {
      await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [
        sha256(refreshToken),
      ]);
    }
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request) => {
    const { actor } = request;
    const u = (await db.query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [
      actor.id,
      actor.orgId,
    ])).rows[0] as UserRow | undefined;
    if (!u || !u.is_active) throw unauthorized('Account is deactivated');
    const org = (await db.query(`SELECT id, name, created_at FROM organizations WHERE id = $1`, [
      actor.orgId,
    ])).rows[0];
    return { user: publicUser(u), org };
  });

  app.patch('/auth/me', { preHandler: app.authenticate }, async (request) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        currentPassword: z.string().optional(),
        newPassword: Password.optional(),
      }),
      request.body
    );
    const { actor } = request;
    const u = (await db.query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [
      actor.id,
      actor.orgId,
    ])).rows[0] as UserRow;

    if (body.newPassword) {
      if (!body.currentPassword) throw validation('currentPassword is required to change password');
      const ok = await verifyPassword(body.currentPassword, u.password_hash);
      if (!ok) throw new AppError('UNAUTHORIZED', 'Current password is incorrect');
      const passwordHash = await hashPassword(body.newPassword, config.BCRYPT_ROUNDS);
      await db.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
        passwordHash,
        u.id,
      ]);
      // Changing the password invalidates every other session.
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
        [u.id]
      );
    }
    if (body.name) {
      await db.query(`UPDATE users SET name = $1, updated_at = now() WHERE id = $2`, [
        body.name,
        u.id,
      ]);
    }
    await logAudit(db, {
      orgId: actor.orgId,
      actorId: actor.id,
      action: 'user.updated_self',
      entityType: 'user',
      entityId: u.id,
    });
    const fresh = (await db.query(`SELECT * FROM users WHERE id = $1`, [u.id])).rows[0] as UserRow;
    return { user: publicUser(fresh) };
  });
}
