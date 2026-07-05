import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { newId } from '../lib/crypto.js';
import { logActivity, logAudit } from '../lib/common.js';
import { forbidden, notFound, validation } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const RelatedType = z.enum(['contact', 'company', 'lead', 'deal']);

// Conservative allow-list; extend deliberately, never with executables.
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/zip',
]);

export function registerFiles(app: FastifyInstance, ctx: AppCtx): void {
  const { db, storage } = ctx;

  app.get('/files', { preHandler: app.authenticate }, async (request) => {
    const query = parse(
      z.object({ related_type: RelatedType, related_id: z.string().uuid() }),
      request.query
    );
    const r = await db.query(
      `SELECT f.id, f.filename, f.mime, f.size, f.related_type AS "relatedType",
              f.related_id AS "relatedId", f.uploaded_by AS "uploadedBy", u.name AS "uploaderName",
              f.created_at AS "createdAt"
       FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE f.org_id = $1 AND f.related_type = $2 AND f.related_id = $3
       ORDER BY f.created_at DESC`,
      [request.actor.orgId, query.related_type, query.related_id]
    );
    return { data: r.rows };
  });

  app.post('/files', { preHandler: app.authenticate }, async (request, reply) => {
    const upload = await request.file();
    if (!upload) throw validation('Attach a file in a multipart field');
    const fields = upload.fields as Record<string, { value?: unknown } | undefined>;
    const meta = parse(
      z.object({ relatedType: RelatedType, relatedId: z.string().uuid() }),
      {
        relatedType: fields.relatedType?.value,
        relatedId: fields.relatedId?.value,
      }
    );
    if (!ALLOWED_MIME.has(upload.mimetype)) {
      throw validation(`File type ${upload.mimetype} is not allowed`);
    }
    const buffer = await upload.toBuffer();
    const { actor } = request;
    const key = await storage.save(buffer);
    const id = newId();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO files (id, org_id, filename, mime, size, storage_key, related_type, related_id, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, actor.orgId, upload.filename, upload.mimetype, buffer.length, key, meta.relatedType, meta.relatedId, actor.id]
      );
      await logActivity(q, {
        orgId: actor.orgId, actorId: actor.id, type: 'file_uploaded',
        entityType: meta.relatedType, entityId: meta.relatedId,
        payload: { fileId: id, filename: upload.filename },
      });
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'file.uploaded',
        entityType: 'file', entityId: id,
        changes: { filename: { from: null, to: upload.filename } },
      });
    });
    return reply.status(201).send({ id, filename: upload.filename, size: buffer.length });
  });

  app.get('/files/:id/download', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const r = await db.query(`SELECT * FROM files WHERE id = $1 AND org_id = $2`, [
      id, request.actor.orgId,
    ]);
    const file = r.rows[0];
    if (!file) throw notFound('File');
    return reply
      .type(file.mime)
      .header('content-disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`)
      .send(storage.stream(file.storage_key));
  });

  app.delete('/files/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { actor } = request;
    const r = await db.query(`SELECT * FROM files WHERE id = $1 AND org_id = $2`, [id, actor.orgId]);
    const file = r.rows[0];
    if (!file) throw notFound('File');
    if (actor.role === 'member' && file.uploaded_by !== actor.id) {
      throw forbidden('Members can only delete files they uploaded');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM files WHERE id = $1`, [id]);
      await logAudit(q, {
        orgId: actor.orgId, actorId: actor.id, action: 'file.deleted',
        entityType: 'file', entityId: id,
        changes: { filename: { from: file.filename, to: null } },
      });
    });
    await storage.remove(file.storage_key);
    return { ok: true };
  });
}
