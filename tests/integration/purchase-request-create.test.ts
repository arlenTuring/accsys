import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';
import { getSql } from '@/lib/db';

// The action reads the caller via getCurrentEmployee(createSupabaseServerClient()).
// Stub that seam so the integration test can act as a chosen seed employee while
// every write still goes through the real service-role path against the live DB.
const currentEmployee = vi.hoisted(
  () => ({ value: null as null | { id: string; departmentId: string } })
);
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('createPurchaseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let applicantDept: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    // Pick a staff applicant whose department has a manager, and a budget code.
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
  });

  afterEach(async () => {
    currentEmployee.value = null;
    for (const id of createdRequestIds.splice(0)) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('procurement_case_id')
        .eq('id', id)
        .maybeSingle();
      await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('notifications').delete().eq('form_type', 'purchase_request').eq('form_id', id);
      await admin.from('purchase_requests').delete().eq('id', id);
      if (pr?.procurement_case_id) {
        await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
      }
    }
  });

  it('rejects an empty item list', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({ idempotencyKey: crypto.randomUUID(), neededWithinDays: 30, items: [] });
    expect(result).toMatchObject({ ok: false, error: '請購單至少需要一個明細項次' });
  });

  it('creates a case, request, items, and an approval chain', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({ idempotencyKey: crypto.randomUUID(),
      neededWithinDays: 30,
      items: [
        { budgetCodeId, description: '材料A', quantity: 1, estimatedAmount: 65000 },
        { budgetCodeId, description: '材料B', quantity: 2, estimatedAmount: 20000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdRequestIds.push(result.requestId);
    expect(result.caseNumber).toMatch(/^CP\d{9}$/);

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('total_amount, status, current_step_order')
      .eq('id', result.requestId)
      .single();
    expect(Number(pr!.total_amount)).toBe(85000);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('step_order, approver_role, status, approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId)
      .order('step_order');
    expect(steps!.length).toBeGreaterThanOrEqual(1);
    expect(steps![0].status).toBe('pending');
    expect(pr!.current_step_order).toBe(steps![0].step_order);

    const { data: notifs } = await admin
      .from('notifications')
      .select('recipient_employee_id, type')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId);
    expect(notifs!.length).toBe(1);
    expect(notifs![0].type).toBe('approval_requested');
    expect(notifs![0].recipient_employee_id).toBe(steps![0].approver_employee_id);
  });
});
