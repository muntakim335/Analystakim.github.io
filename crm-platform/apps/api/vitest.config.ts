import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Each file gets its own in-process Postgres (PGlite); keep memory sane.
    maxConcurrency: 4,
    pool: 'forks',
  },
});
