import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient, versionOf } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string; departmentId: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

describe('purchase request edit/withdraw', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let departmentId: string;
  let managerId: string;
  let generalManagerId: string;
  let applicantId: string;
  let otherEmployeeId: string;
  let budgetCodeId: string;
  const createdCaseIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const code = `PRW-DEPT-${Date.now()}`;
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: manager } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-MGR-${Date.now()}`, name: '測試主管', department_id: anyDept!.id })
      .select()
      .single();
    managerId = manager!.id;
    const { data: dept } = await admin
      .from('departments')
      .insert({ code, name: '測試部門', manager_employee_id: managerId })
      .select()
      .single();
    departmentId = dept!.id;
    await admin.from('employees').update({ department_id: departmentId }).eq('id', managerId);
    const { data: gm } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-GM-${Date.now()}`, name: '測試總經理', department_id: departmentId, is_general_manager: true })
      .select()
      .single();
    generalManagerId = gm!.id;
    const { data: applicant } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-APP-${Date.now()}`, name: '測試申請人', department_id: departmentId })
      .select()
      .single();
    applicantId = applicant!.id;
    const { data: other } = await admin
      .from('employees')
      .insert({ employee_code: `PRW-OTHER-${Date.now()}`, name: '測試其他人', department_id: departmentId })
      .select()
      .single();
    otherEmployeeId = other!.id;
    const { data: budgetCode } = await admin
      .from('budget_codes')
      .insert({
        code: `PRW-BC-${Date.now()}`,
        department_id: departmentId,
        category: '雜項購置',
        fiscal_year: '115',
        annual_budget_amount: 1000000,
        owner_employee_id: managerId,
      })
      .select()
      .single();
    budgetCodeId = budgetCode!.id;
  });

  afterAll(async () => {
    for (const caseId of createdCaseIds) {
      const { data: prs } = await admin.from('purchase_requests').select('id').eq('procurement_case_id', caseId);
      for (const pr of prs ?? []) {
        await admin.from('purchase_request_items').delete().eq('purchase_request_id', pr.id);
        await admin.from('approval_steps').delete().eq('form_type', 'purchase_request').eq('form_id', pr.id);
      }
      await admin.from('purchase_requests').delete().eq('procurement_case_id', caseId);
      await admin.from('procurement_cases').delete().eq('id', caseId);
    }
    await admin.from('budget_codes').delete().eq('id', budgetCodeId);
    await admin.from('departments').update({ manager_employee_id: null }).eq('id', departmentId);
    await admin.from('employees').delete().in('id', [applicantId, otherEmployeeId, generalManagerId, managerId]);
    await admin.from('departments').delete().eq('id', departmentId);
  });

  async function createTestRequest() {
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { createPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await createPurchaseRequest({ idempotencyKey: crypto.randomUUID(),
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '測試項目', quantity: 1, estimatedAmount: 5000 }],
    });
    if (!result.ok) throw new Error(result.error);
    const { data: pr } = await admin
      .from('purchase_requests')
      .select('procurement_case_id')
      .eq('id', result.requestId)
      .single();
    createdCaseIds.push(pr!.procurement_case_id);
    return result.requestId;
  }

  it('rejects update from a non-applicant', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, { expectedVersion: await versionOf('purchase_requests', requestId),
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '改過的項目', quantity: 1, estimatedAmount: 6000 }],
    });
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以修改這張請購單' });
  });

  it('allows the applicant to edit before any approval, rebuilding the chain', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, { expectedVersion: await versionOf('purchase_requests', requestId),
      neededWithinDays: 45,
      items: [{ budgetCodeId, description: '改過的項目', quantity: 2, estimatedAmount: 200000 }],
    });
    expect(result).toEqual({ ok: true });

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('total_amount, needed_within_days, current_step_order, status')
      .eq('id', requestId)
      .single();
    expect(Number(pr!.total_amount)).toBe(200000);
    expect(pr!.needed_within_days).toBe(45);
    expect(pr!.current_step_order).toBe(1);
    expect(pr!.status).toBe('pending_approval');
  });

  it('rejects edit once the first step has already been approved', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: managerId, role: 'staff', departmentId };
    const { approvePurchaseRequestStep } = await import('@/lib/purchase-requests/actions');
    await approvePurchaseRequestStep(requestId, await versionOf('purchase_requests', requestId));

    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { updatePurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await updatePurchaseRequest(requestId, { expectedVersion: await versionOf('purchase_requests', requestId),
      neededWithinDays: 30,
      items: [{ budgetCodeId, description: '不該被接受', quantity: 1, estimatedAmount: 1000 }],
    });
    expect(result).toMatchObject({ ok: false, error: '只有尚未有人簽核的請購單可以修改' });
  });

  it('rejects withdraw from a non-applicant', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: otherEmployeeId, role: 'staff', departmentId };
    const { withdrawPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await withdrawPurchaseRequest(requestId);
    expect(result).toMatchObject({ ok: false, error: '只有申請人可以撤回這張請購單' });
  });

  it('allows the applicant to withdraw before any approval, without deleting the row', async () => {
    const requestId = await createTestRequest();
    currentEmployee.value = { id: applicantId, role: 'staff', departmentId };
    const { withdrawPurchaseRequest } = await import('@/lib/purchase-requests/actions');
    const result = await withdrawPurchaseRequest(requestId);
    expect(result).toEqual({ ok: true });

    const { data: pr } = await admin
      .from('purchase_requests')
      .select('status, current_step_order')
      .eq('id', requestId)
      .single();
    expect(pr).toEqual({ status: 'withdrawn', current_step_order: null });
  });
});
