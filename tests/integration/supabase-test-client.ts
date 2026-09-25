import { createAppDb } from '@/lib/db/app-client';

// Legacy helper names kept so the pre-Drizzle integration tests keep compiling.
// Both return the same app-level client: there is no Supabase service role or
// anon role any more. The database is selected by tests/integration/setup-env.ts.

export function createServiceRoleTestClient() {
  return createAppDb();
}

export function createAnonTestClient() {
  return createAppDb();
}
