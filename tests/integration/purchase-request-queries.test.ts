import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';
import { getSql } from '@/lib/db';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
// Route the user-session client used by the queries to the service-role client for
// the test (RLS scoping itself is covered by procurement-rls.test.ts).
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    const { createServiceRoleTestClient } = await import('./supabase-test-client');
    return createServiceRoleTestClient();
  },
}));
// Hoisted (not vi.doMock inside beforeAll): actions.ts imports next/cache at module
// eval time, so a doMock issued after the dynamic import of actions.ts is too late to
// take effect. This mirrors the existing pattern in purchase-request-create.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('purchase request queries', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let applicantDept: string;
  let budgetCodeId: string;
  let requestId: string;

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emp } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(1)
      .single();
    applicantId = emp!.id;
    applicantDept = emp!.department_id;
    const [bc] = await getSql()<{ id: string }[]>`
      select id from budget_codes where owner_employee_id is not null limit 1`;
    budgetCodeId = bc!.id;
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const actions = await import('@/lib/purchase-requests/actions');
    const created = await actions.createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '查詢測試', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    requestId = created.requestId;
  });

  afterAll(async () => {
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', requestId)
      .maybeSingle();
    await admin.from('approval_steps').delete().eq('form_id', requestId);
    await admin.from('notifications').delete().eq('form_id', requestId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    if (pr?.procurement_case_id) await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    currentEmployee.value = null;
  });

  it('getMyRequests returns the applicant’s request', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const { getMyRequests } = await import('@/lib/purchase-requests/queries');
    const rows = await getMyRequests();
    expect(rows.some((r) => r.id === requestId)).toBe(true);
  });

  it('getPurchaseRequestDetail returns items and steps', async () => {
    const { getPurchaseRequestDetail } = await import('@/lib/purchase-requests/queries');
    const detail = await getPurchaseRequestDetail(requestId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(1);
    expect(detail!.steps.length).toBeGreaterThanOrEqual(1);
    expect(detail!.items[0].description).toBe('查詢測試');
  });

  it('getMyApprovalQueue returns requests pending the caller', async () => {
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id, departmentId: applicantDept };
    const { getMyApprovalQueue } = await import('@/lib/purchase-requests/queries');
    const queue = await getMyApprovalQueue();
    expect(queue.some((q) => q.id === requestId)).toBe(true);
  });
});
