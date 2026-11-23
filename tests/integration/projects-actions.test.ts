import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServiceRoleTestClient } from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({ value: null as null | { id: string; role: string } }));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('projects actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let financeEmployeeId: string;
  let staffEmployeeId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: financeEmp } = await admin
      .from('employees')
      .insert({ employee_code: `PJT-FIN-${Date.now()}`, name: '測試財會人員', department_id: anyDept!.id, role: 'finance' })
      .select()
      .single();
    financeEmployeeId = financeEmp!.id;
    const { data: staffEmp } = await admin
      .from('employees')
      .insert({ employee_code: `PJT-STAFF-${Date.now()}`, name: '測試一般員工', department_id: anyDept!.id, role: 'staff' })
      .select()
      .single();
    staffEmployeeId = staffEmp!.id;
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await admin.from('projects').delete().in('id', createdProjectIds);
    }
    await admin.from('employees').delete().in('id', [financeEmployeeId, staffEmployeeId]);
  });

  it('rejects a non-finance employee', async () => {
    currentEmployee.value = { id: staffEmployeeId, role: 'staff' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const result = await upsertProject({ code: `PJT-CODE-${Date.now()}`, name: '測試專案', kind: 'product' });
    expect(result).toEqual({ ok: false, error: '只有財會人員可以維護專案' });
  });

  it('creates a project', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const code = `PJT-CODE-${Date.now()}`;
    const result = await upsertProject({ code, name: '測試專案 A', kind: 'revenue' });
    expect(result.ok).toBe(true);
    if (result.ok) createdProjectIds.push(result.projectId);

    const { data: row } = await admin.from('projects').select('name, kind').eq('code', code).single();
    expect(row).toEqual({ name: '測試專案 A', kind: 'revenue' });
  });

  it('rejects an unknown project kind', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const result = await upsertProject({ code: `PJT-KIND-${Date.now()}`, name: '測試專案', kind: 'other' as never });
    expect(result).toEqual({ ok: false, error: '請選擇專案類型' });
  });

  it('updates an existing project on repeated upsert rather than creating a duplicate', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const code = `PJT-UPDATE-${Date.now()}`;
    const first = await upsertProject({ code, name: '舊名稱', kind: 'product' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdProjectIds.push(first.projectId);

    const second = await upsertProject({ code, name: '新名稱', kind: 'product' });
    expect(second).toEqual({ ok: true, projectId: first.projectId });

    const { count } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('code', code);
    expect(count).toBe(1);

    const { data: events } = await admin
      .from('audit_events')
      .select('action, actor_employee_id')
      .eq('entity_id', first.projectId)
      .order('id');
    expect(events).toEqual([
      { action: 'project.created', actor_employee_id: financeEmployeeId },
      { action: 'project.updated', actor_employee_id: financeEmployeeId },
    ]);
  });

  it('rejects malformed input instead of crashing', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    expect(await upsertProject({ code: 1, name: 'x', kind: 'product' } as never)).toEqual({ ok: false, error: '資料格式不正確' });
    expect(await upsertProject({ code: 'P', name: 'x'.repeat(201), kind: 'product' })).toEqual({
      ok: false,
      error: '專案代碼或名稱過長',
    });
  });

  it('supports editing an existing project by id (including changing code, name, and kind)', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject } = await import('@/lib/projects/actions');
    const initialCode = `PJT-EDIT-INIT-${Date.now()}`;
    const renamedCode = `PJT-EDIT-NEW-${Date.now()}`;

    const created = await upsertProject({
      code: initialCode,
      name: '修改前專案名稱',
      kind: 'product',
      mode: 'create',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdProjectIds.push(created.projectId);

    const updated = await upsertProject({
      id: created.projectId,
      code: renamedCode,
      name: '修改後專案名稱',
      kind: 'revenue',
      mode: 'update',
    });
    expect(updated).toEqual({ ok: true, projectId: created.projectId });

    const { data: row } = await admin
      .from('projects')
      .select('code, name, kind')
      .eq('id', created.projectId)
      .single();
    expect(row).toEqual({
      code: renamedCode,
      name: '修改後專案名稱',
      kind: 'revenue',
    });
  });

  it('prevents deleting a project that already has budget records and requires deactivation instead, while allowing deletion of unused projects', async () => {
    currentEmployee.value = { id: financeEmployeeId, role: 'finance' };
    const { upsertProject, deleteProject, setProjectActive } = await import('@/lib/projects/actions');
    const { getProjectList } = await import('@/lib/projects/queries');

    // 1. Create a project with a budget code (established budget)
    const codeWithBudget = `PJT-WITH-BUDGET-${Date.now()}`;
    const pWithBudget = await upsertProject({
      code: codeWithBudget,
      name: '已建立預算單之專案',
      kind: 'product',
      mode: 'create',
    });
    expect(pWithBudget.ok).toBe(true);
    if (!pWithBudget.ok) return;
    createdProjectIds.push(pWithBudget.projectId);

    const bcCode = `116-${codeWithBudget}-SE01`;
    const { data: bcRow } = await admin
      .from('budget_codes')
      .insert({
        code: bcCode,
        project_id: pWithBudget.projectId,
        category: '薪資支出',
        fiscal_year: '116',
        annual_budget_amount: 500000,
        active: true,
      })
      .select('id')
      .single();

    try {
      // Trying to delete a project that has budget records must be blocked
      const delBlocked = await deleteProject(pWithBudget.projectId);
      expect(delBlocked.ok).toBe(false);
      if (!delBlocked.ok) {
        expect(delBlocked.error).toContain('停用');
      }

      // Deactivating the project succeeds and marks it & its budget codes inactive
      const disableRes = await setProjectActive(pWithBudget.projectId, false);
      expect(disableRes).toEqual({ ok: true });

      const listAfterDisable = await getProjectList({ includeInactive: true });
      const foundDisabled = listAfterDisable.find((p) => p.id === pWithBudget.projectId);
      expect(foundDisabled?.active).toBe(false);
      expect(foundDisabled?.hasBudgetForms).toBe(true);

      // Re-enabling works
      const enableRes = await setProjectActive(pWithBudget.projectId, true);
      expect(enableRes).toEqual({ ok: true });
      const listAfterEnable = await getProjectList({ includeInactive: true });
      const foundEnabled = listAfterEnable.find((p) => p.id === pWithBudget.projectId);
      expect(foundEnabled?.active).toBe(true);
    } finally {
      if (bcRow?.id) {
        await admin.from('budget_codes').delete().eq('id', bcRow.id);
      }
    }

    // 2. Create an unused project without any budget records and delete it
    const unusedCode = `PJT-UNUSED-${Date.now()}`;
    const pUnused = await upsertProject({
      code: unusedCode,
      name: '尚未建立預算之專案',
      kind: 'product',
      mode: 'create',
    });
    expect(pUnused.ok).toBe(true);
    if (!pUnused.ok) return;

    const delOk = await deleteProject(pUnused.projectId);
    expect(delOk).toEqual({ ok: true });

    const { data: deletedCheck } = await admin
      .from('projects')
      .select('id')
      .eq('id', pUnused.projectId)
      .maybeSingle();
    expect(deletedCheck).toBeNull();
  });
});
