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

const FORM_TABLES = ['purchase_requests', 'purchase_orders', 'acceptances', 'expense_requests'] as const;

/** Current version of a form header, for edit/resubmit calls (stale-edit protection). */
export async function versionOf(table: (typeof FORM_TABLES)[number], id: string): Promise<number> {
  const { getSql } = await import('@/lib/db');
  if (!FORM_TABLES.includes(table)) throw new Error(`unknown form table ${table}`);
  const rows = await getSql().unsafe<{ version: number }[]>(`select version from ${table} where id = $1`, [id]);
  return Number(rows[0]?.version ?? 0);
}
