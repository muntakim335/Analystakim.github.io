import { loadConfig } from './config.js';
import { createPgDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { EventBus } from './lib/events.js';
import { createMailer } from './lib/mailer.js';
import { createLocalStorage } from './lib/storage.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  const db = createPgDb(config.DATABASE_URL);

  const applied = await migrate(db);
  if (applied.length > 0) console.log(`Applied migrations: ${applied.join(', ')}`);

  const ctx = {
    db,
    config,
    bus: new EventBus(),
    mailer: await createMailer(config),
    storage: createLocalStorage(config.UPLOAD_DIR),
  };
  const app = await buildServer(ctx);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, draining…`);
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
