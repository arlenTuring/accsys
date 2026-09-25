import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit tests: no database, no network. Integration tests live in
// vitest.integration.config.ts and require TEST_DATABASE_URL.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.unit.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
