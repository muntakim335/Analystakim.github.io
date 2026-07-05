import pg from 'pg';

/** Minimal query surface shared by pg.Pool, pg.PoolClient and PGlite. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

/** Database handle: plain queries plus serializable transactions. */
export interface Db extends Queryable {
  /** Run fn inside BEGIN/COMMIT; rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pg' | 'pglite';
}

/** Production driver: node-postgres connection pool. */
export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    kind: 'pg',
    async query(text, params) {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query(text, params) {
            const r = await client.query(text, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/**
 * Test driver: PGlite (real Postgres compiled to WASM, in-process).
 * Single-connection, so transactions serialize through a promise chain —
 * fine for tests, never used in production.
 */
export async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite();
  let chain: Promise<unknown> = Promise.resolve();

  const rawQuery = async (text: string, params?: unknown[]) => {
    if (!params || params.length === 0) {
      // exec() handles multi-statement SQL (migrations); query() is single-statement only
      const results = await lite.exec(text);
      const last = results[results.length - 1];
      return {
        rows: (last?.rows ?? []) as any[],
        rowCount: (last as any)?.affectedRows ?? last?.rows?.length ?? 0,
      };
    }
    const r = await lite.query(text, params as any[]);
    return { rows: r.rows as any[], rowCount: (r as any).affectedRows ?? r.rows.length };
  };

  return {
    kind: 'pglite',
    query(text, params) {
      const next = chain.then(() => rawQuery(text, params));
      chain = next.catch(() => {});
      return next;
    },
    tx(fn) {
      const next = chain.then(async () => {
        await rawQuery('BEGIN');
        try {
          const result = await fn({ query: rawQuery });
          await rawQuery('COMMIT');
          return result;
        } catch (err) {
          await rawQuery('ROLLBACK').catch(() => {});
          throw err;
        }
      });
      chain = next.catch(() => {});
      return next;
    },
    async close() {
      await chain.catch(() => {});
      await lite.close();
    },
  };
}
