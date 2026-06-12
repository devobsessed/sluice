import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['dotenv/config', './vitest.setup.ts'],
    // Tests that hit the real goldminer_test Postgres DB share mutable state:
    // every setupTestDb() TRUNCATEs all tables, so parallel workers wipe each
    // other's rows mid-test (flaky route.race.test.ts A1). DB-bound files run
    // sequentially in their own project; everything else stays parallel.
    projects: [
      {
        extends: true,
        test: {
          name: 'db',
          fileParallelism: false,
          exclude: ['node_modules', '.next'],
          include: [
            'src/app/api/auth/**/route.race.test.ts',
            'src/lib/auth/__tests__/refresh-dedupe.test.ts',
            'src/lib/db/__tests__/access-requests.test.ts',
            'src/lib/db/__tests__/schema.test.ts',
            'src/lib/personas/__tests__/regeneration-lock.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.{ts,tsx}'],
          exclude: [
            'node_modules',
            '.next',
            'src/app/api/auth/**/route.race.test.ts',
            'src/lib/auth/__tests__/refresh-dedupe.test.ts',
            'src/lib/db/__tests__/access-requests.test.ts',
            'src/lib/db/__tests__/schema.test.ts',
            'src/lib/personas/__tests__/regeneration-lock.test.ts',
          ],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
