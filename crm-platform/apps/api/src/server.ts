import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import type { AppCtx } from './context.js';
import type { Actor } from './lib/common.js';
import { AppError } from './lib/errors.js';
import { openapiDocument } from './openapi.js';
import { registerAuth } from './modules/auth.js';
import { registerUsers } from './modules/users.js';
import { registerContacts } from './modules/contacts.js';
import { registerCompanies } from './modules/companies.js';
import { registerLeads } from './modules/leads.js';
import { registerPipelines } from './modules/pipelines.js';
import { registerDeals } from './modules/deals.js';
import { registerTasks } from './modules/tasks.js';
import { registerNotes } from './modules/notes.js';
import { registerActivities } from './modules/activities.js';
import { registerCustomFields } from './modules/custom-fields.js';
import { registerWorkflows, startWorkflowEngine } from './modules/workflows.js';
import { registerNotifications } from './modules/notifications.js';
import { registerFiles } from './modules/files.js';
import { registerSearch } from './modules/search.js';
import { registerReports } from './modules/reports.js';

interface JwtPayload {
  sub: string;
  org: string;
  role: Actor['role'];
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Actor['role'][]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function buildServer(ctx: AppCtx): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(','),
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req as FastifyRequest).actor?.id ?? req.ip,
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
    }),
  });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  app.decorateRequest('actor');
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      request.actor = {
        id: payload.sub,
        orgId: payload.org,
        role: payload.role,
        name: payload.name,
        email: payload.email,
      };
    } catch {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid access token');
    }
  });
  app.decorate('requireRole', (...roles: Actor['role'][]) => {
    return async (request: FastifyRequest) => {
      await app.authenticate(request, undefined as never);
      if (!roles.includes(request.actor.role)) {
        throw new AppError('FORBIDDEN', `Requires role: ${roles.join(' or ')}`);
      }
    };
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return reply.status(413).send({ error: { code: 'VALIDATION', message: 'Payload too large' } });
    }
    request.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  );

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true };
  });
  app.get('/api/openapi.json', async () => openapiDocument);

  await app.register(
    async (api) => {
      registerAuth(api, ctx);
      registerUsers(api, ctx);
      registerContacts(api, ctx);
      registerCompanies(api, ctx);
      registerLeads(api, ctx);
      registerPipelines(api, ctx);
      registerDeals(api, ctx);
      registerTasks(api, ctx);
      registerNotes(api, ctx);
      registerActivities(api, ctx);
      registerCustomFields(api, ctx);
      registerWorkflows(api, ctx);
      registerNotifications(api, ctx);
      registerFiles(api, ctx);
      registerSearch(api, ctx);
      registerReports(api, ctx);
    },
    { prefix: '/api/v1' }
  );

  startWorkflowEngine(ctx);

  return app;
}
