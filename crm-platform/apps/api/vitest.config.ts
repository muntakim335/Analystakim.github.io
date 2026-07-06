import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Each file gets its own in-process Postgres (PGlite); keep memory sane.
    maxConcurrency: 4,
    pool: 'forks',
    // Against a real shared PostgreSQL (TEST_DATABASE_URL) each suite wipes the
    // schema at boot, so files must not run concurrently.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
