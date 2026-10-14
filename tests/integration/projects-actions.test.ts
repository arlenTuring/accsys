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
});
