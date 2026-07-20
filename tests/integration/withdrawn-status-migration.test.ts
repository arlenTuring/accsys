import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('withdrawn status migration', () => {
  const admin = createServiceRoleTestClient();
  const tables = ['purchase_requests', 'purchase_orders', 'acceptances', 'expense_requests'] as const;

  it.each(tables)('%s accepts withdrawn as a valid status via update', async (table) => {
    const { data: anyRow } = await admin.from(table).select('id, status').limit(1).maybeSingle();
    if (!anyRow) return;
    const originalStatus = anyRow.status;
    try {
      const { error } = await admin.from(table).update({ status: 'withdrawn' }).eq('id', anyRow.id);
      expect(error).toBeNull();
    } finally {
      await admin.from(table).update({ status: originalStatus }).eq('id', anyRow.id);
    }
  });

  it.each(tables)('%s rejects an invalid status value', async (table) => {
    const { data: anyRow } = await admin.from(table).select('id').limit(1).maybeSingle();
    if (!anyRow) return;
    const { error } = await admin.from(table).update({ status: 'not_a_real_status' }).eq('id', anyRow.id);
    expect(error).not.toBeNull();
  });
});
