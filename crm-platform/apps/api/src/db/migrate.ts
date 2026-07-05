import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

/**
 * Applies all pending .sql migrations in filename order.
 * Each file runs in one transaction; applied versions are tracked in schema_migrations.
 * With the pg driver an advisory lock prevents N replicas racing at boot.
 */
export async function migrate(db: Db, dir?: string): Promise<string[]> {
  const migrationsDir =
    dir ??
    process.env.MIGRATIONS_DIR ??
    join(dirname(fileURLToPath(import.meta.url)), 'migrations');

  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  if (db.kind === 'pg') await db.query('SELECT pg_advisory_lock(727274)');
  const applied: string[] = [];
  try {
    const done = new Set(
      (await db.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
    );
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await db.tx(async (q) => {
        await q.query(sql);
        await q.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      });
      applied.push(file);
    }
  } finally {
    if (db.kind === 'pg') await db.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
  }
  return applied;
}
