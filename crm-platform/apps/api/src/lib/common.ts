import type { Queryable } from '../db/db.js';
import type { AppCtx } from '../context.js';
import { newId } from './crypto.js';

export interface Actor {
  id: string;
  orgId: string;
  role: 'admin' | 'manager' | 'member';
  name: string;
  email: string;
}

/** Append-only compliance log. Written in the SAME transaction as the mutation. */
export async function logAudit(
  q: Queryable,
  entry: {
    orgId: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    changes?: Record<string, unknown>;
  }
): Promise<void> {
  await q.query(
    `INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, changes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId(),
      entry.orgId,
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.changes ?? {}),
    ]
  );
}

/** User-facing timeline entry. */
export async function logActivity(
  q: Queryable,
  entry: {
    orgId: string;
    actorId: string | null;
    type: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  await q.query(
    `INSERT INTO activities (id, org_id, actor_id, type, entity_type, entity_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId(),
      entry.orgId,
      entry.actorId,
      entry.type,
      entry.entityType,
      entry.entityId,
      JSON.stringify(entry.payload ?? {}),
    ]
  );
}

/** In-app notification; best-effort email when SMTP is configured. */
export async function notifyUser(
  ctx: AppCtx,
  n: {
    orgId: string;
    userId: string;
    type: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
  }
): Promise<void> {
  await ctx.db.query(
    `INSERT INTO notifications (id, org_id, user_id, type, title, body, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [newId(), n.orgId, n.userId, n.type, n.title, n.body ?? '', n.entityType ?? null, n.entityId ?? null]
  );
  if (ctx.mailer.enabled) {
    const r = await ctx.db.query(
      `SELECT email FROM users WHERE id = $1 AND org_id = $2 AND is_active`,
      [n.userId, n.orgId]
    );
    const email = r.rows[0]?.email;
    if (email) {
      ctx.mailer.send(email, n.title, n.body ?? '').catch(() => {});
    }
  }
}

/** Field-level diff for audit entries: only fields present in `after` are compared. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key];
    const next = after[key];
    if (JSON.stringify(prev) !== JSON.stringify(next)) changes[key] = { from: prev ?? null, to: next };
  }
  return changes;
}
