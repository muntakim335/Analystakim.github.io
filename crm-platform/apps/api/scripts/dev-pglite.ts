/**
 * Zero-dependency demo/E2E server: boots the full API on :3001 backed by
 * in-process Postgres (PGlite). Nothing to install or configure — useful for
 * trying NimbusCRM without a database, and for browser E2E in CI.
 * Data lives in memory and is gone when the process exits. NOT for production.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createPgliteDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { EventBus } from '../src/lib/events.js';
import { createMailer } from '../src/lib/mailer.js';
import { createLocalStorage } from '../src/lib/storage.js';
import { buildServer } from '../src/server.js';

const db = await createPgliteDb();
await migrate(db);
const config = loadConfig({
  NODE_ENV: 'development',
  UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'crm-demo-uploads-')),
});
const app = await buildServer({
  db,
  config,
  bus: new EventBus(),
  mailer: await createMailer(config),
  storage: createLocalStorage(config.UPLOAD_DIR),
});
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`NimbusCRM demo API (in-memory Postgres) on http://localhost:${config.PORT}`);
