import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Legacy Supabase RLS tests. They create users through Supabase Auth
 * (auth.admin.createUser / signInWithPassword) and assert row-level-security
 * policies; neither exists in the plain-PostgreSQL stack. They are NOT passing
 * tests — they cannot run at all. Replacement: application-level authorization
 * tests written in P3 (see README "測試" for the mapping). Delete these files
 * once the replacements land (P5).
 */
export const LEGACY_SUPABASE_RLS_TESTS = [
  'tests/integration/master-data-rls.test.ts',
  'tests/integration/procurement-rls.test.ts',
  'tests/integration/new-forms-rls.test.ts',
  'tests/integration/projects-rls.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/**/*.unit.test.ts', ...LEGACY_SUPABASE_RLS_TESTS],
    setupFiles: ['tests/integration/setup-env.ts'],
    // Suites share one database and clean up their own rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
