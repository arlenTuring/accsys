import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';
import { getSql } from '@/lib/db';

const currentEmployee = vi.hoisted(
  () => ({ value: null as null | { id: string; departmentId?: string } })
);
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('resubmitPurchaseRequest', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let applicantDept: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

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
      if (pr?.procurement_case_id) await admin.from('procurement_cases').delete().eq('id', pr.procurement_case_id);
    }
  });

  it('re-validates, resets the chain, and returns the request to pending', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const actions = await import('@/lib/purchase-requests/actions');
    const created = await actions.createPurchaseRequest({ idempotencyKey: crypto.randomUUID(),
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '原始', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    createdRequestIds.push(created.requestId);

    // Capture the original approval chain (ids + count) before it gets rewritten.
    const { data: originalSteps } = await admin
      .from('approval_steps')
      .select('id, approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', created.requestId)
      .order('step_order');
    const originalStepIds = originalSteps!.map((s) => s.id);
    const originalStepCount = originalSteps!.length;

    const { data: originalItems } = await admin
      .from('purchase_request_items')
      .select('id')
      .eq('purchase_request_id', created.requestId);
    const originalItemIds = originalItems!.map((i) => i.id);

    // Return it first.
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', created.requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    await actions.returnPurchaseRequestStep(created.requestId, '請修改', await versionOf('purchase_requests', created.requestId));

    // Applicant resubmits with a changed amount.
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const result = await actions.resubmitPurchaseRequest(created.requestId, {
      expectedVersion: await versionOf('purchase_requests', created.requestId),
      neededWithinDays: 15,
      items: [{ budgetCodeId, description: '修改後', quantity: 2, estimatedAmount: 9000 }],
    });
    expect(result.ok).toBe(true);

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order, total_amount')
      .eq('id', created.requestId)
      .single();
    expect(pr!.status).toBe('pending_approval');
    expect(pr!.current_step_order).toBe(1);
    expect(Number(pr!.total_amount)).toBe(9000);

    const { data: items } = await admin
      .from('purchase_request_items')
      .select('id, description')
      .eq('purchase_request_id', created.requestId);
    expect(items!.map((i) => i.description)).toEqual(['修改後']);
    // Exactly one item row remains — the old one was actually deleted, not just superseded.
    expect(items!.length).toBe(1);
    expect(items!.some((i) => originalItemIds.includes(i.id))).toBe(false);

    const { data: steps } = await admin
      .from('approval_steps')
      .select('id, status')
      .eq('form_type', 'purchase_request')
      .eq('form_id', created.requestId)
      .order('step_order');
    expect(steps!.every((s) => s.status === 'pending')).toBe(true);
    // Same chain composition (dept/budget-owner/GM unchanged) so the count should match,
    // but the row ids must be entirely new — the old steps were deleted, not left behind.
    expect(steps!.length).toBe(originalStepCount);
    const newStepIds = steps!.map((s) => s.id);
    expect(newStepIds.some((id) => originalStepIds.includes(id))).toBe(false);

    // Directly count old-step leftovers: none of the pre-resubmit step ids should still exist.
    const { data: leftoverSteps } = await admin
      .from('approval_steps')
      .select('id')
      .in('id', originalStepIds);
    expect(leftoverSteps!.length).toBe(0);
  });

  it('rejects resubmit by a non-applicant', async () => {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const actions = await import('@/lib/purchase-requests/actions');
    const created = await actions.createPurchaseRequest({ idempotencyKey: crypto.randomUUID(),
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '原始', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!created.ok) throw new Error(created.error);
    createdRequestIds.push(created.requestId);
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_id', created.requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    await actions.returnPurchaseRequestStep(created.requestId, '請修改', await versionOf('purchase_requests', created.requestId));

    currentEmployee.value = { id: '00000000-0000-0000-0000-000000000000' };
    const result = await actions.resubmitPurchaseRequest(created.requestId, {
      expectedVersion: await versionOf('purchase_requests', created.requestId),
      neededWithinDays: 15,
      items: [{ budgetCodeId, description: 'x', quantity: 1, estimatedAmount: 100 }],
    });
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以重新送出這張請購單' });
  });
});
