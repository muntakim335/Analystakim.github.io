import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { EventBus } from '../src/lib/events.js';
import { createLocalStorage } from '../src/lib/storage.js';
import { buildServer } from '../src/server.js';
import type { AppCtx } from '../src/context.js';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  bus: EventBus;
  ctx: AppCtx;
  close(): Promise<void>;
}

/**
 * Boots a full API instance against a fresh database and real migrations.
 * Uses PGlite (in-process Postgres) by default; set TEST_DATABASE_URL to run
 * the identical suite against a real PostgreSQL server (CI does this).
 */
export async function createTestApp(): Promise<TestApp> {
  const db = process.env.TEST_DATABASE_URL
    ? createPgDb(process.env.TEST_DATABASE_URL)
    : await createPgliteDb();

  if (process.env.TEST_DATABASE_URL) {
    // Isolate suites sharing one server: wipe public schema per app boot.
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
  await migrate(db, migrationsDir);

  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret',
    BCRYPT_ROUNDS: 4,
    RATE_LIMIT_MAX: 1_000_000,
    AUTH_RATE_LIMIT_MAX: 1_000_000,
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'crm-uploads-')),
  });
  const bus = new EventBus();
  const sent: { to: string; subject: string }[] = [];
  const ctx: AppCtx = {
    db,
    config,
    bus,
    mailer: {
      enabled: false,
      send: async (to, subject) => {
        sent.push({ to, subject });
      },
    },
    storage: createLocalStorage(config.UPLOAD_DIR),
  };
  const app = await buildServer(ctx);
  await app.ready();
  return {
    app, db, bus, ctx,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

let orgCounter = 0;

/** Registers a fresh org; returns tokens + ids for API calls. */
export async function registerOrg(
  app: FastifyInstance,
  overrides: Partial<{ orgName: string; name: string; email: string; password: string }> = {}
) {
  orgCounter++;
  const body = {
    orgName: overrides.orgName ?? `Acme ${orgCounter}`,
    name: overrides.name ?? `Owner ${orgCounter}`,
    email: overrides.email ?? `owner${orgCounter}-${Date.now()}@test.dev`,
    password: overrides.password ?? 'password123',
    ...overrides,
  };
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const json = res.json();
  return {
    ...body,
    user: json.user as { id: string; orgId: string; email: string; role: string },
    accessToken: json.accessToken as string,
    refreshToken: json.refreshToken as string,
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Shorthand for authenticated JSON requests. */
export async function api(
  app: FastifyInstance,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown
) {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: auth(token),
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  return res;
}
