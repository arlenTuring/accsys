import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(
  () => ({ value: null as null | { id: string; departmentId?: string } })
);
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe.skipIf(!hasIntegrationTestCredentials())('approve/return purchase request', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let applicantDept: string;
  let managerId: string;
  let gmId: string;
  let budgetCodeId: string;
  const createdRequestIds: string[] = [];

  async function makeRequestWithTwoSteps(): Promise<string> {
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    const { data: pr, error } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: pcase!.id,
        applicant_employee_id: applicantId,
        department_id: applicantDept,
        budget_owner_employee_id: applicantId,
        total_amount: 5000,
        status: 'pending_approval',
        current_step_order: 1,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create request: ${JSON.stringify(error)}`);
    createdRequestIds.push(pr!.id);
    await admin.from('approval_steps').insert([
      {
        form_type: 'purchase_request',
        form_id: pr!.id,
        step_order: 1,
        approver_employee_id: managerId,
        approver_role: 'department_manager',
      },
      {
        form_type: 'purchase_request',
        form_id: pr!.id,
        step_order: 2,
        approver_employee_id: gmId,
        approver_role: 'general_manager',
      },
    ]);
    return pr!.id;
  }

  async function seedRequest(): Promise<{ requestId: string; firstApproverId: string }> {
    currentEmployee.value = { id: applicantId, departmentId: applicantDept };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '簽核測試', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!result.ok) throw new Error(result.error);
    createdRequestIds.push(result.requestId);
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', result.requestId)
      .eq('step_order', 1)
      .single();
    return { requestId: result.requestId, firstApproverId: step!.approver_employee_id };
  }

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .not('department_id', 'is', null)
      .limit(3);
    [applicantId, managerId, gmId] = emps!.map((e) => e.id);
    applicantDept = emps![0].department_id;
    const { data: bc } = await admin
      .from('budget_codes')
      .select('id')
      .not('owner_employee_id', 'is', null)
      .limit(1)
      .single();
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

  it('rejects approval from someone who is not the current approver', async () => {
    const { requestId } = await seedRequest();
    currentEmployee.value = { id: '00000000-0000-0000-0000-000000000000' };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    const result = await approvePurchaseRequestStep(requestId);
    expect(result).toEqual({ ok: false, error: '您不是這張請購單目前的簽核人' });
  });

  it('advances the chain and finally approves the request', async () => {
    const { requestId } = await seedRequest();
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    // Walk every step as its approver.
    for (let guard = 0; guard < 5; guard += 1) {
      const { data: pr } = await admin
        .from('purchase_requests')
        .select('status, current_step_order')
        .eq('id', requestId)
        .single();
      if (pr!.status === 'approved') break;
      const { data: step } = await admin
        .from('approval_steps')
        .select('approver_employee_id')
        .eq('form_type', 'purchase_request')
        .eq('form_id', requestId)
        .eq('step_order', pr!.current_step_order)
        .single();
      const approverId = step!.approver_employee_id;
      currentEmployee.value = { id: approverId };
      const result = await approvePurchaseRequestStep(requestId);
      expect(result.ok).toBe(true);
      const { data: ownNotif } = await admin
        .from('notifications')
        .select('is_read')
        .eq('form_id', requestId)
        .eq('recipient_employee_id', approverId)
        .eq('type', 'approval_requested')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      expect(ownNotif!.is_read).toBe(true);
    }
    const { data: final } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(final!.status).toBe('approved');
    expect(final!.current_step_order).toBeNull();
    const { data: applicantNotif } = await admin
      .from('notifications')
      .select('type')
      .eq('form_id', requestId)
      .eq('recipient_employee_id', applicantId)
      .eq('type', 'request_approved');
    expect(applicantNotif!.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the request to the applicant with a reason', async () => {
    const { requestId } = await seedRequest();
    const { data: step } = await admin
      .from('approval_steps')
      .select('approver_employee_id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    currentEmployee.value = { id: step!.approver_employee_id };
    const { returnPurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    const result = await returnPurchaseRequestStep(requestId, '預算不足，請修改');
    expect(result.ok).toBe(true);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(pr!.status).toBe('returned');
    expect(pr!.current_step_order).toBeNull();
    const { data: returnedStep } = await admin
      .from('approval_steps')
      .select('status, comment')
      .eq('form_id', requestId)
      .eq('step_order', 1)
      .single();
    expect(returnedStep!.status).toBe('returned');
    expect(returnedStep!.comment).toBe('預算不足，請修改');
    const { data: notif } = await admin
      .from('notifications')
      .select('type')
      .eq('form_id', requestId)
      .eq('recipient_employee_id', applicantId)
      .eq('type', 'request_returned');
    expect(notif!.length).toBe(1);
    const { data: ownNotif } = await admin
      .from('notifications')
      .select('is_read')
      .eq('form_id', requestId)
      .eq('recipient_employee_id', step!.approver_employee_id)
      .eq('type', 'approval_requested')
      .single();
    expect(ownNotif!.is_read).toBe(true);
  });

  it('only advances the chain once when approve is called twice concurrently for the same step', async () => {
    const requestId = await makeRequestWithTwoSteps();
    currentEmployee.value = { id: managerId };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');

    const [first, second] = await Promise.all([
      approvePurchaseRequestStep(requestId),
      approvePurchaseRequestStep(requestId),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const { data: notifs } = await admin
      .from('notifications')
      .select('id')
      .eq('form_type', 'purchase_request')
      .eq('form_id', requestId)
      .eq('type', 'approval_requested');
    expect(notifs).toHaveLength(1);
  });
});
